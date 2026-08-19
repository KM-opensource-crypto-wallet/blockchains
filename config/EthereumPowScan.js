import axios from 'axios';
import {
  buildScanProxyUrl,
  rpcSessionAdapter,
} from 'dok-wallet-blockchain-networks/rpcUrls/rpcSession';

export const EthereumPowScanAPI = axios.create({
  baseURL: buildScanProxyUrl('ethereum_pow'),
  headers: {
    'Content-Type': 'application/json',
  },
  adapter: rpcSessionAdapter,
  timeout: 30000,
});
