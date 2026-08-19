import axios from 'axios';
import {config} from 'dok-wallet-blockchain-networks/config/config';
import {
  buildScanProxyUrl,
  rpcSessionAdapter,
} from 'dok-wallet-blockchain-networks/rpcUrls/rpcSession';

export const EtherScanAPIFree = axios.create({
  baseURL: config.ETHEREUM_SCAN_BASE_URL,
  headers: {
    'Content-Type': 'application/json',
  },
  timeout: 30000,
});

export const EtherScanAPI = axios.create({
  baseURL: buildScanProxyUrl('etherscan'),
  headers: {
    'Content-Type': 'application/json',
  },
  adapter: rpcSessionAdapter,
  timeout: 30000,
});
