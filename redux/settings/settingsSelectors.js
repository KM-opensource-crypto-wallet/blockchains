import {AUTO_LOCK} from 'dok-wallet-blockchain-networks/helper';

export const getLocalCurrency = state => state.settings.localCurrency;
export const getLockTime = state => state.settings.lockTime;
export const getLockTimeDisplay = state => {
  const lockTime = state.settings.lockTime;
  return AUTO_LOCK.find(item => item.value === lockTime)?.label || '';
};
export const isNotificationsReceived = state =>
  state.settings.notifications.received;
export const isNotificationsSent = state => state.settings.notifications.sent;
export const isFingerprint = state => state.settings.fingerprint;
export const isFeesOptions = state => state.settings.feesOptions;
export const isChatOptions = state => state.settings.chatsOptions;
export const isSearchInHomeScreen = state => state.settings.searchInHomeScreen;
export const isWalletReset = state => state.settings.isWalletReset;

export const getPaymentUrlAmount = state => state.settings.paymentUrlAmount;
export const getPaymentUrlCurrencyAmount = state =>
  state.settings.paymentUrlCurrencyAmount;
export const getPaymentUrlCoin = state => state.settings.paymentUrlCoin;
