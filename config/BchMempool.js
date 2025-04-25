import axios from 'axios';

export const BchMempoolAPI = axios.create({
  baseURL: 'https://bchmempool.cash/api',
  headers: {
    'Content-Type': 'application/json',
  },
  timeout: 30000,
});
