import {config} from 'dok-wallet-blockchain-networks/config/config';
import {createProviderClient} from 'dok-wallet-blockchain-networks/config/providerClient';

export const FilScanApi = createProviderClient({
  baseURL: config.FILSCAN_API_BASE_URL,
});
