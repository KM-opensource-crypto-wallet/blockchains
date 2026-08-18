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
} from 'dok-wallet-blockchain-networks/service/electrum';

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
