import axios from 'axios';
import {config} from 'dok-wallet-blockchain-networks/config/config';

export const EtherScanAPIFree = axios.create({
  baseURL: config.ETHEREUM_SCAN_BASE_URL,
  headers: {
    'Content-Type': 'application/json',
  },
  timeout: 30000,
});

export const EtherScanAPI1 = axios.create({
  baseURL: config.ETHEREUM_SCAN_BASE_URL,
  headers: {
    'Content-Type': 'application/json',
  },
  params: {
    apikey: config.ETHEREUM_SCAN_API_KEY_1,
  },
  timeout: 30000,
});
export const EtherScanAPI2 = axios.create({
  baseURL: config.ETHEREUM_SCAN_BASE_URL,
  headers: {
    'Content-Type': 'application/json',
  },
  params: {
    apikey: config.ETHEREUM_SCAN_API_KEY_2,
  },
  timeout: 30000,
});
