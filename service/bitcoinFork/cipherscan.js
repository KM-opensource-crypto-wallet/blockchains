import {CipherscanAPI} from 'dok-wallet-blockchain-networks/config/bitcoinFork/cipherscan';

const toParsedTransaction = (tx, walletAddress) => {
  const isOutgoing = Number(tx?.inputValue) > 0 || Number(tx?.netChange) < 0;
  return {
    hash: tx?.txid,
    timestamp: tx?.blockTime ? new Date(Number(tx.blockTime) * 1000) : null,
    status: Number(tx?.blockHeight) > 0,
    amount: Math.abs(Number(tx?.netChange ?? tx?.outputValue ?? 0)).toString(),
    from: isOutgoing ? walletAddress : null,
    to: isOutgoing ? null : walletAddress,
    blockNumber: tx?.blockHeight ? Number(tx.blockHeight) : null,
    confirmations: null,
  };
};

// Cipherscan paginates with `page`/`limit` (1-100, no `total`/`hasMore` field
// per its docs), so a short page is the only exhaustion signal; MAX_PAGES is
// just a safety cap against the API ever returning full pages forever.
const MAX_PAGES = 50;
const PAGE_LIMIT = 100;

// Cipherscan enforces 100 requests/minute per client across every endpoint,
// so UTXO discovery's two request sources -- `/address` pagination and the
// per-tx `/tx/:txid` details -- have to draw from one budget. Pacing them
// separately still bursts past the limit (a wallet deep enough to paginate
// spends most of the budget before the first detail fetch is even issued),
// and a 429 mid-discovery would abort the whole UTXO set. Every request
// goes through `limitedRequest`, which holds the caller until the oldest of
// the last RATE_LIMIT_PER_MINUTE timestamps has aged out of the window.
const RATE_LIMIT_PER_MINUTE = 100;
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_BATCH_SIZE = 20;
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

const requestTimestamps = [];

// The check-and-record below is synchronous, so concurrent callers within a
// batch can't claim the same slot; a caller that has to wait re-checks on
// wake rather than assuming its slot survived.
const acquireRequestSlot = async () => {
  for (;;) {
    const now = Date.now();
    while (
      requestTimestamps.length &&
      now - requestTimestamps[0] >= RATE_LIMIT_WINDOW_MS
    ) {
      requestTimestamps.shift();
    }
    if (requestTimestamps.length < RATE_LIMIT_PER_MINUTE) {
      requestTimestamps.push(now);
      return;
    }
    await sleep(RATE_LIMIT_WINDOW_MS - (now - requestTimestamps[0]));
  }
};

const limitedRequest = async requestFn => {
  await acquireRequestSlot();
  return requestFn();
};

const fetchTransactionDetails = async transactions => {
  const details = [];
  // Batching now bounds how many requests are in flight at once; the shared
  // limiter is what spaces them out.
  for (let i = 0; i < transactions.length; i += RATE_LIMIT_BATCH_SIZE) {
    const batch = transactions.slice(i, i + RATE_LIMIT_BATCH_SIZE);
    const batchDetails = await Promise.all(
      batch.map(tx =>
        limitedRequest(() => CipherscanAPI.get(`/tx/${tx.txid}`)).then(
          r => r?.data,
        ),
      ),
    );
    details.push(...batchDetails);
  }
  return details;
};

const fetchAllTransactions = async address => {
  const transactions = [];
  let page = 1;
  while (page <= MAX_PAGES) {
    const resp = await limitedRequest(() =>
      CipherscanAPI.get(`/address/${address}`, {
        params: {limit: PAGE_LIMIT, page},
      }),
    );
    const pageTransactions = Array.isArray(resp?.data?.transactions)
      ? resp.data.transactions
      : [];
    transactions.push(...pageTransactions);
    if (pageTransactions.length < PAGE_LIMIT) {
      break;
    }
    // A full page at the cap means there are more transactions we haven't
    // read. Returning here would hand back a partial list, which getUTXO
    // would turn into a silently under-reported spendable balance.
    if (page === MAX_PAGES) {
      throw new Error(
        `Cipherscan returned ${MAX_PAGES} full pages of transactions for ${address}; refusing to return a partial transaction list`,
      );
    }
    page += 1;
  }
  return transactions;
};

export const Cipherscan = {
  getBalance: async ({address}) => {
    const resp = await CipherscanAPI.get(`/address/${address}`);
    return String(resp?.data?.balance ?? 0);
  },

  getTransactions: async ({address}) => {
    const resp = await CipherscanAPI.get(`/address/${address}`, {
      params: {limit: 25},
    });
    const transactions = Array.isArray(resp?.data?.transactions)
      ? resp.data.transactions
      : [];
    return transactions
      .map(tx => toParsedTransaction(tx, address))
      .sort(
        (a, b) => (b.timestamp?.getTime() || 0) - (a.timestamp?.getTime() || 0),
      );
  },

  // Cipherscan has no dedicated UTXO endpoint: per-tx detail (`/tx/:txid`)
  // returns each output's `spent` flag, so a UTXO set is built by listing
  // every one of the address's transactions (paginated to exhaustion), then
  // checking each one's outputs for an unspent match. A failed detail fetch
  // is left to propagate rather than swallowed, since a UTXO set silently
  // missing entries would let coin selection under-report spendable funds.
  getUTXO: async ({address}) => {
    const transactions = await fetchAllTransactions(address);
    const details = await fetchTransactionDetails(transactions);
    const utxos = [];
    details.forEach(detail => {
      const outputs = Array.isArray(detail?.outputs) ? detail.outputs : [];
      outputs.forEach(output => {
        if (output?.address === address && output?.spent === false) {
          utxos.push({
            hash: detail.txid,
            value: Number(output.value),
            vout: output.vout_index,
          });
        }
      });
    });
    return utxos;
  },

  getTransaction: async ({transactionId, address}) => {
    const resp = await CipherscanAPI.get(`/tx/${transactionId}`);
    const tx = resp?.data;
    if (!tx) return null;
    const inputs = Array.isArray(tx.inputs) ? tx.inputs : [];
    const outputs = Array.isArray(tx.outputs) ? tx.outputs : [];
    // An output paying our own address is only the recipient when we didn't
    // also sign an input -- otherwise it's the change from our own spend, so
    // direction has to be decided from the inputs, not just an output match.
    const isOutgoing = address
      ? inputs.some(i => i?.address === address)
      : false;
    const externalOutput = outputs.find(o => o?.address !== address);
    const ourOutput = outputs.find(o => o?.address === address);
    return {
      hash: tx.txid,
      timestamp: tx.blockTime ? new Date(Number(tx.blockTime) * 1000) : null,
      status: tx.status === 'confirmed' || Number(tx.confirmations) > 0,
      amount: isOutgoing
        ? String(externalOutput?.value ?? tx.totalOutputZat ?? 0)
        : String(ourOutput?.value ?? tx.totalOutputZat ?? 0),
      from: isOutgoing ? address : inputs[0]?.address ?? null,
      to: isOutgoing ? externalOutput?.address ?? null : address ?? null,
      blockNumber: tx.blockHeight ? Number(tx.blockHeight) : null,
      confirmations: tx.confirmations ?? null,
    };
  },

  // `txid` field name confirmed against a live broadcast rejection (Cipherscan
  // returns HTTP 400 + {success:false, error:"..."} for a rejected tx, which
  // axios throws for -- caught below and re-thrown with that reason attached,
  // since the caller otherwise has no way to know why the network rejected
  // the transaction).
  createTransaction: async ({txHex}) => {
    try {
      const resp = await CipherscanAPI.post('/tx/broadcast', {rawTx: txHex});
      const txid = resp?.data?.txid;
      if (!txid) {
        throw new Error(
          resp?.data?.error || 'Broadcast succeeded but no txid was returned',
        );
      }
      return txid;
    } catch (e) {
      const reason = e?.response?.data?.error || e?.message;
      throw new Error(
        `Failed to broadcast zcash transaction${reason ? `: ${reason}` : ''}`,
      );
    }
  },
};
