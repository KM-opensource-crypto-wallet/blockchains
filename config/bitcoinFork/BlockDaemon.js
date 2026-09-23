import {createProviderClient} from 'dok-wallet-blockchain-networks/config/providerClient';

export const BlockDaemonAPI = createProviderClient({
  proxy: 'blockdaemon',
  scan: true,
});
