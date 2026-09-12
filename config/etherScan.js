import {config} from 'dok-wallet-blockchain-networks/config/config';
import {createProviderClient} from 'dok-wallet-blockchain-networks/config/providerClient';

export const EtherScanAPIFree = createProviderClient({
  baseURL: config.ETHEREUM_SCAN_BASE_URL,
});

export const EtherScanAPI = createProviderClient({
  proxy: 'etherscan',
  scan: true,
});
