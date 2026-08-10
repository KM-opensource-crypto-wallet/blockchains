export const selectExchangeTransactions = state =>
  state.exchangeHistory?.transactions || [];

export const selectExchangeHistoryMeta = state => state.exchangeHistory?.meta;

export const selectExchangeHistoryLoading = state =>
  state.exchangeHistory?.loading;

export const selectExchangeHistoryRefreshing = state =>
  state.exchangeHistory?.refreshing;

export const selectExchangeHistoryLoadingMore = state =>
  state.exchangeHistory?.loadingMore;

export const selectExchangeHistoryError = state => state.exchangeHistory?.error;

export const selectCurrentExchangeTransaction = state =>
  state.exchangeHistory?.currentTransaction;

export const selectExchangeDetailLoading = state =>
  state.exchangeHistory?.detailLoading;

export const selectExchangeDetailError = state =>
  state.exchangeHistory?.detailError;
