import {CoinMarketCapAPI} from 'dok-wallet-blockchain-networks/config/coinMarketCap';
import dayjs from 'dayjs';
import {getCurrencyRate} from 'dok-wallet-blockchain-networks/service/dokApi';
import {config, isWeb} from 'dok-wallet-blockchain-networks/config/config';

let priceInfo = {};
let lastCallTimeStamp;

const fetchWithRetry = async (symbol, currency) => {
  const {store} = require('redux/store');
  const {
    getCmcApiKeys,
  } = require('dok-wallet-blockchain-networks/redux/cryptoProviders/cryptoProvidersSelectors');

  const currentState = store.getState();
  const newApiKeys = getCmcApiKeys(currentState);
  const localApiKeys = config.COIN_MARKET_CAP_API_KEYS;
  const apiKeys = newApiKeys?.length ? newApiKeys : localApiKeys;
  for (let i = 0; i < apiKeys?.length; i++) {
    try {
      const apiKey = apiKeys[i];
      return await CoinMarketCapAPI.get('/cryptocurrency/quotes/latest', {
        params: {
          symbol,
          convert: currency,
        },
        headers: {
          'X-CMC_PRO_API_KEY': apiKey,
        },
      });
    } catch (e) {
      const statusCode = e?.response?.status;
      console.log(`Error in cmc api with index: ${i} :`, e?.response?.data);
      if (i === apiKeys.length - 1 || statusCode !== 429) {
        return {};
      }
    }
  }
};

export const getPrice = async (symbol, currency) => {
  try {
    if (
      !priceInfo[symbol] ||
      dayjs().diff(dayjs(lastCallTimeStamp), 'minutes') > 5
    ) {
      lastCallTimeStamp = new Date();
      let resp;
      if (isWeb) {
        resp = await getCurrencyRate({symbol, currency});
        priceInfo = resp?.data;
      } else {
        resp = await fetchWithRetry(symbol, currency);
        priceInfo = {
          ...priceInfo,
          ...formatCurrencyPrice(resp?.data?.data, currency),
        };
      }
    }
    return priceInfo;
  } catch (e) {
    console.error('Error in getPrice', JSON.stringify(e));
    return {};
  }
};

const formatCurrencyPrice = (data, currency) => {
  const allKeys = Object.keys(data);
  const finalResp = {};
  allKeys.forEach(key => {
    finalResp[key] =
      Array.isArray(data[key]) && data[key][0]?.quote[currency]?.price;
  });
  return finalResp;
};
