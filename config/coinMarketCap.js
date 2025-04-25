import axios from 'axios';

export const CoinMarketCapAPI = axios.create({
  baseURL: 'https://pro-api.coinmarketcap.com/v2',
  headers: {
    'Content-Type': 'application/json',
  },
  timeout: 30000,
});
