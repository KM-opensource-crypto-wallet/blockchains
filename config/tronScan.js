import axios from 'axios';
import {
  buildScanProxyUrl,
  rpcSessionAdapter,
} from 'dok-wallet-blockchain-networks/rpcUrls/rpcSession';

export const TronScanAPI = axios.create({
  baseURL: buildScanProxyUrl('tron'),
  headers: {
    'Content-Type': 'application/json',
    'x-rpc-type': 'scan',
  },
  adapter: rpcSessionAdapter,
  timeout: 30000,
});
