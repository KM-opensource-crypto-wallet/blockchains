import Moralis from 'moralis';
import {
  buildScanProxyUrl,
  installRpcSessionForMoralis,
} from 'dok-wallet-blockchain-networks/rpcUrls/rpcSession';

let moralisStarted = null;

// Starts Moralis on first use instead of at import time, so the SDK stays out
// of the startup path. Resolves with the ready-to-use Moralis instance.
// The SDK is pointed at the worker proxy, which injects the real API key.
// The SDK dispatches over the axios instance.
export const getMoralis = () => {
  if (!moralisStarted) {
    installRpcSessionForMoralis();
    moralisStarted = Moralis.start({
      apiKey: 'proxied',
      evmApiBaseUrl: buildScanProxyUrl('moralis'),
      solApiBaseUrl: buildScanProxyUrl('moralis_solana'),
    }).then(() => Moralis);
  }
  return moralisStarted;
};
