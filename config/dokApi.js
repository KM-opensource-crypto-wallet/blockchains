import axios from 'axios';
import {config} from 'dok-wallet-blockchain-networks/config/config';

const CAPTCHA_ACTION = 'web_wallet';

export const captchaRef = {execute: null};
let _appName = null;

const waitForExecutor = (timeout = 5000) =>
  new Promise((resolve, reject) => {
    if (captchaRef.execute) return resolve(captchaRef.execute);
    const deadline = Date.now() + timeout;
    const id = setInterval(() => {
      if (captchaRef.execute) {
        clearInterval(id);
        resolve(captchaRef.execute);
      } else if (Date.now() >= deadline) {
        clearInterval(id);
        reject(new Error('captcha executor not ready'));
      }
    }, 50);
  });

export const setAppNameToDokApi = appName => {
  _appName = appName;
};

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

DokApi.interceptors.request.use(
  async requestConfig => {
    if (typeof window === 'undefined') return requestConfig;

    // Bootstrap call — white-label data isn't available yet, skip attestation
    if (requestConfig.url === '/get-white-label') return requestConfig;

    if (_appName) {
      requestConfig.headers['x-app-name'] = `${_appName}-web`;
    }

    try {
      const executor = await waitForExecutor();
      requestConfig.headers['x-captcha-token'] = await executor(CAPTCHA_ACTION);
    } catch (err) {
      console.warn('[captcha] Failed to obtain token:', err.message);
    }

    return requestConfig;
  },
  err => Promise.reject(err),
);
