import {createAsyncThunk, createSlice, current} from '@reduxjs/toolkit';
import {debounce} from 'dok-wallet-blockchain-networks/helper';
import {getSellCryptoUrl} from 'dok-wallet-blockchain-networks/service/dokApi';
import {getSellCryptoPaymentDetails} from 'dok-wallet-blockchain-networks/service/dokApi';
import {getSellCryptoQuote} from 'dok-wallet-blockchain-networks/service/dokApi';
import {
  calculateEstimateFee,
  setCurrentTransferData,
} from '../currentTransfer/currentTransferSlice';
import {validateBigNumberStr} from 'dok-wallet-blockchain-networks/helper';

const initialState = {
  providers: [],
  loading: false,
  error: null,
  transferDetails: {
    depositAddress: '',
    depositAmount: '',
    memo: null,
  },
  requestDetails: {
    requestId: null,
    providerName: null,
    providerDisplayName: null,
    selectedFromAsset: null,
    selectedFromWallet: null,
  },
};

const internalSellCryptoQuote = async (payload, thunkAPI) => {
  const dispatch = thunkAPI.dispatch;
  try {
    dispatch(setSellCryptoLoading(true));
    dispatch(clearTransferAndRequestDetails());
    const resp = await getSellCryptoQuote(payload);
    const data = resp?.data;
    const providers = Array.isArray(data?.cryptoProviders)
      ? data?.cryptoProviders
      : [];
    dispatch(setSellCryptoData(providers));
  } catch (e) {
    console.error('Error in internalSellCryptoQuote', e);
    dispatch(setSellCryptoError(e?.message));
  } finally {
    dispatch(setSellCryptoLoading(false));
  }
};

const initiateTransfer = async (payload, thunkAPI) => {
  const dispatch = thunkAPI.dispatch;
  const currentState = thunkAPI.getState();
  const requestDetails = currentState.sellCrypto.requestDetails;
  const transferDetails = currentState.sellCrypto.transferDetails;
  try {
    dispatch(
      setCurrentTransferData({
        toAddress: transferDetails?.depositAddress,
        amount: validateBigNumberStr(transferDetails?.depositAmount),
        memo: transferDetails?.memo,
        currentCoin: requestDetails?.selectedFromAsset,
        isSendFunds: false,
      }),
    );
    dispatch(
      calculateEstimateFee({
        isFetchNonce: true,
        fromAddress: requestDetails?.selectedFromAsset?.address,
        toAddress: transferDetails?.depositAddress,
        amount: transferDetails?.depositAmount,
        contractAddress: requestDetails?.selectedFromAsset?.contractAddress,
        selectedWallet: requestDetails?.selectedFromWallet,
        selectedCoin: requestDetails?.selectedFromAsset,
      }),
    );
  } catch (e) {
    console.error('Error in initiateSellCryptoTransfer', e);
    dispatch(setSellCryptoError(e?.message));
  }
};

const getPaymentDetails = async (payload, thunkAPI) => {
  const dispatch = thunkAPI.dispatch;
  const currentState = thunkAPI.getState();
  const requestDetails = currentState.sellCrypto.requestDetails;
  try {
    dispatch(setSellCryptoError(null));
    dispatch(setSellCryptoLoading(true));
    const resp = await getSellCryptoPaymentDetails({
      requestId: requestDetails?.requestId,
      providerName: requestDetails?.providerName,
    });
    dispatch(
      setTransferDetails({
        depositAddress: resp?.data?.depositAddress,
        depositAmount: resp?.data?.amount,
        memo: resp?.data?.memo || null,
      }),
    );
  } catch (e) {
    console.error('Error in getPaymentDetails', e);
    dispatch(setSellCryptoError(e?.message));
  } finally {
    dispatch(setSellCryptoLoading(false));
  }
};

const getUrl = async (payload, thunkAPI) => {
  const dispatch = thunkAPI.dispatch;
  try {
    dispatch(clearTransferAndRequestDetails());
    const resp = await getSellCryptoUrl(payload);
    return resp?.data;
  } catch (e) {
    console.error('Error in getSellCryptoUrl', e);
    dispatch(setSellCryptoError(e?.message));
  }
};

export const debounceInternalSellCryptoQuote = debounce(
  internalSellCryptoQuote,
  800,
);

export const initiateSellCryptoTransfer = createAsyncThunk(
  'sellCrypto/initiateSellCryptoTransfer',
  initiateTransfer,
);

export const fetchSellCryptoPaymentDetails = createAsyncThunk(
  'sellCrypto/fetchSellCryptoPaymentDetails',
  getPaymentDetails,
);

export const fetchSellCryptoQuote = createAsyncThunk(
  'sellCrypto/fetchSellCryptoQuote',
  internalSellCryptoQuote,
);

export const fetchSellCryptoUrl = createAsyncThunk(
  'sellCrypto/fetchSellCryptoUrl',
  getUrl,
);

export const debounceFetchSellCryptoQuote = createAsyncThunk(
  'sellCrypto/debounceFetchSellCryptoQuote',
  debounceInternalSellCryptoQuote,
);

export const sellCryptoSlice = createSlice({
  name: 'sellCrypto',
  initialState,
  reducers: {
    setSellCryptoLoading(state, {payload}) {
      state.loading = payload;
    },
    setSellCryptoData(state, {payload}) {
      state.providers = payload;
      state.loading = false;
      state.error = null;
    },
    setSellCryptoError(state, {payload}) {
      state.error = payload;
      state.loading = false;
    },
    clearTransferAndRequestDetails(state) {
      state.transferDetails = {...initialState.transferDetails};
      state.requestDetails = {...initialState.requestDetails};
    },
    setTransferDetails(state, {payload}) {
      state.transferDetails = payload;
    },
    setRequestDetails(state, {payload}) {
      state.requestDetails = {
        ...state.requestDetails,
        ...payload,
      };
    },
  },
});

export const {
  setSellCryptoLoading,
  setSellCryptoData,
  setSellCryptoError,
  clearTransferAndRequestDetails,
  setTransferDetails,
  setRequestDetails,
} = sellCryptoSlice.actions;
