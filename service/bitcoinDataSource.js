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

export const broadcastBitcoinTransaction = withFallback(
  electrumBroadcastTransaction,
  ({txHex}) => BitcoinFork.createTransaction({chain: 'btc', txHex}),
  'broadcast',
  'broadcast',
);

export const fetchBitcoinFeeRate = withFallback(
  electrumGetFeeRate,
  () => BitcoinFork.getTransactionFees({chain: 'btc'}),
  'fee rate',
  'feerate',
);
