import axios from 'axios';

export const BlockDaemonAPI = axios.create({
  baseURL: 'https://svc.blockdaemon.com',
  headers: {
    'Content-Type': 'application/json',
    'X-API-KEY': process.env.BLOCKDAEMON_API_KEY,
  },
  timeout: 30000,
});
