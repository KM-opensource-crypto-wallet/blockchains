import {config} from 'dok-wallet-blockchain-networks/config/config';
import {createProviderClient} from 'dok-wallet-blockchain-networks/config/providerClient';

export const EthereumClassicScanAPI = createProviderClient({
  baseURL: config.ETHEREUM_CLASSIC_SCAN_API_URL,
});
