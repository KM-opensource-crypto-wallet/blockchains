import {config} from 'dok-wallet-blockchain-networks/config/config';
import {createProviderClient} from 'dok-wallet-blockchain-networks/config/providerClient';

export const BitcoinMempoolAPI = createProviderClient({
  baseURL: config.BITCOIN_BASE_URL,
});
