/* global Buffer */
import {
  ELECTRUM_QUERIES,
  ElectrumClient,
} from 'dok-wallet-blockchain-networks/service/electrum';
import {parseBlockchainTransactions} from 'dok-wallet-blockchain-networks/service/blockChair';

jest.mock('dok-wallet-blockchain-networks/config/config', () => ({
  IS_SANDBOX: false,
  isWeb: false,
  config: {},
}));

jest.mock('dok-wallet-blockchain-networks/service/blockChair', () => ({
  parseBlockchainTransactions: jest.fn(() => []),
}));

// Wraps an in-memory socket in a real ElectrumClient. Every query takes its
// client explicitly, so no module-registry gymnastics are needed to inject one.
const clientOver = (socket, server = {host: 'fake', port: 1}) =>
  new ElectrumClient({
    servers: [server],
    socketFactory: (_srv, onConnect) => {
      setImmediate(onConnect);
      return socket;
    },
  });

/**
 * In-memory Electrum server over the injectable socketFactory: records every
 * batch written, tracks how many were in flight at once, and answers each
 * request by echoing its first param (or erroring when the param is 'boom').
 */
const createFakeClient = serverEntry => {
  const server = {batches: [], inflight: 0, maxInflight: 0};
  const handlers = {};
  const deliver = response => {
    (handlers.data || []).forEach(fn => fn(JSON.stringify(response) + '\n'));
  };
  const answer = item =>
    item.params?.[0] === 'boom'
      ? {jsonrpc: '2.0', id: item.id, error: {message: 'boom'}}
      : {jsonrpc: '2.0', id: item.id, result: item.params?.[0]};

  const socket = {
    on: (event, fn) => {
      handlers[event] = handlers[event] || [];
      handlers[event].push(fn);
    },
    write: line => {
      const payload = JSON.parse(line);
      if (!Array.isArray(payload)) {
        // server.version handshake
        setImmediate(() =>
          deliver([{jsonrpc: '2.0', id: payload.id, result: ['fake', '1.4']}]),
        );
        return;
      }
      server.batches.push(payload);
      server.inflight += 1;
      server.maxInflight = Math.max(server.maxInflight, server.inflight);
      setImmediate(() => {
        server.inflight -= 1;
        deliver(payload.map(answer));
      });
    },
    destroy: () => {},
  };

  return {client: clientOver(socket, serverEntry), server};
};

const makeCalls = (count, boomAt = -1) =>
  Array.from({length: count}, (_v, i) => ({
    method: 'blockchain.scripthash.get_balance',
    params: [i === boomAt ? 'boom' : `addr-${i}`],
  }));

describe('ElectrumClient.batchRequestChunked', () => {
  it('returns no results for no calls without touching the socket', async () => {
    const {client, server} = createFakeClient();
    await expect(client.batchRequestChunked([])).resolves.toEqual([]);
    expect(server.batches).toHaveLength(0);
  });

  it('keeps results in call order across chunks', async () => {
    const {client, server} = createFakeClient();
    const calls = makeCalls(250);
    const results = await client.batchRequestChunked(calls, 100);
    expect(results).toEqual(calls.map(call => call.params[0]));
    expect(server.batches.map(batch => batch.length)).toEqual([100, 100, 50]);
  });

  it('overlaps chunks instead of serializing them', async () => {
    const {client, server} = createFakeClient();
    await client.batchRequestChunked(makeCalls(250), 100);
    // 3 chunks, all in flight together -- the sequential version peaked at 1.
    expect(server.maxInflight).toBe(3);
  });

  it('caps the number of chunks in flight at once', async () => {
    const {client, server} = createFakeClient();
    const calls = makeCalls(600);
    const results = await client.batchRequestChunked(calls, 100);
    expect(results).toEqual(calls.map(call => call.params[0]));
    expect(server.batches).toHaveLength(6);
    expect(server.maxInflight).toBe(4);
  });

  it('propagates a chunk error and stops claiming unstarted chunks', async () => {
    const {client, server} = createFakeClient();
    await expect(
      client.batchRequestChunked(makeCalls(600, 0), 100),
    ).rejects.toThrow('boom');
    // Chunks 0-3 were already in flight; 4 and 5 were never written.
    expect(server.batches).toHaveLength(4);
  });

  it('still settles per-call errors when settleErrors is set', async () => {
    const {client} = createFakeClient();
    const calls = makeCalls(250, 150);
    const results = await client.batchRequestChunked(calls, 100, {
      settleErrors: true,
    });
    expect(results).toHaveLength(250);
    expect(results[150].electrumError).toBeInstanceOf(Error);
    expect(results[149]).toBe('addr-149');
    expect(results[151]).toBe('addr-151');
  });
});

describe('ElectrumClient per-server batch cap', () => {
  it('caps chunk size at the server maxBatch', async () => {
    // electrs-esplora (Blockstream) closes the socket above 20 per batch.
    const {client, server} = createFakeClient({
      host: 'fake',
      port: 1,
      maxBatch: 20,
    });
    const calls = makeCalls(100);
    const results = await client.batchRequestChunked(calls, 100);
    expect(results).toEqual(calls.map(call => call.params[0]));
    expect(server.batches.map(batch => batch.length)).toEqual([
      20, 20, 20, 20, 20,
    ]);
  });

  it('keeps the requested chunk size when the server has no maxBatch', async () => {
    const {client, server} = createFakeClient();
    await client.batchRequestChunked(makeCalls(100), 100);
    expect(server.batches.map(batch => batch.length)).toEqual([100]);
  });
});

/**
 * Multi-server harness: one fake socket per connect, scripted per server.
 *   'ok'           handshake + batches answered normally
 *   'closeOnBatch' handshake ok, then the socket closes when a batch arrives
 *   'connectError' socket errors before the connect callback fires
 */
const createFailoverHarness = behaviours => {
  const servers = behaviours.map((_b, i) => ({host: `srv${i}`, port: 1}));
  const factoryCalls = [];
  const sockets = [];
  const socketFactory = (server, onConnect) => {
    factoryCalls.push(server.host);
    const behaviour = behaviours[servers.indexOf(server)];
    const handlers = {};
    const socket = {
      on: (event, fn) => {
        (handlers[event] = handlers[event] || []).push(fn);
      },
      emit: (event, ...args) =>
        (handlers[event] || []).forEach(fn => fn(...args)),
      write: line => {
        const payload = JSON.parse(line);
        if (!Array.isArray(payload)) {
          setImmediate(() =>
            socket.emit(
              'data',
              JSON.stringify({
                jsonrpc: '2.0',
                id: payload.id,
                result: ['fake', '1.4'],
              }) + '\n',
            ),
          );
          return;
        }
        if (behaviour === 'closeOnBatch') {
          setImmediate(() => socket.emit('close'));
          return;
        }
        setImmediate(() =>
          socket.emit(
            'data',
            JSON.stringify(
              payload.map(item => ({
                jsonrpc: '2.0',
                id: item.id,
                result: item.params?.[0],
              })),
            ) + '\n',
          ),
        );
      },
      destroy: () => {},
    };
    sockets.push(socket);
    if (behaviour === 'connectError') {
      setImmediate(() => socket.emit('error', new Error('ECONNREFUSED')));
    } else {
      setImmediate(onConnect);
    }
    return socket;
  };
  return {
    client: new ElectrumClient({servers, socketFactory}),
    factoryCalls,
    sockets,
  };
};

describe('ElectrumClient failover', () => {
  it('rotates to the next server when the live socket closes with requests pending', async () => {
    const {client, factoryCalls} = createFailoverHarness([
      'closeOnBatch',
      'ok',
    ]);
    await expect(client.batchRequestChunked(makeCalls(3))).rejects.toThrow(
      'Electrum connection closed',
    );
    await expect(client.batchRequestChunked(makeCalls(3))).resolves.toEqual([
      'addr-0',
      'addr-1',
      'addr-2',
    ]);
    expect(factoryCalls).toEqual(['srv0', 'srv1']);
  });

  it('does not rotate on an idle close', async () => {
    const {client, factoryCalls, sockets} = createFailoverHarness(['ok', 'ok']);
    await client.batchRequestChunked(makeCalls(2));
    sockets[0].emit('close');
    await client.batchRequestChunked(makeCalls(2));
    expect(factoryCalls).toEqual(['srv0', 'srv0']);
  });

  it('rotates exactly once per handshake failure', async () => {
    const {client, factoryCalls} = createFailoverHarness([
      'connectError',
      'ok',
      'ok',
    ]);
    await expect(client.batchRequestChunked(makeCalls(2))).resolves.toEqual([
      'addr-0',
      'addr-1',
    ]);
    // A double increment would skip srv1 and land on srv2.
    expect(factoryCalls).toEqual(['srv0', 'srv1']);
  });
});

const bitcoin = require('bitcoinjs-lib');

const P2PKH_SCRIPT = Buffer.concat([
  Buffer.from([0x76, 0xa9, 0x14]),
  Buffer.alloc(20, 2),
  Buffer.from([0x88, 0xac]),
]);
const P2WPKH_SCRIPT = Buffer.concat([
  Buffer.from([0x00, 0x14]),
  Buffer.alloc(20, 3),
]);

// vout 0 is legacy (-> txhash / nonWitnessUtxo), vout 1 is segwit
// (-> scriptpubkey / witnessUtxo).
const buildRawTx = () => {
  const tx = new bitcoin.Transaction();
  tx.addInput(Buffer.alloc(32, 1), 0);
  tx.addOutput(P2PKH_SCRIPT, 1000);
  tx.addOutput(P2WPKH_SCRIPT, 2000);
  const hex = tx.toHex();
  return {hex, txid: bitcoin.Transaction.fromHex(hex).getId()};
};

// `results` maps txid -> whatever the server should answer with. A fresh client
// per call means fresh raw-tx/block-time caches, so tests cannot pollute
// each other through them.
const loadSharedClient = results => {
  const handlers = {};
  const server = {batches: 0};
  const deliver = response => {
    (handlers.data || []).forEach(fn => fn(JSON.stringify(response) + '\n'));
  };
  const socket = {
    on: (event, fn) => {
      handlers[event] = handlers[event] || [];
      handlers[event].push(fn);
    },
    write: line => {
      const payload = JSON.parse(line);
      if (!Array.isArray(payload)) {
        // The handshake, or anything sent via client.request (e.g. broadcast).
        setImmediate(() =>
          deliver([
            {
              jsonrpc: '2.0',
              id: payload.id,
              result:
                payload.method === 'server.version'
                  ? ['fake', '1.4']
                  : results[payload.params?.[0]],
            },
          ]),
        );
        return;
      }
      server.batches += 1;
      setImmediate(() =>
        deliver(
          payload.map(item => ({
            jsonrpc: '2.0',
            id: item.id,
            result: results[item.params[0]],
          })),
        ),
      );
    },
    destroy: () => {},
  };
  const client = clientOver(socket);
  return {
    fetchDetails: payload => ELECTRUM_QUERIES.txdetails(client, payload),
    broadcast: payload => ELECTRUM_QUERIES.broadcast(client, payload),
    server,
  };
};

describe('electrumFetchBitcoinTransactionDetails validation', () => {
  it('enriches legacy and segwit outputs and fetches each txid once', async () => {
    const {hex, txid} = buildRawTx();
    const {fetchDetails, server} = loadSharedClient({[txid]: hex});

    const {status, data} = await fetchDetails({
      transaction_data: [
        {txid, vout: 0, derivePath: 'm/0/0'},
        {txid, vout: 1, derivePath: 'm/0/1'},
      ],
    });

    expect(status).toBe(200);
    // Legacy needs the whole previous tx; segwit only needs the script.
    expect(data[0]).toEqual({
      txid,
      vout: 0,
      derivePath: 'm/0/0',
      value: 1000,
      txhash: hex,
    });
    expect(data[1]).toEqual({
      txid,
      vout: 1,
      derivePath: 'm/0/1',
      value: 2000,
      scriptpubkey: P2WPKH_SCRIPT.toString('hex'),
    });
    expect(server.batches).toBe(1);
  });

  it('rejects an entry with no txid before issuing any request', async () => {
    const {fetchDetails, server} = loadSharedClient({});
    await expect(fetchDetails({transaction_data: [{vout: 0}]})).rejects.toThrow(
      'utxo at index 0 has no txid',
    );
    expect(server.batches).toBe(0);
  });

  it('rejects when the server returns no raw transaction', async () => {
    const {txid} = buildRawTx();
    const {fetchDetails} = loadSharedClient({[txid]: null});
    await expect(
      fetchDetails({transaction_data: [{txid, vout: 0}]}),
    ).rejects.toThrow(`no raw transaction returned for ${txid}:0`);
  });

  it('rejects an undecodable raw transaction', async () => {
    const {txid} = buildRawTx();
    const {fetchDetails} = loadSharedClient({[txid]: 'not-valid-hex'});
    await expect(
      fetchDetails({transaction_data: [{txid, vout: 0}]}),
    ).rejects.toThrow(`undecodable raw transaction for ${txid}:0`);
  });

  it('rejects a vout past the end of the transaction', async () => {
    const {hex, txid} = buildRawTx();
    const {fetchDetails} = loadSharedClient({[txid]: hex});
    await expect(
      fetchDetails({transaction_data: [{txid, vout: 7}]}),
    ).rejects.toThrow(`vout 7 out of range for ${txid} (2 outputs)`);
  });

  it('rejects rather than dropping a bad entry alongside valid ones', async () => {
    const {hex, txid} = buildRawTx();
    const {fetchDetails} = loadSharedClient({[txid]: hex});
    // Silently returning only the valid entry would under-fund the PSBT the
    // caller builds, because its change output uses the pre-fetch utxo total.
    await expect(
      fetchDetails({
        transaction_data: [
          {txid, vout: 0},
          {txid, vout: 99},
        ],
      }),
    ).rejects.toThrow('vout 99 out of range');
  });

  it('returns nothing for no input without contacting the server', async () => {
    const {fetchDetails, server} = loadSharedClient({});
    await expect(fetchDetails({transaction_data: []})).resolves.toEqual({
      status: 200,
      data: [],
    });
    expect(server.batches).toBe(0);
  });
});

// Reverses a txid into the internal byte order Transaction.addInput expects.
const txidToInputHash = txid => Buffer.from(txid, 'hex').reverse();

const buildPrevTx = () => {
  const tx = new bitcoin.Transaction();
  tx.addInput(Buffer.alloc(32, 9), 0);
  tx.addOutput(P2PKH_SCRIPT, 5000);
  tx.addOutput(P2WPKH_SCRIPT, 7000);
  const hex = tx.toHex();
  return {hex, txid: bitcoin.Transaction.fromHex(hex).getId()};
};

// Spends `voutsToSpend` of prevTxid, paying out `outputValue` in total.
const buildSpendingTx = (prevTxid, voutsToSpend, outputValue) => {
  const tx = new bitcoin.Transaction();
  voutsToSpend.forEach(vout => tx.addInput(txidToInputHash(prevTxid), vout));
  tx.addOutput(P2PKH_SCRIPT, outputValue);
  const hex = tx.toHex();
  return {hex, txid: bitcoin.Transaction.fromHex(hex).getId()};
};

const buildHeaderHex = time => {
  const header = Buffer.alloc(80);
  header.writeUInt32LE(time, 68);
  return header.toString('hex');
};

const HEIGHT = 700000;
const BLOCK_TIME = 1700000000;

const loadHistoryClient = ({history, rawTxs, tip = 800001}) => {
  const handlers = {};
  const server = {getCalls: []};
  const deliver = response => {
    (handlers.data || []).forEach(fn => fn(JSON.stringify(response) + '\n'));
  };
  const answer = ({method, params, id}) => {
    const reply = result => ({jsonrpc: '2.0', id, result});
    switch (method) {
      case 'server.version':
        return reply(['fake', '1.4']);
      case 'blockchain.headers.subscribe':
        return reply({height: tip});
      case 'blockchain.scripthash.get_history':
        return reply(history);
      case 'blockchain.transaction.get':
        server.getCalls.push(params[0]);
        return reply(rawTxs[params[0]]);
      case 'blockchain.block.header':
        return reply(buildHeaderHex(BLOCK_TIME));
      default:
        return {jsonrpc: '2.0', id, error: {message: `unexpected ${method}`}};
    }
  };
  const socket = {
    on: (event, fn) => {
      handlers[event] = handlers[event] || [];
      handlers[event].push(fn);
    },
    write: line => {
      const payload = JSON.parse(line);
      const items = Array.isArray(payload) ? payload : [payload];
      setImmediate(() => deliver(items.map(answer)));
    },
    destroy: () => {},
  };
  const client = clientOver(socket);
  parseBlockchainTransactions.mockClear();
  return {
    fetchTransactions: payload =>
      ELECTRUM_QUERIES.transactions(client, payload),
    shapedTxs: () => parseBlockchainTransactions.mock.calls[0]?.[0],
    server,
  };
};

const ADDRESS = bitcoin.address.fromOutputScript(P2PKH_SCRIPT);
const SEGWIT_ADDRESS = bitcoin.address.fromOutputScript(P2WPKH_SCRIPT);

describe('buildBlockchairShapedTxs previous-output guards', () => {
  it('reads input values from the previous tx and derives the fee', async () => {
    const prev = buildPrevTx();
    const spend = buildSpendingTx(prev.txid, [0], 4200);
    const {fetchTransactions, shapedTxs} = loadHistoryClient({
      history: [{tx_hash: spend.txid, height: HEIGHT}],
      rawTxs: {[spend.txid]: spend.hex, [prev.txid]: prev.hex},
    });

    await fetchTransactions({address: ADDRESS});
    const [shaped] = shapedTxs();

    expect(shaped.inputs).toEqual([{recipient: ADDRESS, value: 5000}]);
    expect(shaped.outputs).toEqual([{recipient: ADDRESS, value: 4200}]);
    expect(shaped.transaction.fee).toBe(800);
    expect(shaped.transaction.block_id).toBe(HEIGHT);
    expect(shaped.transaction.time).toBe(
      new Date(BLOCK_TIME * 1000).toISOString(),
    );
  });

  it('parses each previous tx once even when several inputs spend it', async () => {
    const prev = buildPrevTx();
    const spend = buildSpendingTx(prev.txid, [0, 1], 11000);
    const {fetchTransactions, shapedTxs, server} = loadHistoryClient({
      history: [{tx_hash: spend.txid, height: HEIGHT}],
      rawTxs: {[spend.txid]: spend.hex, [prev.txid]: prev.hex},
    });
    // Same Transaction class the module under test holds, so the spy sees its
    // parses.
    const {Transaction} = require('bitcoinjs-lib');
    const fromHex = jest.spyOn(Transaction, 'fromHex');
    try {
      await fetchTransactions({address: ADDRESS});
      const [shaped] = shapedTxs();

      // Distinct recipients prove each input resolved to its OWN output of
      // the shared previous tx, not just to a cached first parse.
      expect(shaped.inputs).toEqual([
        {recipient: ADDRESS, value: 5000},
        {recipient: SEGWIT_ADDRESS, value: 7000},
      ]);
      expect(shaped.transaction.fee).toBe(1000);
      // Two inputs, one previous tx: parsed once, not once per input.
      const prevParses = fromHex.mock.calls.filter(
        ([hex]) => hex === prev.hex,
      ).length;
      expect(prevParses).toBe(1);
      // The raw hex cache already collapses the network side.
      expect(server.getCalls.filter(t => t === prev.txid)).toHaveLength(1);
    } finally {
      fromHex.mockRestore();
    }
  });

  it('degrades when the previous tx comes back as non-hex text', async () => {
    const prev = buildPrevTx();
    const spend = buildSpendingTx(prev.txid, [0], 4200);
    const {fetchTransactions, shapedTxs} = loadHistoryClient({
      history: [{tx_hash: spend.txid, height: HEIGHT}],
      // A server answering with plain text instead of hex used to throw out of
      // the whole history fetch.
      rawTxs: {[spend.txid]: spend.hex, [prev.txid]: 'rate limit exceeded'},
    });

    await fetchTransactions({address: ADDRESS});
    const [shaped] = shapedTxs();

    expect(shaped.inputs).toEqual([{recipient: null, value: 0}]);
    expect(shaped.transaction.fee).toBe(0);
    expect(shaped.outputs).toEqual([{recipient: ADDRESS, value: 4200}]);
  });

  it('degrades when the input spends a vout past the previous tx', async () => {
    const prev = buildPrevTx();
    const spend = buildSpendingTx(prev.txid, [5], 4200);
    const {fetchTransactions, shapedTxs} = loadHistoryClient({
      history: [{tx_hash: spend.txid, height: HEIGHT}],
      rawTxs: {[spend.txid]: spend.hex, [prev.txid]: prev.hex},
    });

    await fetchTransactions({address: ADDRESS});
    const [shaped] = shapedTxs();

    expect(shaped.inputs).toEqual([{recipient: null, value: 0}]);
    expect(shaped.transaction.fee).toBe(0);
  });

  it('degrades when the previous tx is missing entirely', async () => {
    const prev = buildPrevTx();
    const spend = buildSpendingTx(prev.txid, [0], 4200);
    const {fetchTransactions, shapedTxs} = loadHistoryClient({
      history: [{tx_hash: spend.txid, height: HEIGHT}],
      rawTxs: {[spend.txid]: spend.hex},
    });

    await fetchTransactions({address: ADDRESS});
    const [shaped] = shapedTxs();

    expect(shaped.inputs).toEqual([{recipient: null, value: 0}]);
    expect(shaped.transaction.fee).toBe(0);
  });
});

describe('electrumBroadcastTransaction txid verification', () => {
  const {hex: TX_HEX, txid: TX_ID} = (() => {
    const tx = new bitcoin.Transaction();
    tx.addInput(Buffer.alloc(32, 7), 0);
    tx.addOutput(P2PKH_SCRIPT, 4321);
    const hex = tx.toHex();
    return {hex, txid: bitcoin.Transaction.fromHex(hex).getId()};
  })();

  const OTHER_TXID = 'a'.repeat(64);

  it('returns the txid when the server echoes our own', async () => {
    const {broadcast} = loadSharedClient({[TX_HEX]: TX_ID});
    await expect(broadcast({txHex: TX_HEX})).resolves.toBe(TX_ID);
  });

  it('accepts an uppercase txid', async () => {
    const upper = TX_ID.toUpperCase();
    const {broadcast} = loadSharedClient({[TX_HEX]: upper});
    await expect(broadcast({txHex: TX_HEX})).resolves.toBe(upper);
  });

  it('rejects a well-formed txid that is not ours', async () => {
    // The wallet would otherwise track a transaction that does not exist.
    const {broadcast} = loadSharedClient({[TX_HEX]: OTHER_TXID});
    await expect(broadcast({txHex: TX_HEX})).rejects.toThrow(
      `Electrum broadcast returned txid ${OTHER_TXID}, expected ${TX_ID}`,
    );
  });

  it('still rejects rejection text returned as a result', async () => {
    const {broadcast} = loadSharedClient({
      [TX_HEX]: 'bad-txns-inputs-missingorspent',
    });
    await expect(broadcast({txHex: TX_HEX})).rejects.toThrow(
      'Electrum broadcast rejected: bad-txns-inputs-missingorspent',
    );
  });

  it('still rejects a non-string result', async () => {
    const {broadcast} = loadSharedClient({[TX_HEX]: {unexpected: true}});
    await expect(broadcast({txHex: TX_HEX})).rejects.toThrow(
      'Electrum broadcast rejected: {"unexpected":true}',
    );
  });
});

describe('ELECTRUM_QUERIES registry', () => {
  // The op vocabulary is the seam contract: bitcoinDataSource names an op, each
  // app's transport looks it up here. Pin the shape so an op cannot be added on
  // one side only.
  const EXPECTED_OPS = [
    'balances',
    'utxo',
    'txdetails',
    'transactions',
    'transaction',
    'addressusage',
    'broadcast',
    'feerate',
  ];

  it('exposes exactly the expected ops', () => {
    expect(Object.keys(ELECTRUM_QUERIES).sort()).toEqual(
      [...EXPECTED_OPS].sort(),
    );
  });

  it('maps every op to a function taking a client', () => {
    Object.entries(ELECTRUM_QUERIES).forEach(([op, fn]) => {
      expect(typeof fn).toBe('function');
      // (client, payload) — the client is always explicit, never a singleton.
      expect(fn.length).toBeGreaterThanOrEqual(1);
    });
  });
});

describe('addressToScripthash', () => {
  // bitcoinjs routes bech32m (v1 / taproot) addresses through payments.p2tr,
  // which throws unless initEccLib has run. A balance refresh is the first
  // thing that touches these addresses on a cold start, so the module must
  // not rely on some other code path having initialised ECC first.
  it('hashes a taproot address without a prior ECC init', () => {
    jest.isolateModules(() => {
      const {
        addressToScripthash,
      } = require('dok-wallet-blockchain-networks/service/electrum');
      // BIP-86 test vector, change #0 (m/86'/0'/0'/1/0).
      expect(
        addressToScripthash(
          'bc1p3qkhfews2uk44qtvauqyr2ttdsw7svhkl9nkm9s9c3x4ax5h60wqwruhk7',
        ),
      ).toBe(
        '34bf85ef0d112a3f0b699df256ed691d377cfcb47eb9fbdf0876766862bedbc9',
      );
    });
  });

  it('still hashes a P2WPKH address', () => {
    const {
      addressToScripthash,
    } = require('dok-wallet-blockchain-networks/service/electrum');
    // BIP-173 example address; sha256(0014 751e76e8199196d454941c45d1b3a323f1433bd6), reversed.
    expect(
      addressToScripthash('bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4'),
    ).toMatch(/^[0-9a-f]{64}$/);
  });
});
