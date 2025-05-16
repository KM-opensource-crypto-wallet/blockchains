import axios from 'axios';

export const FilScanApi = axios.create({
  baseURL: 'https://api-v2.filscan.io/api/v1',
  headers: {
    'Content-Type': 'application/json',
  },
  timeout: 30000,
});
