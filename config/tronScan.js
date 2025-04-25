import axios from 'axios';
import {config} from 'dok-wallet-blockchain-networks/config/config';

export const TronScanAPI = axios.create({
  baseURL: config.TRON_SCAN_BASE_URL,
  headers: {
    'Content-Type': 'application/json',
    'TRON-PRO-API-KEY': config.TRON_SCAN_API_KEY,
  },
  timeout: 30000,
});
