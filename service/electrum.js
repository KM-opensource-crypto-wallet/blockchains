import * as bitcoin from 'bitcoinjs-lib';
import {
  config,
  IS_SANDBOX,
  isWeb,
} from 'dok-wallet-blockchain-networks/config/config';
import {parseBlockchainTransactions} from 'dok-wallet-blockchain-networks/service/blockChair';

/**
 * Electrum protocol client (the same data source BlueWallet uses).
 *
 * Speaks newline-delimited JSON-RPC over a single persistent TLS socket.
 * One socket serves every request; queries are batched (JSON-RPC batch
 * arrays), so fetching hundreds of addresses costs a handful of round
 * trips instead of hundreds of HTTP calls.
 */

const ELECTRUM_SERVERS = IS_SANDBOX
  ? [
      {host: 'electrum.blockstream.info', port: 60002},
      {host: 'testnet.aranguren.org', port: 51002},
    ]
  : [
      // Own Fulcrum server (primary). Public servers below are fallbacks,
      // used automatically if this one is unreachable.
      // Note: the DNS record must stay "DNS only" in Cloudflare - proxying it
      // breaks port 50002, which the proxy does not forward.
      {host: 'electrum.kimlwallet.com', port: 50002},
      {host: 'mainnet.foundationdevices.com', port: 50002},
      {host: 'electrum1.bluewallet.io', port: 443},
      {host: 'electrum.blockstream.info', port: 50002},
    ];

const REQUEST_TIMEOUT_MS = 20000;
const BATCH_SIZE = 100;
// Chunks share one socket and are demuxed by JSON-RPC id, so they can overlap.
// Bounded because the public ElectrumX fallbacks rate-limit on concurrent cost.
const MAX_INFLIGHT_CHUNKS = 4;

// Lazily required so the web/desktop bundle (no native TCP) keeps working.
let tcpSocketModule;
const getTcpSocket = () => {
  if (tcpSocketModule !== undefined) {
    return tcpSocketModule;
  }
  try {
    // The package assigns module.exports after its `export default`, which
    // drops the compiled `.default` property — fall back to the module itself.
    const mod = require('react-native-tcp-socket');
    tcpSocketModule = (mod && mod.default) || mod || null;
  } catch (e) {
    console.log('error in tcpSocketModule', e);
    tcpSocketModule = null;
  }
  return tcpSocketModule;
};

export const isElectrumAvailable = () => !isWeb && !!getTcpSocket();

const defaultSocketFactory = ({host, port}, onConnect) => {
  const TcpSocket = getTcpSocket();
  return TcpSocket.connectTLS(
    {
      host,
      port,
      // Electrum servers commonly use self-signed certificates
      // (BlueWallet accepts them the same way).
      rejectUnauthorized: false,
    },
    onConnect,
  );
};

export class ElectrumClient {
  constructor({
    servers = ELECTRUM_SERVERS,
    socketFactory = defaultSocketFactory,
  } = {}) {
    this.servers = servers;
    this.socketFactory = socketFactory;
    this.socket = null;
    this.connectPromise = null;
    this.serverIndex = 0;
    this.nextId = 1;
    this.pending = new Map();
    this.buffer = '';
  }

  async connect() {
    // Order matters: _connectTo assigns this.socket before the TLS handshake
    // finishes, so concurrent callers must wait on the in-flight promise
    // instead of writing to a half-open socket.
    if (this.connectPromise) {
      return this.connectPromise;
    }
    if (this.socket) {
      return;
    }
    this.connectPromise = this._connectWithFailover().finally(() => {
      this.connectPromise = null;
    });
    return this.connectPromise;
  }

  async _connectWithFailover() {
    let lastError;
    for (let attempt = 0; attempt < this.servers.length; attempt++) {
      const server = this.servers[this.serverIndex % this.servers.length];
      try {
        await this._connectTo(server);
        await this._send('server.version', ['dok-wallet', '1.4']);
        return;
      } catch (e) {
        lastError = e;
        this._teardown(e);
        this.serverIndex += 1;
      }
    }
    throw lastError || new Error('No electrum server reachable');
  }

  _connectTo(server) {
    return new Promise((resolve, reject) => {
      let settled = false;
      const timer = setTimeout(() => {
        if (!settled) {
          settled = true;
          reject(new Error(`Electrum connect timeout ${server.host}`));
        }
      }, 10000);
      const socket = this.socketFactory(server, () => {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          resolve();
        }
      });
      socket.on('data', chunk => {
        if (this.socket === socket) {
          this._onData(chunk);
        }
      });
      // Events from a replaced/stale socket must not tear down the live one.
      socket.on('error', err => {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          reject(err);
        }
        if (this.socket === socket) {
          this._teardown(err);
        }
      });
      socket.on('close', () => {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          reject(new Error(`Electrum connection closed ${server.host}`));
        }
        if (this.socket === socket) {
          this._teardown(new Error('Electrum connection closed'));
        }
      });
      this.socket = socket;
    });
  }

  _teardown(error) {
    const socket = this.socket;
    this.socket = null;
    this.buffer = '';
    if (socket) {
      try {
        socket.destroy();
      } catch (e) {
        // ignore
      }
    }
    const pending = Array.from(this.pending.values());
    this.pending.clear();
    pending.forEach(({reject, timer}) => {
      clearTimeout(timer);
      reject(error || new Error('Electrum connection lost'));
    });
  }

  _onData(chunk) {
    this.buffer += chunk.toString();
    let newlineIndex;
    while ((newlineIndex = this.buffer.indexOf('\n')) !== -1) {
      const line = this.buffer.slice(0, newlineIndex).trim();
      this.buffer = this.buffer.slice(newlineIndex + 1);
      if (!line) {
        continue;
      }
      let message;
      try {
        message = JSON.parse(line);
      } catch (e) {
        continue;
      }
      const items = Array.isArray(message) ? message : [message];
      items.forEach(item => this._resolveResponse(item));
    }
  }

  _resolveResponse(item) {
    // Server-pushed notifications (subscriptions) have no id.
    if (!item || item.id === undefined || item.id === null) {
      return;
    }
    const entry = this.pending.get(item.id);
    if (!entry) {
      return;
    }
    this.pending.delete(item.id);
    clearTimeout(entry.timer);
    if (item.error) {
      entry.reject(
        new Error(item.error?.message || JSON.stringify(item.error)),
      );
    } else {
      entry.resolve(item.result);
    }
  }

  _registerRequest(id) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error('Electrum request timeout'));
      }, REQUEST_TIMEOUT_MS);
      this.pending.set(id, {resolve, reject, timer});
    });
  }

  // Removes just-registered requests so a synchronous write failure doesn't
  // leave orphaned 30s timers rejecting with no handler attached.
  _unregisterRequests(ids) {
    ids.forEach(id => {
      const entry = this.pending.get(id);
      if (entry) {
        clearTimeout(entry.timer);
        this.pending.delete(id);
      }
    });
  }

  _send(method, params) {
    if (!this.socket) {
      return Promise.reject(new Error('Electrum not connected'));
    }
    const id = this.nextId++;
    const promise = this._registerRequest(id);
    try {
      this.socket.write(
        JSON.stringify({jsonrpc: '2.0', id, method, params}) + '\n',
      );
    } catch (e) {
      this._unregisterRequests([id]);
      return Promise.reject(e);
    }
    return promise;
  }

  async request(method, params = []) {
    await this.connect();
    return this._send(method, params);
  }

  /**
   * JSON-RPC batch: one write, one response array. calls = [{method, params}].
   * Returns results in the same order as calls.
   */
  async batchRequest(calls, {settleErrors = false} = {}) {
    if (!calls.length) {
      return [];
    }
    await this.connect();
    if (!this.socket) {
      throw new Error('Electrum not connected');
    }
    const payload = [];
    const promises = [];
    const ids = [];
    for (const {method, params} of calls) {
      const id = this.nextId++;
      ids.push(id);
      const promise = this._registerRequest(id);
      promises.push(
        // With settleErrors, a per-call server error resolves to
        // {electrumError} instead of rejecting the whole batch.
        settleErrors
          ? promise.catch(error => ({electrumError: error}))
          : promise,
      );
      payload.push({jsonrpc: '2.0', id, method, params});
    }
    try {
      this.socket.write(JSON.stringify(payload) + '\n');
    } catch (e) {
      this._unregisterRequests(ids);
      throw e;
    }
    return Promise.all(promises);
  }

  /**
   * Splits calls into batches and keeps up to MAX_INFLIGHT_CHUNKS of them in
   * flight at once. One socket carries them all; responses are matched by
   * JSON-RPC id, so overlapping batches only cost round trips, not ordering.
   * Results always come back in the same order as `calls`.
   */
  async batchRequestChunked(calls, chunkSize = BATCH_SIZE, opts) {
    const chunks = [];
    for (let i = 0; i < calls.length; i += chunkSize) {
      chunks.push(calls.slice(i, i + chunkSize));
    }
    if (chunks.length <= 1) {
      return chunks.length ? this.batchRequest(chunks[0], opts) : [];
    }
    // Connect once up front so the workers don't race the failover handshake.
    await this.connect();
    const chunkResults = new Array(chunks.length);
    let next = 0;
    let firstError = null;
    const worker = async () => {
      // Stop claiming chunks once one has failed: preserves the sequential
      // version's short-circuit so a dead server isn't handed the rest of
      // the work. Chunks already in flight are simply awaited out.
      while (next < chunks.length && !firstError) {
        const index = next++;
        try {
          chunkResults[index] = await this.batchRequest(chunks[index], opts);
        } catch (e) {
          firstError = firstError || e;
        }
      }
    };
    // Workers swallow their own errors, so this never leaves an in-flight
    // sibling rejecting without a handler.
    await Promise.all(
      Array.from({length: Math.min(MAX_INFLIGHT_CHUNKS, chunks.length)}, () =>
        worker(),
      ),
    );
    if (firstError) {
      throw firstError;
    }
    const results = [];
    chunkResults.forEach(chunk => results.push(...chunk));
    return results;
  }
}

let sharedClient = null;
export const getElectrumClient = () => {
  if (!sharedClient) {
    sharedClient = new ElectrumClient();
  }
  return sharedClient;
};

// Electrum identifies outputs by scripthash: sha256(scriptPubKey), reversed.
export const addressToScripthash = address => {
  const script = bitcoin.address.toOutputScript(
    address,
    config.BITCOIN_NETWORK_STRING,
  );
  // eslint-disable-next-line no-undef
  return Buffer.from(bitcoin.crypto.sha256(script)).reverse().toString('hex');
};

/**
 * Same response shape as DokApi 'get_bitcoin_balances':
 * {status, data: {totalBalance, deriveAddresses: [{...item, balance}]}}
 * Balances are in satoshis.
 */
export const electrumFetchBitcoinBalances = async ({derive_addresses}) => {
  const client = getElectrumClient();
  const items = Array.isArray(derive_addresses) ? derive_addresses : [];
  const calls = items.map(item => ({
    method: 'blockchain.scripthash.get_balance',
    params: [addressToScripthash(item.address)],
  }));
  const results = await client.batchRequestChunked(calls);
  let totalBalance = 0;
  const deriveAddresses = items.map((item, i) => {
    const confirmed = Number(results[i]?.confirmed) || 0;
    const unconfirmed = Number(results[i]?.unconfirmed) || 0;
    const balance = Math.max(confirmed + unconfirmed, 0);
    totalBalance += balance;
    return {...item, balance: String(balance)};
  });
  return {
    status: 200,
    data: {totalBalance: String(totalBalance), deriveAddresses},
  };
};

/**
 * Same response shape as DokApi 'get_bitcoin_utxos':
 * {status, data: [{transaction_hash, index, value, address}]} (value in sats).
 */
export const electrumFetchBitcoinUTXO = async ({derive_addresses}) => {
  const client = getElectrumClient();
  const items = Array.isArray(derive_addresses) ? derive_addresses : [];
  const calls = items.map(item => ({
    method: 'blockchain.scripthash.listunspent',
    params: [addressToScripthash(item.address)],
  }));
  const results = await client.batchRequestChunked(calls);
  const data = [];
  items.forEach((item, i) => {
    (results[i] || []).forEach(utxo => {
      data.push({
        transaction_hash: utxo.tx_hash,
        index: utxo.tx_pos,
        value: Number(utxo.value),
        address: item.address,
      });
    });
  });
  return {status: 200, data};
};

/**
 * Same response shape as DokApi 'get_transaction_details': every input utxo
 * comes back enriched with either scriptpubkey (segwit → witnessUtxo) or
 * txhash (raw tx hex, legacy → nonWitnessUtxo), matching what buildUTXO in
 * BitcoinChain.js expects.
 */
export const electrumFetchBitcoinTransactionDetails = async ({
  transaction_data,
}) => {
  const client = getElectrumClient();
  const utxos = Array.isArray(transaction_data) ? transaction_data : [];
  // Every entry becomes a PSBT input in buildUTXO, while the caller's change
  // output is derived from the utxo total computed BEFORE this call. Dropping
  // an entry we cannot resolve would therefore under-fund the transaction, so
  // an unresolvable entry rejects the whole batch and the data-source wrapper
  // falls back to the API providers instead.
  const missingTxidAt = utxos.findIndex(utxo => !utxo?.txid);
  if (missingTxidAt !== -1) {
    throw new Error(
      `Electrum tx details: utxo at index ${missingTxidAt} has no txid`,
    );
  }
  const uniqueTxids = [...new Set(utxos.map(u => u.txid))];
  const calls = uniqueTxids.map(txid => ({
    method: 'blockchain.transaction.get',
    params: [txid],
  }));
  const rawTxs = await client.batchRequestChunked(calls);
  const rawByTxid = {};
  uniqueTxids.forEach((txid, i) => {
    rawByTxid[txid] = rawTxs[i];
  });

  const data = utxos.map(utxo => {
    const rawHex = rawByTxid[utxo.txid];
    const at = `${utxo.txid}:${utxo.vout}`;
    if (typeof rawHex !== 'string' || !rawHex) {
      throw new Error(
        `Electrum tx details: no raw transaction returned for ${at}`,
      );
    }
    let tx;
    try {
      tx = bitcoin.Transaction.fromHex(rawHex);
    } catch (e) {
      throw new Error(
        `Electrum tx details: undecodable raw transaction for ${at}: ${e?.message}`,
      );
    }
    const output = tx.outs[utxo.vout];
    if (!output?.script) {
      throw new Error(
        `Electrum tx details: vout ${utxo.vout} out of range for ${utxo.txid} (${tx.outs.length} outputs)`,
      );
    }
    const script = output.script;
    // P2PKH (legacy) needs the full previous tx; everything the wallet
    // creates otherwise (P2WPKH, P2SH-P2WPKH) works with witnessUtxo.
    const isP2pkh =
      script.length === 25 && script[0] === 0x76 && script[1] === 0xa9;
    if (isP2pkh) {
      return {...utxo, value: Number(output.value), txhash: rawHex};
    }
    return {
      ...utxo,
      value: Number(output.value),
      scriptpubkey: script.toString('hex'),
    };
  });
  return {status: 200, data};
};

// ---- Raw transaction plumbing (history / transaction details) ----

// Raw txs are immutable, so a bounded cache saves refetching the same
// transactions (and their inputs) on every history refresh.
const RAW_TX_CACHE_LIMIT = 500;
const rawTxCache = new Map();
const cacheRawTx = (txid, hex) => {
  if (rawTxCache.size >= RAW_TX_CACHE_LIMIT) {
    rawTxCache.delete(rawTxCache.keys().next().value);
  }
  rawTxCache.set(txid, hex);
};

const fetchRawTransactions = async (client, txids) => {
  const missing = txids.filter(txid => !rawTxCache.has(txid));
  const results = await client.batchRequestChunked(
    missing.map(txid => ({
      method: 'blockchain.transaction.get',
      params: [txid],
    })),
  );
  missing.forEach((txid, i) => {
    if (typeof results[i] === 'string') {
      cacheRawTx(txid, results[i]);
    }
  });
  const byTxid = {};
  txids.forEach(txid => {
    byTxid[txid] = rawTxCache.get(txid);
  });
  return byTxid;
};

const getTipHeight = async client => {
  const tip = await client.request('blockchain.headers.subscribe');
  return Number(tip?.height) || 0;
};

// Block timestamp: uint32LE at byte 68 of the 80-byte header.
const blockTimeCache = new Map();
const fetchBlockTimestamps = async (client, heights) => {
  const unique = [...new Set(heights.filter(height => height > 0))];
  const missing = unique.filter(height => !blockTimeCache.has(height));
  const results = await client.batchRequestChunked(
    missing.map(height => ({
      method: 'blockchain.block.header',
      params: [height],
    })),
  );
  missing.forEach((height, i) => {
    const hex = results[i];
    if (typeof hex === 'string' && hex.length >= 160) {
      // eslint-disable-next-line no-undef
      blockTimeCache.set(height, Buffer.from(hex, 'hex').readUInt32LE(68));
    }
  });
  const byHeight = {};
  unique.forEach(height => {
    byHeight[height] = blockTimeCache.get(height);
  });
  return byHeight;
};

const outputAddress = script => {
  try {
    return bitcoin.address.fromOutputScript(
      script,
      config.BITCOIN_NETWORK_STRING,
    );
  } catch (e) {
    return null;
  }
};

const isCoinbaseInput = input =>
  input.index === 0xffffffff && input.hash.every(byte => byte === 0);

/**
 * Builds Blockchair-dashboard-shaped transactions from raw Electrum data so
 * parseBlockchainTransactions (blockChair.js) computes amount/from/to/fee
 * with the exact same semantics as the API providers. Input values come from
 * each spent output's previous transaction. txidHeightPairs = [[txid, height]]
 * where height <= 0 means mempool.
 */
const buildBlockchairShapedTxs = async (client, txidHeightPairs) => {
  const txids = txidHeightPairs.map(([txid]) => txid);
  const rawByTxid = await fetchRawTransactions(client, txids);
  const parsedByTxid = {};
  const prevTxids = new Set();
  txids.forEach(txid => {
    const hex = rawByTxid[txid];
    if (!hex) {
      return;
    }
    const tx = bitcoin.Transaction.fromHex(hex);
    parsedByTxid[txid] = tx;
    tx.ins.forEach(input => {
      if (!isCoinbaseInput(input)) {
        // eslint-disable-next-line no-undef
        prevTxids.add(Buffer.from(input.hash).reverse().toString('hex'));
      }
    });
  });
  const prevRawByTxid = await fetchRawTransactions(client, [...prevTxids]);
  const timesByHeight = await fetchBlockTimestamps(
    client,
    txidHeightPairs.map(([, height]) => height),
  );

  // Parsing dominates the cost here and one previous tx is commonly spent by
  // several inputs, so parse each at most once. Failures are cached as null:
  // the hex cache accepts any string result, so a server that answers with
  // plain text instead of hex must not be re-parsed on every input.
  const parsedPrevCache = new Map();
  const getParsedPrev = prevTxid => {
    if (parsedPrevCache.has(prevTxid)) {
      return parsedPrevCache.get(prevTxid);
    }
    const prevHex = prevRawByTxid[prevTxid];
    let parsed = null;
    if (prevHex) {
      try {
        parsed = bitcoin.Transaction.fromHex(prevHex);
      } catch (e) {
        parsed = null;
      }
    }
    parsedPrevCache.set(prevTxid, parsed);
    return parsed;
  };

  return txidHeightPairs
    .filter(([txid]) => parsedByTxid[txid])
    .map(([txid, height]) => {
      const tx = parsedByTxid[txid];
      let inputTotal = 0;
      let hasAllInputs = true;
      const inputs = tx.ins.map(input => {
        if (isCoinbaseInput(input)) {
          return {recipient: null, value: 0};
        }
        // eslint-disable-next-line no-undef
        const prevTxid = Buffer.from(input.hash).reverse().toString('hex');
        const prevOut = getParsedPrev(prevTxid)?.outs?.[input.index];
        // Covers a missing, undecodable, or too-short previous tx alike: the
        // input's value is unknown, so drop the fee rather than report a
        // wrong one (history is read-only, so a partial tx still renders).
        if (!prevOut?.script) {
          hasAllInputs = false;
          return {recipient: null, value: 0};
        }
        const value = Number(prevOut.value);
        inputTotal += value;
        return {recipient: outputAddress(prevOut.script), value};
      });
      let outputTotal = 0;
      const outputs = tx.outs.map(output => {
        const value = Number(output.value);
        outputTotal += value;
        return {recipient: outputAddress(output.script), value};
      });
      const blockTime = timesByHeight[height];
      return {
        transaction: {
          hash: txid,
          fee: hasAllInputs ? Math.max(inputTotal - outputTotal, 0) : 0,
          // Mempool txs get "now" so they sort before confirmed ones.
          time: blockTime
            ? new Date(blockTime * 1000).toISOString()
            : new Date().toISOString(),
          block_id: height > 0 ? height : -1,
        },
        inputs,
        outputs,
      };
    });
};

const withConfirmations = (parsedTxs, tipHeight) =>
  parsedTxs.map(item => ({
    ...item,
    confirmations:
      item.blockNumber > 0 && tipHeight >= item.blockNumber
        ? tipHeight - item.blockNumber + 1
        : 0,
  }));

const TX_HISTORY_LIMIT = 20; // matches the Blockchair providers (limit: '20,0')

/**
 * Same output shape as BitcoinFork.getTransactions (Blockchair providers):
 * [{hash, timestamp, status, amount, fee, from, to, blockNumber,
 *   confirmations}], newest first, amounts in satoshis.
 */
export const electrumFetchBitcoinTransactions = async ({
  address,
  derive_addresses,
}) => {
  const client = getElectrumClient();
  const finalAddresses =
    Array.isArray(derive_addresses) && derive_addresses.length > 1
      ? derive_addresses
      : [address];
  const histories = await client.batchRequestChunked(
    finalAddresses.map(item => ({
      method: 'blockchain.scripthash.get_history',
      params: [addressToScripthash(item)],
    })),
  );
  const heightByTxid = new Map();
  histories.forEach(history => {
    (history || []).forEach(({tx_hash, height}) => {
      const known = heightByTxid.get(tx_hash);
      if (known === undefined || height > known) {
        heightByTxid.set(tx_hash, height);
      }
    });
  });
  // Mempool (height <= 0) first, then newest block first.
  const sortRank = height => (height <= 0 ? Number.MAX_SAFE_INTEGER : height);
  const txidHeightPairs = [...heightByTxid.entries()]
    .sort((a, b) => sortRank(b[1]) - sortRank(a[1]))
    .slice(0, TX_HISTORY_LIMIT);
  const [shaped, tipHeight] = await Promise.all([
    buildBlockchairShapedTxs(client, txidHeightPairs),
    getTipHeight(client),
  ]);
  return withConfirmations(
    parseBlockchainTransactions(shaped, finalAddresses),
    tipHeight,
  );
};

/**
 * Same output shape as BitcoinFork.getTransaction. Also works without wallet
 * addresses (waitForConfirmation passes only the txid): the confirmation
 * height is discovered from the history of the tx's own outputs.
 */
export const electrumGetTransaction = async ({
  transactionId,
  address,
  derive_addresses,
}) => {
  const client = getElectrumClient();
  const rawByTxid = await fetchRawTransactions(client, [transactionId]);
  const rawHex = rawByTxid[transactionId];
  if (!rawHex) {
    return null;
  }
  const tx = bitcoin.Transaction.fromHex(rawHex);
  let height = 0;
  for (const output of tx.outs) {
    const outAddr = outputAddress(output.script);
    if (!outAddr) {
      continue;
    }
    try {
      const history = await client.request(
        'blockchain.scripthash.get_history',
        [addressToScripthash(outAddr)],
      );
      const entry = (history || []).find(
        item => item.tx_hash === transactionId,
      );
      if (entry) {
        height = entry.height;
        break;
      }
    } catch (e) {
      // A busy address can exceed the server's history limit — try the
      // next output instead of failing the whole lookup.
    }
  }
  const finalAddresses = address
    ? Array.isArray(derive_addresses)
      ? derive_addresses
      : [address]
    : [];
  const [shaped, tipHeight] = await Promise.all([
    buildBlockchairShapedTxs(client, [[transactionId, height]]),
    getTipHeight(client),
  ]);
  const [parsedTx] = withConfirmations(
    parseBlockchainTransactions(shaped, finalAddresses),
    tipHeight,
  );
  return parsedTx || null;
};

/**
 * Address usage for BIP44 gap-limit discovery: true when the address has any
 * transaction history. Per-address server errors (e.g. history too large)
 * count as used.
 */
export const electrumFetchAddressUsage = async ({addresses}) => {
  const client = getElectrumClient();
  const list = Array.isArray(addresses) ? addresses : [];
  const results = await client.batchRequestChunked(
    list.map(address => ({
      method: 'blockchain.scripthash.get_history',
      params: [addressToScripthash(address)],
    })),
    BATCH_SIZE,
    {settleErrors: true},
  );
  // A server that fails EVERY call (rate limiting, overload) must not mark
  // the whole wallet "used" — that would ratchet the gap-limit extension on
  // every refresh. Abort instead; the caller skips this discovery round.
  if (list.length && results.every(result => result?.electrumError)) {
    throw new Error('Electrum usage scan failed for all addresses');
  }
  const usage = {};
  list.forEach((address, i) => {
    const result = results[i];
    // A lone per-address error among successes means "history too large",
    // which implies the address is used.
    usage[address] = Array.isArray(result)
      ? result.length > 0
      : !!result?.electrumError;
  });
  return usage;
};

/** Broadcast a signed transaction. Returns the txid. */
export const electrumBroadcastTransaction = async ({txHex}) => {
  const client = getElectrumClient();
  // Witnesses are excluded from the txid, so the bytes we send fully determine
  // the id a conformant server must answer with.
  const expectedTxid = bitcoin.Transaction.fromHex(txHex).getId();
  const result = await client.request('blockchain.transaction.broadcast', [
    txHex,
  ]);
  // Some public Electrum servers return rejection text as the RESULT instead
  // of a JSON-RPC error (BlueWallet guards this the same way) — only a
  // 64-hex txid counts as success.
  if (typeof result !== 'string' || !/^[0-9a-f]{64}$/i.test(result)) {
    throw new Error(
      `Electrum broadcast rejected: ${
        typeof result === 'string' ? result : JSON.stringify(result)
      }`,
    );
  }
  // A well-formed id that is not OUR id means the server did not broadcast
  // what we asked. Returning it would have the wallet track a transaction
  // that does not exist; throwing instead lets the caller fall back to the
  // API providers. Worth checking because the TLS here accepts self-signed
  // certificates, so the peer is not authenticated.
  if (result.toLowerCase() !== expectedTxid.toLowerCase()) {
    throw new Error(
      `Electrum broadcast returned txid ${result}, expected ${expectedTxid}`,
    );
  }
  return result;
};

/** Fee rate in sat/vB for ~`blocks` confirmation target. */
export const electrumGetFeeRate = async ({blocks = 2} = {}) => {
  const client = getElectrumClient();
  const btcPerKb = await client.request('blockchain.estimatefee', [blocks]);
  if (!btcPerKb || btcPerKb <= 0) {
    // Throw so the data-source wrapper falls back to the API providers.
    throw new Error('Electrum fee estimate unavailable');
  }
  return Math.max(1, Math.round((btcPerKb * 1e8) / 1000));
};
