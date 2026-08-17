import {createSelector} from '@reduxjs/toolkit';
import BigNumber from 'bignumber.js';
import {multiplyBNWithFixed} from 'dok-wallet-blockchain-networks/helper';
import {buildExchangePairKey} from 'dok-wallet-blockchain-networks/helper/exchangeHelpers';

export const getExchange = state => state.exchange;
export const getExchangeAllowance = state => state.exchange.allowanceData;
export const getExchangeAllowanceLoading = state =>
  state.exchange.allowanceLoading;
export const getExchangeApproveLoading = state => state.exchange.approveLoading;
export const getExchangePermitAllowance = state =>
  state.exchange.permitAllowanceData;
export const getExchangePermitAllowanceLoading = state =>
  state.exchange.permitAllowanceLoading;
export const getExchangePermitApproveLoading = state =>
  state.exchange.permitApproveLoading;

export const selectExchangeFromAsset = state =>
  state.exchange.selectedFromAsset;
export const selectExchangeFromWallet = state =>
  state.exchange.selectedFromWallet;
export const selectExchangeToAsset = state => state.exchange.selectedToAsset;
export const selectExchangeAmountFrom = state => state.exchange.amountFrom;
export const selectExchangeAmountTo = state => state.exchange.amountTo;
export const selectExchangeLoading = state => state.exchange.isLoading;
export const selectExchangeToName = state => state.exchange.exchangeToName;
export const selectExchangeToAddress = state =>
  state.exchange.exchangeToAddress;
export const selectSelectedExchangeChain = state =>
  state.exchange.selectedExchangeChain;

export const selectIsQuoteFetching = state => state.exchange.isQuoteFetching;
export const selectFromBalanceLoading = state =>
  state.exchange.fromBalanceLoading;
export const selectQuoteError = state => state.exchange.quoteError;
export const selectQuoteFetchedAt = state => state.exchange.quoteFetchedAt;

export const selectExchangePairKey = state =>
  buildExchangePairKey(
    state.exchange.selectedFromAsset,
    state.exchange.selectedToAsset,
  );

export const selectPairMinimumProviders = createSelector(
  [state => state.exchange.providerMinimums, selectExchangePairKey],
  (providerMinimums, pairKey) =>
    (pairKey && providerMinimums?.[pairKey]?.providers) || [],
);

const toBN = value => {
  const bn = new BigNumber(value ?? NaN);
  return bn.isFinite() ? bn : null;
};

// View model for the provider list: one row per provider that supports the
// pair, merging the amount-specific quotes (availableProviders) with the
// per-pair minimums. Rows the entered amount doesn't qualify for carry
// isBelowMinimum so the UI can disable them, and every row gets fiat
// equivalents computed from the assets' currencyRate (already in the user's
// local currency, same as fiatPay).
export const selectProviderRows = createSelector(
  [
    state => state.exchange.availableProviders,
    selectPairMinimumProviders,
    state => state.exchange.amountFrom,
    state => state.exchange.selectedExchangeChain,
    state => state.exchange.selectedFromAsset,
    state => state.exchange.selectedToAsset,
  ],
  (
    availableProviders,
    minimumProviders,
    amountFrom,
    selectedExchangeChain,
    selectedFromAsset,
    selectedToAsset,
  ) => {
    const quotesByName = {};
    (availableProviders || []).forEach(item => {
      if (item?.providerName) {
        quotesByName[item.providerName] = item;
      }
    });
    const minsByName = {};
    (minimumProviders || []).forEach(item => {
      if (item?.providerName) {
        minsByName[item.providerName] = item;
      }
    });
    const providerNames = [
      ...new Set([...Object.keys(quotesByName), ...Object.keys(minsByName)]),
    ];
    const amountBN = toBN(amountFrom);
    const fromRate = selectedFromAsset?.currencyRate;
    const toRate = selectedToAsset?.currencyRate;

    const rows = providerNames.map(providerName => {
      const quote = quotesByName[providerName];
      const minRow = minsByName[providerName];
      const source = quote || minRow;
      // The minimum-mode row is authoritative: some providers echo the
      // requested amount back as minAmount in quote mode.
      const minAmount = minRow?.minAmount ?? quote?.minAmount ?? null;
      const minBN = toBN(minAmount);
      const toAmountBN = toBN(quote?.toAmount);
      const isBelowMinimum = !!(minBN && amountBN && amountBN.lt(minBN));
      return {
        providerName,
        title: source?.title || providerName,
        src: source?.src,
        quote,
        minAmount,
        minAmountFiat:
          minBN && fromRate
            ? multiplyBNWithFixed(minAmount, fromRate, 2)
            : null,
        toAmount: toAmountBN ? quote?.toAmount : null,
        toAmountFiat:
          toAmountBN && toRate
            ? multiplyBNWithFixed(quote?.toAmount, toRate, 2)
            : null,
        isBelowMinimum,
        isSelected:
          !!providerName &&
          providerName === selectedExchangeChain?.providerName,
        isBest: false,
        percentDiffFromBest: null,
      };
    });

    // Usable rows (quoted at the entered amount, above minimum) first, best
    // rate on top; below-minimum rows after, closest minimum first.
    const usable = rows
      .filter(row => row.toAmount && !row.isBelowMinimum)
      .sort((a, b) => new BigNumber(b.toAmount).comparedTo(a.toAmount));
    const belowMin = rows
      .filter(row => row.isBelowMinimum)
      .sort((a, b) =>
        new BigNumber(a.minAmount ?? 0).comparedTo(b.minAmount ?? 0),
      );
    const rest = rows.filter(row => !row.toAmount && !row.isBelowMinimum);

    if (usable.length) {
      usable[0].isBest = true;
      const bestBN = new BigNumber(usable[0].toAmount);
      usable.forEach((row, index) => {
        if (index > 0 && bestBN.gt(0)) {
          row.percentDiffFromBest = new BigNumber(row.toAmount)
            .minus(bestBN)
            .dividedBy(bestBN)
            .multipliedBy(100)
            .toFixed(2);
        }
      });
    }
    return [...usable, ...belowMin, ...rest];
  },
);

// Lowest known minimum across providers for the current pair; feeds the
// smart default amount fallback when no fiat rate is available.
export const selectLowestPairMinimum = createSelector(
  [selectPairMinimumProviders],
  providers => {
    let lowest = null;
    providers.forEach(item => {
      const minBN = toBN(item?.minAmount);
      if (minBN && minBN.gt(0) && (!lowest || minBN.lt(lowest))) {
        lowest = minBN;
      }
    });
    return lowest ? lowest.toFixed() : null;
  },
);
