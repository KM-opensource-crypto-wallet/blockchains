import {createAsyncThunk, createSlice} from '@reduxjs/toolkit';
import {selectVisibleWallets} from 'dok-wallet-blockchain-networks/redux/wallets/walletsSelector';
import {refreshCoins} from 'dok-wallet-blockchain-networks/redux/wallets/walletsSlice';
import {selectIsRefreshingAllWallets} from 'dok-wallet-blockchain-networks/redux/walletsRefresh/walletsRefreshSelectors';
import {logger} from 'services/logger';

// In-flight UI state for the "refresh all wallets" action on the Wallets
// screen. Deliberately its own slice, blacklisted from redux-persist in
// src/redux/store.js: if it lived in the persisted `wallets` slice, quitting
// the app mid-refresh would rehydrate `isRefreshing: true` with no thunk left
// to ever clear it, leaving the button spinning and disabled forever.
const initialState = {
  // Whole run in flight → header spinner, button disabled, re-entry blocked.
  isRefreshing: false,
  // Wallet whose coins are currently being fetched → spinner on that card.
  refreshingWalletClientId: null,
};

export const refreshAllWalletsCoins = createAsyncThunk(
  'walletsRefresh/refreshAllWalletsCoins',
  async (_, thunkAPI) => {
    const clientIds = selectVisibleWallets(thunkAPI.getState()).map(
      wallet => wallet.clientId,
    );
    let failed = 0;
    try {
      // Sequential on purpose: each wallet's coins already fan out in
      // parallel inside refreshCoins, so running wallets back-to-back keeps
      // the RPC load bounded to one wallet at a time. Each wallet is written
      // to the store as soon as it finishes (refreshCoins.fulfilled).
      for (const clientId of clientIds) {
        // Re-read at its turn: an earlier wallet's refresh takes a while, and
        // the user may have deleted/hidden this one or toggled its coins in
        // the meantime. Passing a stale object would write those coins back.
        const wallet = selectVisibleWallets(thunkAPI.getState()).find(
          item => item.clientId === clientId,
        );
        if (!wallet) {
          continue;
        }
        thunkAPI.dispatch(setRefreshingWalletClientId(wallet.clientId));
        try {
          await thunkAPI
            .dispatch(refreshCoins({currentWallet: wallet}))
            .unwrap();
        } catch (e) {
          // refreshCoins already logged and breadcrumbed the failure.
          failed += 1;
        }
      }
    } finally {
      thunkAPI.dispatch(setRefreshingWalletClientId(null));
    }
    // Counts only: wallet names and balances must not reach Sentry.
    logger.info('wallets.refresh_all', {total: clientIds.length, failed});
    return {total: clientIds.length, failed};
  },
  {
    // Ignore taps while a run is in flight (double-tap / re-entry guard).
    condition: (_, {getState}) => !selectIsRefreshingAllWallets(getState()),
  },
);

export const walletsRefreshSlice = createSlice({
  name: 'walletsRefresh',
  initialState,
  reducers: {
    setRefreshingWalletClientId: (state, {payload}) => {
      state.refreshingWalletClientId = payload ?? null;
    },
  },
  extraReducers: builder => {
    builder.addCase(refreshAllWalletsCoins.pending, state => {
      state.isRefreshing = true;
    });
    builder.addCase(refreshAllWalletsCoins.fulfilled, state => {
      state.isRefreshing = false;
      state.refreshingWalletClientId = null;
    });
    builder.addCase(refreshAllWalletsCoins.rejected, state => {
      state.isRefreshing = false;
      state.refreshingWalletClientId = null;
    });
  },
});

export const {setRefreshingWalletClientId} = walletsRefreshSlice.actions;

export default walletsRefreshSlice.reducer;
