import {createSlice} from '@reduxjs/toolkit';

const state = {
  localCurrency: 'USD',
  notifications: {
    received: true,
    sent: true,
  },
  fingerprint: false,
  lockTime: 0,
  paymentUrlCoin: {},
  paymentUrlAmount: '',
  paymentUrlCurrencyAmount: '',
  feesOptions: false,
  chatsOptions: false,
  searchInHomeScreen: true,
  isWalletReset: false,
};

export const settingsSlice = createSlice({
  name: 'settings',
  initialState: state,
  reducers: {
    setLocalCurrency(state, {payload}) {
      state.localCurrency = payload;
    },
    updateReceived(state, {payload}) {
      state.notifications.received = payload;
    },
    updateSent(state, {payload}) {
      state.notifications.sent = payload;
    },
    updateFingerprint(state, {payload}) {
      state.fingerprint = payload;
    },
    updateFeesOptions(state, {payload}) {
      state.feesOptions = payload;
    },
    updateChatOptions(state, {payload}) {
      state.chatsOptions = payload;
    },
    updateSearchInHomeScreen(state, {payload}) {
      state.searchInHomeScreen = payload;
    },
    updateLockTime(state, {payload}) {
      const number = Number(payload);
      const validNumber = isNaN(number) ? 0 : number;
      state.lockTime = validNumber;
    },
    setPaymentUrlCoin(state, {payload}) {
      state.paymentUrlCoin = payload;
    },
    setPaymentUrlAmount(state, {payload}) {
      state.paymentUrlAmount = payload;
    },
    setPaymentUrlCurrencyAmount(state, {payload}) {
      state.paymentUrlCurrencyAmount = payload;
    },
    resetPaymentUrl(state) {
      state.paymentUrlAmount = '';
      state.paymentUrlCoin = {};
    },
    setResetWallet(state, {payload}) {
      state.isWalletReset = payload;
    },
  },
});

export const {
  setLocalCurrency,
  updateReceived,
  updateSent,
  updateFingerprint,
  updateLockTime,
  resetPaymentUrl,
  setPaymentUrlAmount,
  setPaymentUrlCoin,
  updateFeesOptions,
  updateChatOptions,
  setPaymentUrlCurrencyAmount,
  updateSearchInHomeScreen,
  setResetWallet,
} = settingsSlice.actions;
