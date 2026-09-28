import {createAsyncThunk, createSlice, current} from '@reduxjs/toolkit';
import {debounce} from 'dok-wallet-blockchain-networks/helper';
import {getSellCryptoUrl} from 'dok-wallet-blockchain-networks/service/dokApi';
import {getSellCryptoPaymentDetails} from 'dok-wallet-blockchain-networks/service/dokApi';
import {getSellCryptoQuote} from 'dok-wallet-blockchain-networks/service/dokApi';
import {
  calculateEstimateFee,
  setCurrentTransferCustomError,
  updateCurrentTransferData,
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

const sameText = (a, b) =>
  typeof a === 'string' &&
  typeof b === 'string' &&
  a.trim().toLowerCase() === b.trim().toLowerCase();

export const SELL_WALLET_MISSING_MESSAGE =
  'The wallet for this sell request is no longer available. Please start the sell again.';

// The persisted requestDetails copies (selectedFromWallet, selectedFromAsset)
// are stripped of their keys at rest, so after a relaunch they are keyless
// stubs. Sign with the live objects from the wallets slice. The wallet is
// never a stub: passing one down would make getNativeCoin fall back to the
// CURRENT wallet's phrase and sign from the wrong wallet, so a missing live
// wallet is `null` and the thunk refuses to continue. The coin may fall back
// to the stub (address/display fields only) because resolveWallet re-derives
// it from the live wallet.
const resolveLiveSellContext = (state, requestDetails) => {
  const storedWallet = requestDetails?.selectedFromWallet;
  const storedAsset = requestDetails?.selectedFromAsset;
  const liveWallet = state.wallets?.allWallets?.find(
    wallet => wallet?.clientId && wallet.clientId === storedWallet?.clientId,
  );
  const coins = Array.isArray(liveWallet?.coins) ? liveWallet.coins : [];
  const liveCoin =
    (storedAsset?._id && coins.find(coin => coin?._id === storedAsset._id)) ||
    coins.find(
      coin =>
        coin?.chain_name === storedAsset?.chain_name &&
        sameText(coin?.address, storedAsset?.address) &&
        sameText(
          coin?.contractAddress ?? '',
          storedAsset?.contractAddress ?? '',
        ),
    );
  return {
    selectedWallet: liveWallet || null,
    selectedCoin: liveCoin || storedAsset,
  };
};

const initiateTransfer = async (payload, thunkAPI) => {
  const dispatch = thunkAPI.dispatch;
  const currentState = thunkAPI.getState();
  const requestDetails = currentState.sellCrypto.requestDetails;
  const transferDetails = currentState.sellCrypto.transferDetails;
  try {
    const {selectedWallet, selectedCoin} = resolveLiveSellContext(
      currentState,
      requestDetails,
    );
    if (!selectedWallet) {
      throw new Error(SELL_WALLET_MISSING_MESSAGE);
    }
    dispatch(
      updateCurrentTransferData({
        toAddress: transferDetails?.depositAddress,
        amount: validateBigNumberStr(transferDetails?.depositAmount),
        memo: transferDetails?.memo,
        currentCoin: selectedCoin,
        isSendFunds: false,
      }),
    );
    dispatch(
      calculateEstimateFee({
        isFetchNonce: true,
        fromAddress: selectedCoin?.address,
        toAddress: transferDetails?.depositAddress,
        amount: transferDetails?.depositAmount,
        contractAddress: selectedCoin?.contractAddress,
        selectedWallet,
        selectedCoin,
      }),
    );
  } catch (e) {
    console.error('Error in initiateSellCryptoTransfer', e);
    dispatch(setSellCryptoError(e?.message));
    // Both apps navigate to the Transfer/confirm screen without awaiting this
    // thunk; that screen renders transferData.customError when the transfer
    // is not marked successful, so surface the reason there too.
    dispatch(setCurrentTransferCustomError(e?.message));
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
