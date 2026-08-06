import axios from 'axios';
import {
  buildRpcProxyUrl,
  rpcSessionAdapter,
} from 'dok-wallet-blockchain-networks/rpcUrls/rpcSession';

const proxyBaseUrl = buildRpcProxyUrl('ton');

export const TonScanAPI = axios.create({
  baseURL: proxyBaseUrl,
  headers: {'Content-Type': 'application/json'},
  adapter: rpcSessionAdapter,
  timeout: 30000,
});
