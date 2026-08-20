import {createSlice, createAsyncThunk} from '@reduxjs/toolkit';
import {
  getExchangeTransactions,
  getExchangeTransactionById,
} from 'dok-wallet-blockchain-networks/service/dokApi';
import {selectCurrentWalletClientId} from 'dok-wallet-blockchain-networks/redux/wallets/walletsSelector';

const PAGE_SIZE = 20;

const initialState = {
  transactions: [],
  meta: {
    currentPage: 0,
    totalPages: 0,
    totalItems: 0,
  },
  loading: false,
  refreshing: false,
  loadingMore: false,
  error: null,
  currentTransaction: null,
  detailLoading: false,
  detailRefreshing: false,
  detailError: null,
  // Latest-wins guards (same pattern as exchangeSlice.quoteRequestId): the
  // pending reducer stamps the id, fulfilled/rejected only commit when their
  // requestId still matches. listRequestId is shared by the first-page and
  // load-more thunks, so a wallet switch mid-flight invalidates a stale
  // page append too — without this, a slow response for the previous wallet
  // overwrites the current wallet's history.
  listRequestId: null,
  detailRequestId: null,
};

/**
 * First page load / pull-to-refresh of the current wallet's swap history.
 * Pass {refresh: true} to show the RefreshControl spinner instead of the
 * full-screen loader.
 */
export const fetchExchangeTransactions = createAsyncThunk(
  'exchangeHistory/fetchExchangeTransactions',
  async (_, {getState, rejectWithValue}) => {
    try {
      const walletClientId = selectCurrentWalletClientId(getState());
      if (!walletClientId) {
        return rejectWithValue('No wallet selected');
      }
      const resp = await getExchangeTransactions({
        walletClientId,
        page: 1,
        limit: PAGE_SIZE,
      });
      return resp?.data;
    } catch (err) {
      return rejectWithValue(
        err?.response?.data?.message ||
          err?.message ||
          'Failed to fetch exchange transactions',
      );
    }
  },
);

/** Next-page fetch for infinite scroll; no-ops while busy or on the last page. */
export const fetchMoreExchangeTransactions = createAsyncThunk(
  'exchangeHistory/fetchMoreExchangeTransactions',
  async (_, {getState, rejectWithValue}) => {
    try {
      const walletClientId = selectCurrentWalletClientId(getState());
      const {meta} = getState().exchangeHistory;
      const resp = await getExchangeTransactions({
        walletClientId,
        page: meta.currentPage + 1,
        limit: PAGE_SIZE,
      });
      return resp?.data;
    } catch (err) {
      return rejectWithValue(
        err?.response?.data?.message ||
          err?.message ||
          'Failed to fetch exchange transactions',
      );
    }
  },
  {
    condition: (_, {getState}) => {
      const {loading, loadingMore, refreshing, meta} =
        getState().exchangeHistory;
      if (loading || loadingMore || refreshing) {
        return false;
      }
      return meta.currentPage < meta.totalPages;
    },
  },
);

/**
 * Detail fetch; the backend refreshes a non-terminal transaction from its
 * provider before responding, so this doubles as the polling call.
 * Pass {id, refresh: true} for pull-to-refresh so the RefreshControl
 * spinner stays on until this settles; the background poll omits it and
 * shows no spinner at all.
 */
export const fetchExchangeTransactionDetails = createAsyncThunk(
  'exchangeHistory/fetchExchangeTransactionDetails',
  async ({id}, {getState, rejectWithValue}) => {
    try {
      const walletClientId = selectCurrentWalletClientId(getState());
      if (!walletClientId) {
        return rejectWithValue('No wallet selected');
      }
      const resp = await getExchangeTransactionById(id, walletClientId);
      return resp?.data;
    } catch (err) {
      return rejectWithValue(
        err?.response?.data?.message ||
          err?.message ||
          'Failed to fetch exchange transaction',
      );
    }
  },
);

export const exchangeHistorySlice = createSlice({
  name: 'exchangeHistory',
  initialState,
  reducers: {
    resetExchangeHistory() {
      return initialState;
    },
    clearCurrentExchangeTransaction(state) {
      state.currentTransaction = null;
      state.detailError = null;
      // Invalidate any in-flight detail request: dropping the stamped id
      // makes the requestId guards ignore its late settle, which would
      // otherwise write the stale transaction/error back after this clear.
      state.detailRequestId = null;
      state.detailLoading = false;
      state.detailRefreshing = false;
    },
  },
  extraReducers: builder => {
    builder
      .addCase(fetchExchangeTransactions.pending, (state, action) => {
        state.listRequestId = action.meta.requestId;
        if (action.meta.arg?.refresh) {
          state.refreshing = true;
        } else {
          state.loading = true;
        }
        state.error = null;
      })
      .addCase(fetchExchangeTransactions.fulfilled, (state, action) => {
        if (state.listRequestId !== action.meta.requestId) {
          return;
        }
        state.loading = false;
        state.refreshing = false;
        state.transactions = action.payload?.items || [];
        state.meta = {...initialState.meta, ...action.payload?.meta};
      })
      .addCase(fetchExchangeTransactions.rejected, (state, action) => {
        if (state.listRequestId !== action.meta.requestId) {
          return;
        }
        state.loading = false;
        state.refreshing = false;
        state.error = action.payload || 'Something went wrong';
      })
      .addCase(fetchMoreExchangeTransactions.pending, (state, action) => {
        state.listRequestId = action.meta.requestId;
        state.loadingMore = true;
      })
      .addCase(fetchMoreExchangeTransactions.fulfilled, (state, action) => {
        // Clear the flag even for a superseded request — only one load-more
        // can be in flight (the condition blocks on loadingMore), so this
        // settle always belongs to it; leaving it set would block pagination
        // forever after a first-page fetch preempted the page append.
        state.loadingMore = false;
        if (state.listRequestId !== action.meta.requestId) {
          return;
        }
        const existingIds = new Set(state.transactions.map(tx => tx._id));
        const newItems = (action.payload?.items || []).filter(
          tx => !existingIds.has(tx._id),
        );
        state.transactions = [...state.transactions, ...newItems];
        state.meta = {...state.meta, ...action.payload?.meta};
      })
      .addCase(fetchMoreExchangeTransactions.rejected, state => {
        state.loadingMore = false;
      })
      .addCase(fetchExchangeTransactionDetails.pending, (state, action) => {
        state.detailRequestId = action.meta.requestId;
        const {id, refresh} = action.meta.arg || {};
        // Keep showing the current data during a refetch of the same tx;
        // a pull-to-refresh keeps the RefreshControl spinner going, the
        // background poll stays invisible.
        if (state.currentTransaction?._id !== id) {
          state.currentTransaction = null;
          state.detailLoading = true;
        } else if (refresh) {
          state.detailRefreshing = true;
        }
        state.detailError = null;
      })
      .addCase(fetchExchangeTransactionDetails.fulfilled, (state, action) => {
        if (state.detailRequestId !== action.meta.requestId) {
          return;
        }
        state.detailLoading = false;
        state.detailRefreshing = false;
        if (action.payload) {
          state.currentTransaction = action.payload;
          // Keep the list row in sync with the refreshed status.
          const index = state.transactions.findIndex(
            tx => tx._id === action.payload._id,
          );
          if (index !== -1) {
            state.transactions[index] = action.payload;
          }
        }
      })
      .addCase(fetchExchangeTransactionDetails.rejected, (state, action) => {
        if (state.detailRequestId !== action.meta.requestId) {
          return;
        }
        state.detailLoading = false;
        state.detailRefreshing = false;
        state.detailError = action.payload || 'Something went wrong';
      });
  },
});

export const {resetExchangeHistory, clearCurrentExchangeTransaction} =
  exchangeHistorySlice.actions;
