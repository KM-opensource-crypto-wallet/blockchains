import BigNumber from 'bignumber.js';

// One canonical key per trading pair, used to store per-provider minimums.
// Returns null when either side is incomplete so callers never write under
// a "null"/"undefined" key.
export const buildExchangePairKey = (fromAsset, toAsset) => {
  const fromSymbol = fromAsset?.symbol;
  const fromNetwork = fromAsset?.chain_symbol;
  const toSymbol = toAsset?.symbol;
  const toNetwork = toAsset?.chain_symbol;
  if (!fromSymbol || !fromNetwork || !toSymbol || !toNetwork) {
    return null;
  }
  return `${fromNetwork}:${fromSymbol}__${toNetwork}:${toSymbol}`;
};

const toPositiveBN = value => {
  const bn = new BigNumber(value ?? NaN);
  return bn.isFinite() && bn.gt(0) ? bn : null;
};

// Pre-fill for the amount input when a pair is picked: roughly targetUsd
// worth of the from-coin (so most providers clear their minimums), capped at
// the user's balance. Falls back to slightly above the lowest known provider
// minimum when no fiat rate is available, and to '' when nothing sensible
// can be derived. Only ever used when the amount field is empty — a typed
// amount is never overwritten.
export const getSmartDefaultAmount = ({
  fromAsset,
  lowestMinimum,
  targetUsd = 100,
}) => {
  const rate = toPositiveBN(fromAsset?.currencyRate);
  const balance = toPositiveBN(fromAsset?.totalAmount);
  let amountBN = rate ? new BigNumber(targetUsd).dividedBy(rate) : null;
  if (!amountBN) {
    const minBN = toPositiveBN(lowestMinimum);
    amountBN = minBN ? minBN.multipliedBy(1.1) : null;
  }
  if (!amountBN) {
    return '';
  }
  if (balance && amountBN.gt(balance)) {
    amountBN = balance;
  }
  const decimals = Math.min(Number(fromAsset?.decimal) || 8, 8);
  return amountBN.decimalPlaces(decimals, BigNumber.ROUND_DOWN).toFixed();
};

// The helper/index.js debounce fires callbacks from a bare setTimeout and
// returns undefined, so callers can neither await nor cancel it. This one
// returns the wrapped function with a .cancel() for unmount cleanup.
export const createDebounced = (fn, waitMs) => {
  let timer = null;
  const debounced = (...args) => {
    if (timer) {
      clearTimeout(timer);
    }
    timer = setTimeout(() => {
      timer = null;
      fn(...args);
    }, waitMs);
  };
  debounced.cancel = () => {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
  };
  return debounced;
};
