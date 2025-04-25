import axios from 'axios';
import {config} from 'dok-wallet-blockchain-networks/config/config';

export const BitcoinMempoolAPI = axios.create({
  baseURL: config.BITCOIN_BASE_URL,
  headers: {
    'Content-Type': 'application/json',
  },
  timeout: 30000,
});
