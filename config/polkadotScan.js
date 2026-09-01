import {createProviderClient} from 'dok-wallet-blockchain-networks/config/providerClient';

export const PolkadotScanApi = createProviderClient({
  proxy: 'polkadot',
  scan: true,
});
