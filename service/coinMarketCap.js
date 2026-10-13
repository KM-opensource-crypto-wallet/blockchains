import {CoinMarketCapAPI} from 'dok-wallet-blockchain-networks/config/coinMarketCap';
import dayjs from 'dayjs';

let priceInfo = {};
let priceChangeInfo = {};
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
      priceChangeInfo = {
        ...priceChangeInfo,
        ...formatPriceChange(resp?.data?.data, currency),
      };
    }
    return priceInfo;
  } catch (e) {
    console.error('Error in getPrice', JSON.stringify(e));
    return {};
  }
};

// 24h price change (%) from the same quotes response getPrice cached, or
// null when the symbol has no market data. Read it right after getPrice.
export const getPriceChange24h = symbol => {
  const value = priceChangeInfo[symbol];
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
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

const formatPriceChange = (data, currency) => {
  const finalResp = {};
  Object.keys(data || {}).forEach(key => {
    finalResp[key] = Array.isArray(data[key])
      ? data[key][0]?.quote?.[currency]?.percent_change_24h
      : undefined;
  });
  return finalResp;
};
