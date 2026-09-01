import {config} from 'dok-wallet-blockchain-networks/config/config';
import {createProviderClient} from 'dok-wallet-blockchain-networks/config/providerClient';

export const BlockCypherAPI = createProviderClient({
  baseURL: config.BLOCK_CYPHER_BASE_URL,
});
