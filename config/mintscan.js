import axios from 'axios';
import {config} from 'dok-wallet-blockchain-networks/config/config';

export const COSMOS_API = axios.create({
  baseURL: config.COSMOS_SCAN_BASE_URL,
  headers: {
    'Content-Type': 'application/json',
    Authorization: config.COSMOS_API_KEY,
  },
  timeout: 30000,
});
