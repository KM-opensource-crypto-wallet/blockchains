import axios from 'axios';
import {config} from 'dok-wallet-blockchain-networks/config/config';

export const PolkadotScanApi = axios.create({
  baseURL: config.POLKADOT_SCAN_BASE_URL,
  headers: {
    'Content-Type': 'application/json',
    'x-api-key': config.POLKADOT_SCAN_API_KEY,
  },
  timeout: 30000,
});
