import {createProviderClient} from 'dok-wallet-blockchain-networks/config/providerClient';

export const LitecoinSpaceAPI = createProviderClient({
  baseURL: 'https://litecoinspace.org/api',
});
