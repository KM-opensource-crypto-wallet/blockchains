import axios from 'axios';
import {config} from 'dok-wallet-blockchain-networks/config/config';

export const DokApi = axios.create({
  baseURL: config.DOK_WALLET_BASE_URL,
  headers: {
    'Content-Type': 'application/json',
  },
  timeout: 30000,
});

export const setWhiteLabelIdToDokApi = whiteLabelId => {
  DokApi.defaults.headers.white_label_id = whiteLabelId;
};
