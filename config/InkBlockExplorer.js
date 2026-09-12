import {config} from 'dok-wallet-blockchain-networks/config/config';
import {createProviderClient} from 'dok-wallet-blockchain-networks/config/providerClient';

export const InkBlockExplorerAPI = createProviderClient({
  baseURL: config.INK_BLOCK_EXPLORER_BASE_URL,
});
