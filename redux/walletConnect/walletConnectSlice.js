import {createSlice} from '@reduxjs/toolkit';

const initialState = {
  isConnected: false,
  requestedModalVisible: false,
  requestData: null,
  transactionRequestData: null,
  transactionModalVisible: false,
  isTransactionSubmitting: false,
  isReduxStoreLoaded: false,
};

export const walletConnectSlice = createSlice({
  name: 'walletConnect',
  initialState,
  reducers: {
    setWalletConnectConnection(state, {payload}) {
      state.isConnected = payload;
    },
    setWalletConnectRequestModal(state, {payload}) {
      state.requestedModalVisible = payload;
    },
    setWalletConnectRequestData(state, {payload}) {
      state.requestData = payload;
    },
    setWalletConnectTransactionData(state, {payload}) {
      state.transactionRequestData = payload;
      state.transactionModalVisible = true;
    },
    setWalletConnectTransactionModal(state, {payload}) {
      state.transactionModalVisible = payload;
    },
    setReduxStoreLoaded(state, {payload}) {
      state.isReduxStoreLoaded = payload;
    },
    setWalletConnectTransactionSubmit(state, {payload}) {
      state.isTransactionSubmitting = payload;
    },
    resetWalletConnect: () => initialState,
  },
});

export const {
  resetWalletConnect,
  setWalletConnectConnection,
  setWalletConnectTransactionModal,
  setWalletConnectRequestData,
  setWalletConnectTransactionData,
  setWalletConnectTransactionSubmit,
  setWalletConnectRequestModal,
  setReduxStoreLoaded,
} = walletConnectSlice.actions;
