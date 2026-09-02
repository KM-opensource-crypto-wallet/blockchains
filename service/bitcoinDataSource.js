import * as bitcoin from 'bitcoinjs-lib';
import {
  fetchBitcoinBalances as dokFetchBitcoinBalances,
  fetchBitcoinUTXO as dokFetchBitcoinUTXO,
  fetchBitcoinTransactionDetails as dokFetchBitcoinTransactionDetails,
} from 'dok-wallet-blockchain-networks/service/dokApi';
import {BitcoinFork} from 'dok-wallet-blockchain-networks/service/bitcoinFork';
import {
  isElectrumQueryAvailable,
  runElectrumQuery,
} from 'utils/electrumTransport';

/**
 * Bitcoin data source: Electrum first, DokApi backend as fallback.
 *
 * How an Electrum query actually travels is the app's business, not this
 * module's — `utils/electrumTransport` is a direct TLS socket on mobile and an
 * /api/bitcoin round trip in the browser. Hence no platform checks here.
 */

// The availability gate matters: when there is no transport at all, DokApi must
// be reached without first paying a connect timeout per Electrum server.
const withFallback =
  (op, dokFn, label = op) =>
  async payload => {
    if (isElectrumQueryAvailable()) {
      try {
        return await runElectrumQuery(op, payload);
      } catch (e) {
        console.warn(
          `Electrum ${label} failed, falling back to API:`,
          e?.message,
        );
      }
    }
    return dokFn(payload);
  };

export const fetchBitcoinBalances = withFallback(
  'balances',
  dokFetchBitcoinBalances,
);

export const fetchBitcoinUTXO = withFallback('utxo', dokFetchBitcoinUTXO);

export const fetchBitcoinTransactionDetails = withFallback(
  'txdetails',
  dokFetchBitcoinTransactionDetails,
  'transaction details',
);

export const fetchBitcoinTransactions = withFallback(
  'transactions',
  ({address, derive_addresses}) =>
    BitcoinFork.getTransactions({chain: 'btc', address, derive_addresses}),
);

export const fetchBitcoinTransaction = withFallback(
  'transaction',
  ({transactionId, address, derive_addresses}) =>
    BitcoinFork.getTransaction({
      chain: 'btc',
      transactionId,
      address,
      derive_addresses,
    }),
);

// A retry can race a broadcast that actually landed (timeout after the
// server accepted). Both attempts push the SAME signed bytes, so an
// "already known" rejection means success — return the tx's own id, the
// same idempotency rule the Tron/EVM chains follow.
const ALREADY_KNOWN_RE =
  /already in (the )?(block ?chain|mempool)|txn-already-known|already exists|already_exists|duplicate transaction/i;

const isAlreadyKnownError = e =>
  ALREADY_KNOWN_RE.test(e?.message || e?.response?.data?.message || '');

// "Inputs missing or spent" is ambiguous: the inputs are gone either because
// THIS tx already spent them (the broadcast landed) or because a conflicting
// tx did (a double spend, which will never confirm). The message alone cannot
// tell those apart, so it must never count as success on its own.
const MISSING_INPUTS_RE = /bad-txns-inputs-missingorspent|missing inputs/i;

const isMissingInputsError = e =>
  MISSING_INPUTS_RE.test(e?.message || e?.response?.data?.message || '');

const isTxOnNetwork = async transactionId => {
  try {
    return !!(await fetchBitcoinTransaction({transactionId}));
  } catch (lookupError) {
    // A failed lookup proves nothing; never let it mask the broadcast error.
    console.warn(
      'Bitcoin broadcast recovery lookup failed:',
      lookupError?.message,
    );
    return false;
  }
};

// True only when the signed bytes are already known to the network, so the
// caller can treat the rejection as the success it actually is.
const hasBroadcastLanded = async (e, expectedTxid) =>
  isAlreadyKnownError(e) ||
  (isMissingInputsError(e) && (await isTxOnNetwork(expectedTxid)));

export const broadcastBitcoinTransaction = async ({txHex}) => {
  const expectedTxid = bitcoin.Transaction.fromHex(txHex).getId();
  if (isElectrumQueryAvailable()) {
    try {
      return await runElectrumQuery('broadcast', {txHex});
    } catch (e) {
      if (await hasBroadcastLanded(e, expectedTxid)) {
        return expectedTxid;
      }
      console.warn(
        'Electrum broadcast failed, falling back to API:',
        e?.message,
      );
    }
  }
  try {
    const resp = await BitcoinFork.createTransaction({chain: 'btc', txHex});
    // The provider retry wrapper returns a null default on failure; the tx
    // may still be known to the network from the Electrum attempt, so only
    // a real txid counts.
    if (typeof resp === 'string' && resp.length > 0) {
      return resp;
    }
    throw new Error('Bitcoin broadcast failed');
  } catch (e) {
    if (await hasBroadcastLanded(e, expectedTxid)) {
      return expectedTxid;
    }
    throw e;
  }
};

// Address usage (does this address have any history?) drives the legacy-window
// prune and the BIP44 gap-limit walk. Kept as its own domain-named export so
// BitcoinChain never reaches for a transport, and because it stops being a
// synonym for isElectrumQueryAvailable the day the backend gains an
// address-usage endpoint of its own.
export const isAddressUsageScanAvailable = isElectrumQueryAvailable;

// No silent empty result: an unavailable or failing scan must reject, because
// `{}` would read as "no address is used" and wrongly prune the legacy window.
// The callers in BitcoinChain treat a rejection as "nothing resolved, retry on
// the next refresh".
export const fetchBitcoinAddressUsage = async ({addresses}) => {
  if (!isElectrumQueryAvailable()) {
    throw new Error('bitcoin address usage scan unavailable');
  }
  return runElectrumQuery('addressusage', {addresses});
};

export const fetchBitcoinFeeRate = withFallback(
  'feerate',
  () => BitcoinFork.getTransactionFees({chain: 'btc'}),
  'fee rate',
);
