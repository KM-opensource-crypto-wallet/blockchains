import axios from 'axios';

export const BlockChairAPI = axios.create({
  baseURL: 'https://api.blockchair.com/',
  headers: {
    'Content-Type': 'application/json',
  },
  timeout: 30000,
});
