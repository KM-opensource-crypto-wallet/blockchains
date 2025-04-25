import axios from 'axios';
import {config} from 'dok-wallet-blockchain-networks/config/config';

export const EthereumPowScanAPI = axios.create({
  baseURL: config.ETHEREUM_POW_SCAN_API_URL,
  headers: {
    'Content-Type': 'application/json',
    'OK-ACCESS-KEY': config.ETHEREUM_POW_SCAN_API_KEY,
  },
  timeout: 30000,
});
