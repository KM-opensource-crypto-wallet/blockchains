export const selectWalletConnectRequestData = state =>
  state.walletConnect.requestData;
export const selectWalletConnectTransactionData = state =>
  state.walletConnect.transactionRequestData;
export const selectRequestedModalVisible = state =>
  state.walletConnect.requestedModalVisible;
export const selectTransactionModalVisible = state =>
  state.walletConnect.transactionModalVisible;

export const isReduxStoreLoaded = state =>
  state.walletConnect.isReduxStoreLoaded;
