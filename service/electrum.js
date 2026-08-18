import * as bitcoin from 'bitcoinjs-lib';
import {
  config,
  IS_SANDBOX,
  isWeb,
} from 'dok-wallet-blockchain-networks/config/config';

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
      {host: 'mainnet.foundationdevices.com', port: 50002},
      {host: 'electrum1.bluewallet.io', port: 443},
      {host: 'electrum.blockstream.info', port: 50002},
    ];

const REQUEST_TIMEOUT_MS = 30000;
const BATCH_SIZE = 100;

// Lazily required so the web/desktop bundle (no native TCP) keeps working.
let tcpSocketModule;
const getTcpSocket = () => {
  if (tcpSocketModule !== undefined) {
    return tcpSocketModule;
  }
  try {
    tcpSocketModule = require('react-native-tcp-socket').default;
  } catch (e) {
    tcpSocketModule = null;
  }
  return tcpSocketModule;
};

export const isElectrumAvailable = () => !isWeb && !!getTcpSocket();

const defaultSocketFactory = ({host, port}, onConnect) => {
  const TcpSocket = getTcpSocket();
  return TcpSocket.createConnection(
    {
      host,
      port,
      tls: true,
      // Electrum servers commonly use self-signed certificates
      // (BlueWallet accepts them the same way).
      tlsCheckValidity: false,
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
    if (this.socket) {
      return;
    }
    if (this.connectPromise) {
      return this.connectPromise;
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

  _send(method, params) {
    const id = this.nextId++;
    const promise = this._registerRequest(id);
    this.socket.write(
      JSON.stringify({jsonrpc: '2.0', id, method, params}) + '\n',
    );
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
  async batchRequest(calls) {
    if (!calls.length) {
      return [];
    }
    await this.connect();
    const payload = [];
    const promises = [];
    for (const {method, params} of calls) {
      const id = this.nextId++;
      promises.push(this._registerRequest(id));
      payload.push({jsonrpc: '2.0', id, method, params});
    }
    this.socket.write(JSON.stringify(payload) + '\n');
    return Promise.all(promises);
  }

  async batchRequestChunked(calls, chunkSize = BATCH_SIZE) {
    const results = [];
    for (let i = 0; i < calls.length; i += chunkSize) {
      const chunk = calls.slice(i, i + chunkSize);
      results.push(...(await this.batchRequest(chunk)));
    }
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
    const tx = bitcoin.Transaction.fromHex(rawHex);
    const output = tx.outs[utxo.vout];
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

/** Broadcast a signed transaction. Returns the txid. */
export const electrumBroadcastTransaction = async ({txHex}) => {
  const client = getElectrumClient();
  return client.request('blockchain.transaction.broadcast', [txHex]);
};

/** Fee rate in sat/vB for ~`blocks` confirmation target. */
export const electrumGetFeeRate = async ({blocks = 2} = {}) => {
  const client = getElectrumClient();
  const btcPerKb = await client.request('blockchain.estimatefee', [blocks]);
  if (!btcPerKb || btcPerKb <= 0) {
    return null;
  }
  return Math.max(1, Math.round((btcPerKb * 1e8) / 1000));
};
