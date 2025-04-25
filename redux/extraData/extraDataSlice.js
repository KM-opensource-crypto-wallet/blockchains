import {createSlice} from '@reduxjs/toolkit';

const initialState = {
  phrase: '',
  otcData: {},
  chain_name: null,
  privateKey: null,
  routeStateData: {},
  paymentData: null,
  isUpdateAvailable: '',
  isWalletConnectInitialized: false,
  wcUri: '',
};

export const extraDataSlice = createSlice({
  name: 'extraData',
  initialState,
  reducers: {
    setPhrase(state, {payload}) {
      state.phrase = payload;
    },
    setOTCData(state, {payload}) {
      state.otcData = payload;
    },
    setChainName(state, {payload}) {
      state.chain_name = payload;
    },
    setPrivateKey(state, {payload}) {
      state.privateKey = payload;
    },
    setRouteStateData(state, {payload}) {
      state.routeStateData = {...state.routeStateData, ...payload};
    },
    setPaymentData(state, {payload}) {
      state.paymentData = payload;
    },
    setIsUpdateAvailable(state, {payload}) {
      state.isUpdateAvailable = payload;
    },
    setIsWalletConnectInitialized(state, {payload}) {
      state.isWalletConnectInitialized = payload;
    },
    setWcUri(state, {payload}) {
      state.wcUri = payload;
    },
  },
});

export const {
  setPhrase,
  setOTCData,
  setChainName,
  setPrivateKey,
  setRouteStateData,
  setPaymentData,
  setIsUpdateAvailable,
  setIsWalletConnectInitialized,
  setWcUri,
} = extraDataSlice.actions;
