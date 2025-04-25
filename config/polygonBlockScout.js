import axios from 'axios';
import {config} from 'dok-wallet-blockchain-networks/config/config';

export const PolygonBlockScoutAPI = axios.create({
  baseURL: config.POLYGON_BLOCKSCOUT_BASE_URL,
  headers: {
    'Content-Type': 'application/json',
  },
  timeout: 30000,
});
