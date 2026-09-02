import {createProviderClient} from 'dok-wallet-blockchain-networks/config/providerClient';

export const TonScanAPI = createProviderClient({proxy: 'ton', scan: true});
