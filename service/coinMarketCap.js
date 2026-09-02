import {CoinMarketCapAPI} from 'dok-wallet-blockchain-networks/config/coinMarketCap';
import dayjs from 'dayjs';

let priceInfo = {};
let lastCallTimeStamp;

export const getPrice = async (symbol, currency) => {
  try {
    if (
      !priceInfo[symbol] ||
      dayjs().diff(dayjs(lastCallTimeStamp), 'minutes') > 5
    ) {
      lastCallTimeStamp = new Date();
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
      const resp = await CoinMarketCapAPI.get('/cryptocurrency/quotes/latest', {
        params: {symbol: cleanedSymbols, convert: currency},
      });
      priceInfo = {
        ...priceInfo,
        ...formatCurrencyPrice(resp?.data?.data, currency),
      };
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
