import axios from 'axios';
import {
  buildScanProxyUrl,
  rpcSessionAdapter,
} from 'dok-wallet-blockchain-networks/rpcUrls/rpcSession';

export const CoinMarketCapAPI = axios.create({
  baseURL: buildScanProxyUrl('coinmarketcap'),
  headers: {
    'Content-Type': 'application/json',
  },
  adapter: rpcSessionAdapter,
  timeout: 30000,
});
