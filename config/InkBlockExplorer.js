import axios from 'axios';
import {config} from 'dok-wallet-blockchain-networks/config/config';

export const InkBlockExplorerAPI = axios.create({
  baseURL: config.INK_BLOCK_EXPLORER_BASE_URL,
  headers: {
    'Content-Type': 'application/json',
  },
  timeout: 30000,
});
