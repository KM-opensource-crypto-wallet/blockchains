import {createSelector} from '@reduxjs/toolkit';

// Basic selectors
export const selectCoinSyncStatus = state => state.coinSync?.status || 'idle';

export const selectCoinsWithBalance = state =>
  state.coinSync?.coinsWithBalance || [];

export const selectTotalCoins = state => state.coinSync?.totalCoins || 0;

export const selectScannedCoins = state => state.coinSync?.scannedCoins || 0;

export const selectCurrentSyncingCoin = state =>
  state.coinSync?.currentSyncingCoin || null;

export const selectSyncingWalletIndex = state =>
  state.coinSync?.syncingWalletIndex;

export const selectIsFetching = state => state.coinSync?.status === 'fetching';

export const selectIsCreatingWallets = state =>
  state.coinSync?.status === 'creating_wallets';

export const selectIsSyncing = state =>
  state.coinSync?.status === 'syncing' ||
  state.coinSync?.status === 'creating_wallets' ||
  state.coinSync?.status === 'fetching';

// Count of selected coins
export const selectSelectedCount = createSelector(
  [selectCoinsWithBalance],
  coins => coins.filter(c => c.isSelected).length,
);

// Total coins with balance count
export const selectCoinsWithBalanceCount = createSelector(
  [selectCoinsWithBalance],
  coins => coins.length,
);

// Progress selector
export const selectCoinSyncProgress = createSelector(
  [selectTotalCoins, selectScannedCoins],
  (totalCoins, scannedCoins) => ({
    totalCoins,
    completedCoins: scannedCoins,
  }),
);

// Widget visibility selector
export const selectShouldShowWidget = createSelector(
  [selectCoinSyncStatus],
  status =>
    status === 'syncing' ||
    status === 'creating_wallets' ||
    status === 'fetching',
);

// Selector for widget display data
export const selectWidgetData = createSelector(
  [selectCoinSyncProgress, selectCurrentSyncingCoin, selectCoinSyncStatus],
  (progress, currentCoin, status) => ({
    ...progress,
    currentCoinName: currentCoin?.name || '',
    currentCoinSymbol: currentCoin?.symbol || '',
    currentCoinIcon: currentCoin?.icon || '',
    isCreatingWallets: status === 'creating_wallets',
    isSyncing:
      status === 'syncing' ||
      status === 'creating_wallets' ||
      status === 'fetching',
    isFetching: status === 'fetching',
  }),
);
