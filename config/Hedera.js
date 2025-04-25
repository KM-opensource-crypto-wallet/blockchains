import axios from 'axios';
import {config} from 'dok-wallet-blockchain-networks/config/config';

export const HEDERA_API = axios.create({
  baseURL: config.HEDERA_BASE_URL,
  headers: {
    'Content-Type': 'application/json',
  },
  timeout: 30000,
});
