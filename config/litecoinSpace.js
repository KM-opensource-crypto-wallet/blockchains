import axios from 'axios';

export const LitecoinSpaceAPI = axios.create({
  baseURL: 'https://litecoinspace.org/api',
  headers: {
    'Content-Type': 'application/json',
  },
  timeout: 30000,
});
