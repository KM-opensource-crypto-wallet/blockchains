export const getPhrase = state => state.extraData.phrase;
export const getChainName = state => state.extraData.chain_name;
export const getPrivateKey = state => state.extraData.privateKey;
export const getOTCData = state => state.extraData.otcData;
export const getRouteStateData = state => state.extraData.routeStateData;
export const getPaymentData = state => state.extraData.paymentData;
export const getIsWalletConnectInitialized = state =>
  state.extraData.isWalletConnectInitialized;
export const getWCUri = state => state.extraData.wcUri;
export const isNoUpdateAvailable = state =>
  state.extraData.isUpdateAvailable === 'no';
