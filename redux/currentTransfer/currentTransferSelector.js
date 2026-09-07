export const getTransferData = state => state.currentTransfer.transferData;
export const getTransferDataLoading = state =>
  state.currentTransfer.transferData?.isLoading;
export const getTransferDataRefreshing = state =>
  state.currentTransfer?.transferData?.isRefreshing;
export const getTransferDataSubmitting = state =>
  state.currentTransfer?.transferData?.isSubmitting;

export const getTransferDataEstimateFee = state =>
  state.currentTransfer?.transferData?.transactionFee;

export const getTransferDataFeesOptions = state =>
  state.currentTransfer?.transferData?.feesOptions || [];
export const getTransferDataFeeSuccess = state =>
  state.currentTransfer?.transferData?.success;
export const getTransferDataCustomError = state =>
  state.currentTransfer?.transferData?.customError;
export const getTransferDataCustomErrorCode = state =>
  state.currentTransfer?.transferData?.customErrorCode;

export const getTransferDataPayGasWithToken = state =>
  !!state.currentTransfer?.transferData?.payGasWithToken;
export const getTransferDataGasTokenSymbol = state =>
  state.currentTransfer?.transferData?.gasTokenSymbol;
export const getTransferDataSponsoredQuote = state =>
  state.currentTransfer?.transferData?.sponsoredQuote;

export const getPendingTransferData = state =>
  state.currentTransfer.pendingTransferData;

export const getUpdateTransactionData = state =>
  state.currentTransfer.updateTransactionData;
