import {config} from 'dok-wallet-blockchain-networks/config/config';
import {createProviderClient} from 'dok-wallet-blockchain-networks/config/providerClient';

export const VicScanAPI = createProviderClient({
  baseURL: config.VICTION_SCAN_API_URL,
});
