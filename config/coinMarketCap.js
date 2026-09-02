import {createProviderClient} from 'dok-wallet-blockchain-networks/config/providerClient';

export const CoinMarketCapAPI = createProviderClient({
  proxy: 'coinmarketcap',
  scan: true,
});
