import axios from 'axios';
import {config} from 'dok-wallet-blockchain-networks/config/config';

export const TonScanAPI = axios.create({
  baseURL: config.TON_SCAN_BASE_URL,
  headers: {
    'Content-Type': 'application/json',
    'X-API-Key': config.TON_SCAN_API_KEY,
  },
  timeout: 30000,
});
