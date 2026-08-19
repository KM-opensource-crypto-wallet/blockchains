import axios from 'axios';
import {
  buildScanProxyUrl,
  rpcSessionAdapter,
} from 'dok-wallet-blockchain-networks/rpcUrls/rpcSession';

export const PolkadotScanApi = axios.create({
  baseURL: buildScanProxyUrl('polkadot'),
  headers: {
    'Content-Type': 'application/json',
  },
  adapter: rpcSessionAdapter,
  timeout: 30000,
});
