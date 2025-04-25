export const selectAllCurrencies = state => state.currency.currencies;
export const selectAllActiveCurrencies = state =>
  state?.currency?.currencies?.filter(item => item?.status);
export const selectAllActiveCoins = state =>
  state?.currency?.currencies?.filter(
    item => item?.status && item.type?.toLowerCase() === 'coin',
  );
export const selectAllActiveTokens = state =>
  state?.currency?.currencies?.filter(
    item => item?.status && item.type?.toLowerCase() === 'token',
  );
export const selectAllCoins = state => state?.currency?.allCoins;
export const selectSearchAllCoins = state => state?.currency?.searchAllCoins;
export const isAskedBackedUpModal = state =>
  state?.currency?.isAskedBackedUpModal;
export const isAllCoinsAvailable = state => state?.currency?.isAllCoinAvailable;
export const isSearchAllCoinsAvailable = state =>
  state?.currency?.searchIsAllCoinAvailable;
export const isAllCoinsLoading = state => state?.currency?.allCoinsLoading;
export const isSearchAllCoinsLoading = state =>
  state?.currency?.searchAllCoinsLoading;
export const selectAllTokens = state =>
  state?.currency?.currencies?.filter(
    item => item.type?.toLowerCase() === 'token',
  );
export const selectAllNewCoins = state => state?.currency?.newCoins;
export const getNewsMessage = state => state?.currency?.newsMessage;
export const getNewsModalVisible = state => state.currency?.newsModalVisible;

export const selectAllCoinsGroup = state => state?.currency?.allGroupCoins;
export const selectSearchAllCoinsGroup = state =>
  state?.currency?.searchAllGroupCoins;
export const isAllGroupCoinAvailable = state =>
  state?.currency?.isAllGroupCoinAvailable;
export const isSearchIsAllGroupCoinAvailable = state =>
  state?.currency?.searchIsAllGroupCoinAvailable;
export const isGroupCoinsLoading = state => state?.currency?.groupCoinsLoading;
export const isSearchAllGroupCoinsLoading = state =>
  state?.currency?.searchAllGroupCoinsLoading;

export const isAddingGroup = state => state?.currency?.isAddingGroup;
