import {createProviderClient} from 'dok-wallet-blockchain-networks/config/providerClient';

export const BchMempoolAPI = createProviderClient({
  baseURL: 'https://bchmempool.cash/api',
});
