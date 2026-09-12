import {config} from 'dok-wallet-blockchain-networks/config/config';
import {createProviderClient} from 'dok-wallet-blockchain-networks/config/providerClient';

export const TZKTAPI = createProviderClient({
  baseURL: config.TZKT_API_BASE_URL,
});
