import {createProviderClient} from 'dok-wallet-blockchain-networks/config/providerClient';

export const EthereumPowScanAPI = createProviderClient({
  proxy: 'ethereum_pow',
  scan: true,
});
