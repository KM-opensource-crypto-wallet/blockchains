import axios from 'axios';
import {
  buildScanProxyUrl,
  rpcSessionAdapter,
} from 'dok-wallet-blockchain-networks/rpcUrls/rpcSession';

export const BlockDaemonAPI = axios.create({
  baseURL: buildScanProxyUrl('blockdaemon'),
  headers: {
    'Content-Type': 'application/json',
  },
  adapter: rpcSessionAdapter,
  timeout: 30000,
});
