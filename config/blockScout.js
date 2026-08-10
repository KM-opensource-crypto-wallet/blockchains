import axios from 'axios';
import {config} from 'dok-wallet-blockchain-networks/config/config';

export const BlockScoutAPI = axios.create({
  baseURL: config.BLOCKSCOUT_BASE_URL,
  headers: {
    'Content-Type': 'application/json',
  },
  params: {
    apikey: config.BLOCKSCOUT_API_KEY,
  },
  timeout: 30000,
});
