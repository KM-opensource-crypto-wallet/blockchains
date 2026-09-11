// refreshAllWalletsCoins progress: whole run in flight, and the wallet whose
// coins are currently being fetched.
export const selectIsRefreshingAllWallets = state =>
  !!state.walletsRefresh?.isRefreshing;

export const selectRefreshingWalletClientId = state =>
  state.walletsRefresh?.refreshingWalletClientId || null;
