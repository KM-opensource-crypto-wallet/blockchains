import {createProviderClient} from 'dok-wallet-blockchain-networks/config/providerClient';

export const TronScanAPI = createProviderClient({proxy: 'tron', scan: true});
