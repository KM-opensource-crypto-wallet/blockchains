import { createAsyncThunk, createSlice } from '@reduxjs/toolkit';
import {
  fetchCoinGroupAPI,
  fetchCurrenciesAPI,
  getNewsAPI,
} from 'dok-wallet-blockchain-networks/service/dokApi';
import {
  selectAllCoinsWalletByMnemonic,
  selectAllCoinWithIsInWalletSymbol,
  selectUserCoins,
} from 'dok-wallet-blockchain-networks/redux/wallets/walletsSelector';
import {
  debounce,
  generateUniqueKeyForChain,
} from 'dok-wallet-blockchain-networks/helper';
import { showToast } from '../../../src/utils/toast';
import { setCurrentCoin } from '../wallets/walletsSlice';

const initialState = {
  loading: true,
  currencies: [],
  error: null,
  allCoins: [],
  allGroupCoins: [],
  allCoinsLoading: true,
  groupCoinsLoading: true,
  allCoinError: true,
  isAllCoinAvailable: false,
  isAllGroupCoinAvailable: false,
  searchAllCoins: [],
  searchAllCoinsLoading: false,
  searchAllCoinError: true,
  searchIsAllCoinAvailable: false,
  isAskedBackedUpModal: {},
  newCoins: [],
  newsModalVisible: false,
  newsMessage: '',
  searchAllGroupCoins: [],
  searchAllGroupCoinsLoading: false,
  searchIsAllGroupCoinAvailable: false,
  isAddingGroup: {},
  missingCoins: [],
};

export const fetchCurrencies = createAsyncThunk(
  'currency/fetchCurrencies',
  async (payload, thunkAPI) => {
    const dispatch = thunkAPI.dispatch;
    dispatch(setCurrencyLoading(true));
    const resp = await fetchCurrenciesAPI({ ...payload, status: true });
    return Array?.isArray(resp?.data?.data) ? resp?.data?.data : [];
  },
);

export const fetchAllCoins = createAsyncThunk(
  'currency/fetchAllCoins',
  async (payload, thunkAPI) => {
    try {
      const dispatch = thunkAPI.dispatch;
      if (payload.page === 1) {
        dispatch(setAllCoinsLoading(true));
      }
      const resp = await fetchCurrenciesAPI(payload);
      const state = thunkAPI.getState();
      const existedUserCoinIsInWalletSymbol =
        selectAllCoinWithIsInWalletSymbol(state);
      const previousData = payload?.page > 1 ? state?.currency?.allCoins : [];
      const data = Array?.isArray(resp?.data?.data) ? resp?.data?.data : [];
      const total = resp?.data?.total;

      const newData = data.map(item => {
        const key = generateUniqueKeyForChain(item);
        return {
          ...item,
          isInWallet: !!existedUserCoinIsInWalletSymbol[key],
        };
      });
      const finalData = [...previousData, ...newData];
      dispatch(setAllCoins(finalData));
      const isAvailable = total > finalData.length;
      dispatch(setAllCoinsAvailable(isAvailable));
    } catch (e) {
      console.error('Error in all coins', e);
      setAllCoinsError(e?.message);
    }
  },
);

export const fetchGroupCoins = createAsyncThunk(
  'currency/fetchGroupCoins',
  async (payload, thunkAPI) => {
    const dispatch = thunkAPI.dispatch;
    try {
      if (payload.page === 1) {
        dispatch(setGroupCoinsLoading(true));
      }
      const resp = await fetchCoinGroupAPI(payload);
      const state = thunkAPI.getState();
      const previousData =
        payload?.page > 1 ? state?.currency?.allGroupCoins : [];
      const data = Array?.isArray(resp?.data?.data) ? resp?.data?.data : [];
      const total = resp?.data?.total;
      const finalData = [...previousData, ...data];
      dispatch(setAllGroupCoins(finalData));
      const isAvailable = total > finalData.length;
      dispatch(setAllGroupCoinAvailable(isAvailable));
    } catch (e) {
      dispatch(setGroupCoinsLoading(false));
      console.error('Error in all group coins', e);
    }
  },
);

export const checkNewCoinAvailable = createAsyncThunk(
  'currency/checkNewCoinAvailable',
  async (_, thunkAPI) => {
    const resp = await fetchCurrenciesAPI({ limit: 200, status: true });
    const newCoins = Array?.isArray(resp?.data?.data) ? resp?.data?.data : [];
    const currentState = thunkAPI.getState();
    const dispatch = thunkAPI.dispatch;
    const allCoins = selectAllCoinsWalletByMnemonic(currentState) || [];
    if (allCoins.length) {
      const addedCoins = newCoins?.filter(
        item =>
          allCoins.findIndex(
            subItem =>
              item.chain_name === subItem.chain_name &&
              item.symbol === subItem.symbol,
          ) === -1,
      );
      dispatch(setNewCoins(addedCoins));
    }
  },
);

export const checkNewsAvailable = createAsyncThunk(
  'currency/checkNewsAvailable',
  async (payload, thunkAPI) => {
    try {
      const key = payload?.key;
      const resp = await getNewsAPI(key);
      const data = Array?.isArray(resp?.data) ? resp?.data : [];
      const foundData = data.find(item => item.key === key);
      const message = foundData?.message;
      if (message && typeof message === 'string') {
        thunkAPI.dispatch(setNewsMessage(message));
      }
    } catch (e) {
      console.error('Error in get news', e);
    }
  },
);

const searchHandler = async (payload, thunkAPI) => {
  try {
    const dispatch = thunkAPI.dispatch;
    const resp = await fetchCurrenciesAPI(payload);
    const state = thunkAPI.getState();
    const existedUserCoinIsInWalletSymbol =
      selectAllCoinWithIsInWalletSymbol(state);
    const previousData =
      payload?.page > 1 ? state?.currency?.searchAllCoins : [];
    const data = Array?.isArray(resp?.data?.data) ? resp?.data?.data : [];
    const total = resp?.data?.total;
    const newData = data.map(item => {
      const key = generateUniqueKeyForChain(item);
      return {
        ...item,
        isInWallet: !!existedUserCoinIsInWalletSymbol[key],
      };
    });
    const finalData = [...previousData, ...newData];
    dispatch(setSearchAllCoins(finalData));
    const isAvailable = total > finalData.length;
    dispatch(setSearchAllCoinsAvailable(isAvailable));
  } catch (e) {
    console.error('Error in search all coins', e);
    setSearchAllCoinsError(e?.message);
  }
};

const debouncedSearchHandler = debounce(searchHandler, 800);

export const fetchAllSearchCoinsWithDebounce = createAsyncThunk(
  'currency/fetchAllSearchCoinsWithDebounce',
  debouncedSearchHandler,
);

export const fetchAllSearchCoins = createAsyncThunk(
  'currency/fetchAllSearchCoins',
  searchHandler,
);

const searchCoinGroupHandler = async (payload, thunkAPI) => {
  const dispatch = thunkAPI.dispatch;
  try {
    const resp = await fetchCoinGroupAPI(payload);
    const state = thunkAPI.getState();
    const allActiveCoins = selectUserCoins(state);
    const previousData =
      payload?.page > 1 ? state?.currency?.searchAllGroupCoins : [];
    const data = Array?.isArray(resp?.data?.data) ? resp?.data?.data : [];
    const total = resp?.data?.total;

    const newData = data.map(item => {
      const tempCoins = item?.coins || [];
      const isGroupCoinsAdded = tempCoins.every(coin => {
        const key = generateUniqueKeyForChain(coin);
        return !!allActiveCoins.find(activeCoin => {
          const activeCoinKey = activeCoin?.key;
          return key === activeCoinKey;
        });
      });
      return {
        ...item,
        isGroupCoinsAdded,
      };
    });
    const finalData = [...previousData, ...newData];
    dispatch(setSearchAllGroupCoins(finalData));
    const isAvailable = total > finalData.length;
    dispatch(setSearchAllGroupCoinsAvailable(isAvailable));
  } catch (e) {
    dispatch(setSearchGroupCoinsLoading(false));
    console.error('Error in all search group coins', e);
  }
};

const debouncedSearchCoinGroupHandler = debounce(searchCoinGroupHandler, 800);

export const fetchAllSearchCoinsGroupWithDebounce = createAsyncThunk(
  'currency/fetchAllSearchCoinsGroupWithDebounce',
  debouncedSearchCoinGroupHandler,
);

export const fetchAllSearchCoinsGroup = createAsyncThunk(
  'currency/fetchAllSearchCoinsGroup',
  searchCoinGroupHandler,
);

export const searchAndAddCoins = createAsyncThunk(
  'wallets/searchAndAddCoins',
  async (payload, thunkAPI) => {
    const state = thunkAPI.getState();
    const dispatch = thunkAPI.dispatch;
    try {
      const { currency } = payload;
      const [chainName, symbol] = currency?.split(':') || [];

      const userCoins = selectUserCoins(state).filter(
        coin => coin.chain_name === chainName,
      );

      const hasExactCoin = userCoins.find(
        coin => coin.type === 'coin' && coin.symbol === symbol,
      );
      if (hasExactCoin) {
        dispatch(setCurrentCoin(hasExactCoin?._id));
        return;
      }

      const coinsList = [];
      let isCoinsMissing = false;

      const hasChain = userCoins.find(coin => coin.type === 'coin');

      if (hasChain) {
        coinsList.push(hasChain);
      } else {
        const fetched = await dispatch(
          fetchCurrencies({ search: chainName.replace(/_/g, ' ') }),
        ).unwrap();
        const found = fetched.find(
          coin =>
            coin.chain_name === chainName &&
            (coin.type === 'coin' || coin.symbol === symbol),
        );
        if (found) {
          coinsList.push(found);
        }
        isCoinsMissing = true;
      }

      const hasToken = userCoins.find(
        coin => coin.type === 'token' && coin.symbol === symbol,
      );
      if (hasToken) {
        dispatch(setCurrentCoin(hasToken?._id));
        coinsList.push(hasToken);
      } else {
        const fetched = await dispatch(
          fetchCurrencies({ search: symbol }),
        ).unwrap();
        const found = fetched.find(
          coin =>
            coin.chain_name === chainName &&
            coin.type === 'token' &&
            coin.symbol === symbol,
        );
        if (found) {
          coinsList.push(found);
        }
        isCoinsMissing = true;
      }

      if (isCoinsMissing) {
        dispatch(setMissingCoins(coinsList));
        throw new Error('Currency not found in the selected wallet');
      }
    } catch (err) {
      console.error('Error in searchAndAddCoins:', err);
      throw err;
    }
  },
);

export const currencySlice = createSlice({
  name: 'currency',
  initialState,
  reducers: {
    setCurrencies(state, { payload }) {
      state.currencies = payload;
      state.loading = false;
      state.error = null;
    },
    setCurrencyError(state, { payload }) {
      state.error = payload;
      state.loading = false;
    },
    setCurrencyLoading(state, { payload }) {
      state.loading = payload;
    },
    setAllCoins(state, { payload }) {
      state.allCoins = payload;
      state.allCoinsLoading = false;
      state.allCoinError = null;
    },
    setAllCoinsError(state, { payload }) {
      state.allCoinError = payload;
      state.allCoinsLoading = false;
    },
    setAllCoinsLoading(state, { payload }) {
      state.allCoinsLoading = payload;
    },
    setAllCoinsAvailable(state, { payload }) {
      state.isAllCoinAvailable = payload;
    },
    setGroupCoinsLoading(state, { payload }) {
      state.groupCoinsLoading = payload;
    },
    setAllGroupCoins(state, { payload }) {
      state.allGroupCoins = payload;
      state.groupCoinsLoading = false;
    },
    setAllGroupCoinAvailable(state, { payload }) {
      state.isAllGroupCoinAvailable = payload;
    },
    setIsAskedBackupModal(state, { payload }) {
      state.isAskedBackedUpModal[payload] = true;
    },
    setSearchAllGroupCoinsAvailable(state, { payload }) {
      state.searchIsAllGroupCoinAvailable = payload;
    },
    setSearchGroupCoinsLoading(state, { payload }) {
      state.searchAllGroupCoinsLoading = payload;
    },
    setSearchAllGroupCoins(state, { payload }) {
      state.searchAllGroupCoins = payload;
      state.searchAllGroupCoinsLoading = false;
    },
    setSearchAllCoins(state, { payload }) {
      state.searchAllCoins = payload;
      state.searchAllCoinsLoading = false;
      state.allCoinError = null;
    },
    setSearchAllCoinsError(state, { payload }) {
      state.searchAllCoinError = payload;
      state.searchAllCoinsLoading = false;
    },
    setSearchAllCoinsLoading(state, { payload }) {
      state.searchAllCoinsLoading = payload;
    },
    setSearchAllCoinsAvailable(state, { payload }) {
      state.searchIsAllCoinAvailable = payload;
    },
    setNewCoins(state, { payload }) {
      state.newCoins = payload;
    },
    setNewsMessage(state, { payload }) {
      state.newsMessage = payload;
    },
    setNewsModalVisible(state, { payload }) {
      state.newsModalVisible = payload;
    },
    setIsAddingGroup(state, { payload }) {
      state.isAddingGroup = { ...state.isAddingGroup, [payload]: true };
    },
    setIsRemovingGroup(state, { payload }) {
      state.isAddingGroup = { ...state.isAddingGroup, [payload]: false };
    },
    resetIsAddingGroup(state) {
      state.isAddingGroup = {};
    },
    setMissingCoins(state, { payload }) {
      state.missingCoins = payload;
    },
  },
  extraReducers: builder => {
    builder.addCase(fetchCurrencies.fulfilled, (state, { payload }) => {
      state.currencies = payload;
      state.loading = false;
      state.error = null;
    });
    builder.addCase(fetchCurrencies.rejected, (state, { payload }) => {
      state.error = payload;
      state.loading = false;
    });
    builder.addCase(searchAndAddCoins.pending, state => {
      state.loading = true;
    });
    builder.addCase(searchAndAddCoins.fulfilled, state => {
      state.loading = false;
    });
    builder.addCase(searchAndAddCoins.rejected, state => {
      state.loading = false;
    });
  },
});

export const {
  setCurrencies,
  setCurrencyError,
  setCurrencyLoading,
  setAllCoinsError,
  setAllCoinsLoading,
  setAllCoins,
  setAllCoinsAvailable,
  setIsAskedBackupModal,
  setSearchAllCoinsAvailable,
  setSearchAllCoinsError,
  setSearchAllCoinsLoading,
  setSearchAllCoins,
  setNewCoins,
  setNewsMessage,
  setNewsModalVisible,
  setGroupCoinsLoading,
  setAllGroupCoins,
  setAllGroupCoinAvailable,
  setSearchAllGroupCoins,
  setSearchAllGroupCoinsAvailable,
  setSearchGroupCoinsLoading,
  resetIsAddingGroup,
  setIsAddingGroup,
  setIsRemovingGroup,
  setMissingCoins,
} = currencySlice.actions;
