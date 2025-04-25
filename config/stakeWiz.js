import axios from 'axios';
import {config} from 'dok-wallet-blockchain-networks/config/config';

export const STAKE_WIZ_API = axios.create({
  baseURL: config.STAKE_WIZ_BASE_URL,
  headers: {
    'Content-Type': 'application/json',
  },
  timeout: 30000,
});
