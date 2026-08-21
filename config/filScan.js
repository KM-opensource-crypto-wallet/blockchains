import axios from 'axios';
import {config} from 'dok-wallet-blockchain-networks/config/config';

export const FilScanApi = axios.create({
  baseURL: config.FILSCAN_API_BASE_URL,
  headers: {
    'Content-Type': 'application/json',
  },
  timeout: 30000,
});
