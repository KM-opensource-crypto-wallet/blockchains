import {CoinMarketCapAPI} from 'dok-wallet-blockchain-networks/config/coinMarketCap';
import dayjs from 'dayjs';
import {getCurrencyRate} from 'dok-wallet-blockchain-networks/service/dokApi';
import {isWeb} from 'dok-wallet-blockchain-networks/config/config';

let priceInfo = {};
let lastCallTimeStamp;

const fetchWithRetry = async (symbol, currency) => {
  try {
    return await CoinMarketCapAPI.get('/cryptocurrency/quotes/latest', {
      params: {
        symbol,
        convert: currency,
      },
    });
  } catch (e) {
    console.log('Error in cmc api:', e?.response?.data);
    return {};
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
      const cleanedSymbols = symbol
        .split(',')
        .map(s =>
          s
            .trim()
            .toUpperCase()
            .replace(/[^A-Z0-9]/g, ''),
        )
        .filter(Boolean)
        .filter((v, i, arr) => arr.indexOf(v) === i) // remove duplicates
        .join(',');
      if (isWeb) {
        resp = await getCurrencyRate({cleanedSymbols, currency});
        priceInfo = resp?.data;
      } else {
        resp = await fetchWithRetry(cleanedSymbols, currency);
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
