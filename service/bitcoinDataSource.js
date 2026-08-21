import * as bitcoin from 'bitcoinjs-lib';
import {
  fetchBitcoinBalances as dokFetchBitcoinBalances,
  fetchBitcoinUTXO as dokFetchBitcoinUTXO,
  fetchBitcoinTransactionDetails as dokFetchBitcoinTransactionDetails,
} from 'dok-wallet-blockchain-networks/service/dokApi';
import {
  isElectrumAvailable,
  electrumFetchBitcoinBalances,
  electrumFetchBitcoinUTXO,
  electrumFetchBitcoinTransactionDetails,
  electrumFetchBitcoinTransactions,
  electrumGetTransaction,
  electrumBroadcastTransaction,
  electrumGetFeeRate,
} from 'dok-wallet-blockchain-networks/service/electrum';
import {BitcoinFork} from 'dok-wallet-blockchain-networks/service/bitcoinFork';
import {isWeb} from 'dok-wallet-blockchain-networks/config/config';
import {callWebElectrum} from 'dok-wallet-blockchain-networks/service/bitcoinWebElectrum';

/**
 * Bitcoin data source: Electrum first (direct server connection, like
 * BlueWallet), DokApi backend as fallback and on web where raw TCP
 * sockets are unavailable.
 */

const isBrowser = () => typeof window !== 'undefined';

// `op` names the operation for the web bridge (see bitcoinWebElectrum).
// Web (browser): own server -> BlueWallet via /api/bitcoin, then dokFn.
// Native (mobile): direct Electrum sockets, then dokFn.
const withFallback = (electrumFn, dokFn, label, op) => async payload => {
  if (isWeb && isBrowser()) {
    try {
      return await callWebElectrum(op, payload);
    } catch (e) {
      console.warn(
        `Web Electrum ${label} failed, falling back to API:`,
        e?.message,
      );
    }
    return dokFn(payload);
  }
  if (isElectrumAvailable()) {
    try {
      return await electrumFn(payload);
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
  electrumFetchBitcoinBalances,
  dokFetchBitcoinBalances,
  'balances',
  'balances',
);

export const fetchBitcoinUTXO = withFallback(
  electrumFetchBitcoinUTXO,
  dokFetchBitcoinUTXO,
  'utxo',
  'utxo',
);

export const fetchBitcoinTransactionDetails = withFallback(
  electrumFetchBitcoinTransactionDetails,
  dokFetchBitcoinTransactionDetails,
  'transaction details',
  'txdetails',
);

export const fetchBitcoinTransactions = withFallback(
  electrumFetchBitcoinTransactions,
  ({address, derive_addresses}) =>
    BitcoinFork.getTransactions({chain: 'btc', address, derive_addresses}),
  'transactions',
  'transactions',
);

export const fetchBitcoinTransaction = withFallback(
  electrumGetTransaction,
  ({transactionId, address, derive_addresses}) =>
    BitcoinFork.getTransaction({
      chain: 'btc',
      transactionId,
      address,
      derive_addresses,
    }),
  'transaction',
  'transaction',
);

// A retry can race a broadcast that actually landed (timeout after the
// server accepted). Both attempts push the SAME signed bytes, so an
// "already known" rejection means success — return the tx's own id, the
// same idempotency rule the Tron/EVM chains follow.
const ALREADY_KNOWN_RE =
  /already in (the )?(block ?chain|mempool)|txn-already-known|already exists|already_exists|duplicate transaction/i;

const isAlreadyKnownError = e =>
  ALREADY_KNOWN_RE.test(e?.message || e?.response?.data?.message || '');

export const broadcastBitcoinTransaction = async ({txHex}) => {
  const expectedTxid = bitcoin.Transaction.fromHex(txHex).getId();
  if (isWeb && isBrowser()) {
    try {
      return await callWebElectrum('broadcast', {txHex});
    } catch (e) {
      if (isAlreadyKnownError(e)) {
        return expectedTxid;
      }
      console.warn(
        'Web Electrum broadcast failed, falling back to API:',
        e?.message,
      );
    }
  } else if (isElectrumAvailable()) {
    try {
      return await electrumBroadcastTransaction({txHex});
    } catch (e) {
      if (isAlreadyKnownError(e)) {
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
    if (isAlreadyKnownError(e)) {
      return expectedTxid;
    }
    throw e;
  }
};

export const fetchBitcoinFeeRate = withFallback(
  electrumGetFeeRate,
  () => BitcoinFork.getTransactionFees({chain: 'btc'}),
  'fee rate',
  'feerate',
);
