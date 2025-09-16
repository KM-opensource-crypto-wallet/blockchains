export const getBatchTransactions = state => {
  return state.batchTransaction.transactions;
};

export const getShouldShowDropdowns = state => {
  const uniqueChains = state.batchTransaction.filteredData.uniqueChains;
  const uniqueAddresses = state.batchTransaction.filteredData.uniqueAddresses;
  return uniqueChains.length > 1 || uniqueAddresses.length > 1;
};

export const getSelectedChain = state =>
  state.batchTransaction.ui.selectedChain;
export const getSelectedAddress = state =>
  state.batchTransaction.ui.selectedAddress;
export const getIsSelectionMode = state =>
  state.batchTransaction.ui.isSelectionMode;
export const getSelectedItems = state =>
  state.batchTransaction.ui.selectedItems;

export const getFilteredTransactions = state =>
  state.batchTransaction.filteredData.filteredTransactions;

export const getUniqueChains = state =>
  state.batchTransaction.filteredData.uniqueChains;

export const getUniqueAddresses = state =>
  state.batchTransaction.filteredData.uniqueAddresses;

export const getFilterLoading = state =>
  state.batchTransaction.filteredData.loading;

export const getFilterError = state =>
  state.batchTransaction.filteredData.error;

export const getWalletIdFromTransactions = (state, transactions) => {
  return transactions?.[0]?.wallet_id || null;
};

export const getBatchTransactionsBalances = state => {
  return state.batchTransaction.balances || {};
};

export const getBatchTransactionIsValid = state => {
  return state.batchTransaction.isValid || false;
};
export const getBatchTransactionInvalidReason = state =>
  state.batchTransaction.invalid_reason;
