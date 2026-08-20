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

/**
 * Bitcoin data source: Electrum first (direct server connection, like
 * BlueWallet), DokApi backend as fallback and on web where raw TCP
 * sockets are unavailable.
 */

const withFallback = (electrumFn, dokFn, label) => async payload => {
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
);

export const fetchBitcoinUTXO = withFallback(
  electrumFetchBitcoinUTXO,
  dokFetchBitcoinUTXO,
  'utxo',
);

export const fetchBitcoinTransactionDetails = withFallback(
  electrumFetchBitcoinTransactionDetails,
  dokFetchBitcoinTransactionDetails,
  'transaction details',
);

export const fetchBitcoinTransactions = withFallback(
  electrumFetchBitcoinTransactions,
  ({address, derive_addresses}) =>
    BitcoinFork.getTransactions({chain: 'btc', address, derive_addresses}),
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
);

export const broadcastBitcoinTransaction = withFallback(
  electrumBroadcastTransaction,
  ({txHex}) => BitcoinFork.createTransaction({chain: 'btc', txHex}),
  'broadcast',
);

export const fetchBitcoinFeeRate = withFallback(
  electrumGetFeeRate,
  () => BitcoinFork.getTransactionFees({chain: 'btc'}),
  'fee rate',
);
