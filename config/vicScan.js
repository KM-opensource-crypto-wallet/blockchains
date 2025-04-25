import axios from 'axios';
import {config} from 'dok-wallet-blockchain-networks/config/config';

export const VicScanAPI = axios.create({
  baseURL: config.VICTION_SCAN_API_URL,
  headers: {
    'Content-Type': 'application/json',
  },
  timeout: 30000,
});
