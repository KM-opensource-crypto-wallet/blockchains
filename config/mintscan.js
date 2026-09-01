import {config} from 'dok-wallet-blockchain-networks/config/config';
import {createProviderClient} from 'dok-wallet-blockchain-networks/config/providerClient';

export const COSMOS_REST_API = createProviderClient({
  baseURL: config.COSMOS_REST_BASE_URL,
});
