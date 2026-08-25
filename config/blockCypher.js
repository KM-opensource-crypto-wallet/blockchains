import axios from 'axios';
import {config} from 'dok-wallet-blockchain-networks/config/config';

export const BlockCypherAPI = axios.create({
  baseURL: config.BLOCK_CYPHER_BASE_URL,
  headers: {
    'Content-Type': 'application/json',
  },
  timeout: 30000,
});
