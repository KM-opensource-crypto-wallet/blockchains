import {createProviderClient} from 'dok-wallet-blockchain-networks/config/providerClient';

export const BlockScoutAPI = createProviderClient({
  proxy: 'blockscout',
  scan: true,
});
