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
    // Drops the pending request once it has been answered (approve / reject /
    // thunk failure). Scoped by id so a late clear from an old request cannot
    // wipe a newer one. Deliberately leaves transactionModalVisible alone: the
    // modal owns that flag and clears it before the thunk reads the request.
    clearWalletConnectTransactionData(state, {payload}) {
      if (!payload?.id || state.transactionRequestData?.id === payload.id) {
        state.transactionRequestData = null;
      }
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
  clearWalletConnectTransactionData,
  setWalletConnectTransactionSubmit,
  setWalletConnectRequestModal,
  setReduxStoreLoaded,
} = walletConnectSlice.actions;
