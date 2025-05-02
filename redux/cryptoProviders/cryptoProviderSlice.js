import {createAsyncThunk, createSlice} from '@reduxjs/toolkit';
import {
  getBuyCryptoQuote,
  getiOSBuyCryptoCountries,
} from 'dok-wallet-blockchain-networks/service/dokApi';
import {
  debounce,
  formatExchangeArray,
} from 'dok-wallet-blockchain-networks/helper';
import {getSelectedCountry} from 'dok-wallet-blockchain-networks/redux/cryptoProviders/cryptoProvidersSelectors';

const initialState = {
  providers: [],
  shownOTC: false,
  loading: false,
  error: null,
  country: 'US',
  fetchProvider: true,
  messageAllowUrls: [],
  disableMessage: '',
  google_analytics_key: '',
  exchangeProviders: '',
  cmc_api_keys: [],
  bitcoin_fee_multiplier: {
    normal: 1.4,
    recommended: 1.65,
  },
  litecoin_fee_multiplier: {
    normal: 1.4,
    recommended: 1.65,
  },
  dogecoin_fee_multiplier: {
    normal: 1.4,
    recommended: 1.65,
  },
  bitcoin_cash_fee_multiplier: {
    normal: 1.4,
    recommended: 1.65,
  },
  additional_l1_fees: {
    base: 500000000000,
    optimism: 500000000000,
    optimism_binance_smart_chain: 500000000000,
    ink: 500000000000,
  },
};

export const fetchSupportedBuyCryptoCurrency = createAsyncThunk(
  'cryptoProvider/fetchSupportedBuyCryptoCurrency',
  async (payload, thunkAPI) => {
    const currentState = thunkAPI.getState();
    const country = payload?.country || getSelectedCountry(currentState);
    const fromDevice = payload?.fromDevice;
    const dispatch = thunkAPI.dispatch;
    dispatch(setFetchProvider(true));
    const resp = await getiOSBuyCryptoCountries({country, fromDevice});
    const data = resp?.data;
    return {
      providers: Array.isArray(data?.cryptoProviders)
        ? data?.cryptoProviders
        : [],
      shownOTC: !!data?.shownOtc,
      messageAllowUrls: Array.isArray(data?.messageAllowUrls)
        ? data?.messageAllowUrls
        : [],
      disableMessage: data?.disableMessage,
      google_analytics_key: data?.google_analytics_key,
      exchangeProviders: data?.exchangeProviders,
      cmc_api_keys: data?.cmc_api_keys,
      bitcoin_fee_multiplier: data?.bitcoin_fee_multiplier || {},
      litecoin_fee_multiplier: data?.litecoin_fee_multiplier || {},
      dogecoin_fee_multiplier: data?.dogecoin_fee_multiplier || {},
      bitcoin_cash_fee_multiplier: data?.bitcoin_cash_fee_multiplier || {},
      additional_l1_fees: data?.additional_l1_fees || {},
      is_max_wallet_limit_reached: data?.is_max_wallet_limit_reached || false,
    };
  },
);

const internalBuyCryptoQoute = async (payload, thunkAPI) => {
  const dispatch = thunkAPI.dispatch;
  try {
    dispatch(setCryptoProviderLoading(true));
    const resp = await getBuyCryptoQuote(payload);
    const data = resp?.data;
    const providers = Array.isArray(data?.cryptoProviders)
      ? data?.cryptoProviders
      : [];
    dispatch(setCryptoProviderData(providers));
  } catch (e) {
    console.error('Error in getBuyQuote', e);
    dispatch(setCryptoProviderError(e?.message));
  }
};

export const debounuceInternalBuyCryptoQoute = debounce(
  internalBuyCryptoQoute,
  800,
);

export const fetchBuyCryptoQuote = createAsyncThunk(
  'cryptoProvider/fetchBuyCryptoQuote',
  internalBuyCryptoQoute,
);

export const debounceFetchBuyCryptoQuote = createAsyncThunk(
  'cryptoProvider/debounceFetchBuyCryptoQuote',
  debounuceInternalBuyCryptoQoute,
);

export const cryptoProviderSlice = createSlice({
  name: 'cryptoProvider',
  initialState,
  reducers: {
    setCryptoProviderLoading(state, {payload}) {
      state.loading = payload;
    },
    setFetchProvider(state, {payload}) {
      state.fetchProvider = payload;
    },
    setCryptoProviderData(state, {payload}) {
      state.providers = payload;
      state.loading = false;
      state.error = null;
    },
    setCryptoProviderError(state, {payload}) {
      state.error = payload;
      state.loading = false;
    },
    setCountry(state, {payload}) {
      state.country = payload;
    },
  },
  extraReducers: builder => {
    builder.addCase(
      fetchSupportedBuyCryptoCurrency.fulfilled,
      (state, {payload}) => {
        state.providers = payload?.providers;
        state.shownOTC = payload?.shownOTC;
        state.messageAllowUrls = payload?.messageAllowUrls;
        state.disableMessage = payload?.disableMessage?.toString();
        state.google_analytics_key = payload?.google_analytics_key?.toString();
        state.cmc_api_keys = Array.isArray(payload?.cmc_api_keys)
          ? payload?.cmc_api_keys
          : [];
        state.bitcoin_fee_multiplier = {
          ...state.bitcoin_fee_multiplier,
          ...payload?.bitcoin_fee_multiplier,
        };
        state.litecoin_fee_multiplier = {
          ...state.litecoin_fee_multiplier,
          ...payload?.litecoin_fee_multiplier,
        };
        state.dogecoin_fee_multiplier = {
          ...state.dogecoin_fee_multiplier,
          ...payload?.dogecoin_fee_multiplier,
        };
        state.bitcoin_cash_fee_multiplier = {
          ...state.bitcoin_cash_fee_multiplier,
          ...payload?.bitcoin_cash_fee_multiplier,
        };
        state.additional_l1_fees = {
          ...state.additional_l1_fees,
          ...payload?.additional_l1_fees,
        };
        state.fetchProvider = false;
        state.exchangeProviders = formatExchangeArray(
          payload?.exchangeProviders,
        );
        state.is_max_wallet_limit_reached =
          payload?.is_max_wallet_limit_reached;
      },
    );
    builder.addCase(
      fetchSupportedBuyCryptoCurrency.rejected,
      (state, {payload}) => {
        state.error = payload;
        state.fetchProvider = false;
      },
    );
  },
});

export const {
  setCryptoProviderLoading,
  setCryptoProviderData,
  setCryptoProviderError,
  setCountry,
  setFetchProvider,
} = cryptoProviderSlice.actions;
