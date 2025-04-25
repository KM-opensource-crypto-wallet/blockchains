import axios from 'axios';
import {config} from 'dok-wallet-blockchain-networks/config/config';

export const EthereumClassicScanAPI = axios.create({
  baseURL: config.ETHEREUM_CLASSIC_SCAN_API_URL,
  headers: {
    'Content-Type': 'application/json',
  },
  timeout: 30000,
});
