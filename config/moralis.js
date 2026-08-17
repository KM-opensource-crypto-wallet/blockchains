import Moralis from 'moralis';
import {config} from 'dok-wallet-blockchain-networks/config/config';

let moralisStarted = null;

// Starts Moralis on first use instead of at import time, so the SDK stays out
// of the startup path. Resolves with the ready-to-use Moralis instance.
export const getMoralis = () => {
  if (!moralisStarted) {
    moralisStarted = Moralis.start({
      apiKey: config.MORALIS_API_KEY,
    }).then(() => Moralis);
  }
  return moralisStarted;
};
