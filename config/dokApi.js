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

const CAPTCHA_ACTION = 'web_wallet';
let _captchaInterceptorId = null;

export function setupCaptchaInterceptor(appName) {
  if (!appName) return;

  // Eject stale interceptor before re-registering (handles HMR + white-label changes)
  if (_captchaInterceptorId !== null) {
    DokApi.interceptors.request.eject(_captchaInterceptorId);
  }

  _captchaInterceptorId = DokApi.interceptors.request.use(
    async requestConfig => {
      if (typeof window === 'undefined') return requestConfig;

      // Bootstrap call — white-label data isn't available yet, skip attestation
      if (requestConfig.url === '/get-white-label') return requestConfig;

      requestConfig.headers['x-app-name'] = `${appName}-web`;

      const siteKey = process.env.NEXT_PUBLIC_RECAPTCHA_SITE_KEY;
      if (siteKey && window.grecaptcha) {
        try {
          const token = await new Promise((resolve, reject) => {
            window.grecaptcha.ready(() => {
              window.grecaptcha
                .execute(siteKey, {action: CAPTCHA_ACTION})
                .then(resolve)
                .catch(reject);
            });
          });
          requestConfig.headers['x-captcha-token'] = token;
        } catch (err) {
          console.warn('[captcha] Failed to obtain token:', err.message);
        }
      }

      return requestConfig;
    },
    err => Promise.reject(err),
  );
}
