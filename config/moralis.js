import Moralis from 'moralis';
import {config} from 'dok-wallet-blockchain-networks/config/config';

Moralis.start({
  apiKey: config.MORALIS_API_KEY,
  // ...and any other configuration
}).then();
