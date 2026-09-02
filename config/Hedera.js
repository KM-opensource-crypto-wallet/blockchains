import {config} from 'dok-wallet-blockchain-networks/config/config';
import {createProviderClient} from 'dok-wallet-blockchain-networks/config/providerClient';

export const HEDERA_API = createProviderClient({
  baseURL: config.HEDERA_BASE_URL,
});
