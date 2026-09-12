import {config} from 'dok-wallet-blockchain-networks/config/config';
import {createProviderClient} from 'dok-wallet-blockchain-networks/config/providerClient';

export const STAKE_WIZ_API = createProviderClient({
  baseURL: config.STAKE_WIZ_BASE_URL,
});
