// A `|| []` / `|| {}` fallback builds a fresh reference on every call, so
// useSelector sees a new result for an unchanged state and warns (and rerenders)
// whenever the slice key is missing. Hand out one stable empty value instead.
// Treat both as read-only - they are shared by every selector below.
const EMPTY_ARRAY = [];
const EMPTY_OBJECT = {};

export const getCryptoProviders = state => state.cryptoProvider.providers || [];
export const getCryptoProvidersOTC = state =>
  state.cryptoProvider.shownOTC || false;

export const getCryptoProvidersLoading = state =>
  state.cryptoProvider.loading || false;

export const getSelectedCountry = state => state?.cryptoProvider?.country;
export const getFetchProvider = state => state?.cryptoProvider?.fetchProvider;
export const getDisableMessage = state => state?.cryptoProvider?.disableMessage;
export const getExchangeProviders = state =>
  state?.cryptoProvider?.exchangeProviders || '';
export const getSellCryptoAllProviders = state =>
  state?.cryptoProvider?.sellCryptoProviders || EMPTY_ARRAY;
export const getMessageAllowUrls = state =>
  state?.cryptoProvider?.messageAllowUrls || EMPTY_ARRAY;

export const getBitcoinFeeMultiplier = state =>
  state?.cryptoProvider?.bitcoin_fee_multiplier || EMPTY_OBJECT;

export const getLitecoinFeeMultiplier = state =>
  state?.cryptoProvider?.litecoin_fee_multiplier || EMPTY_OBJECT;
export const getDogecoinFeeMultiplier = state =>
  state?.cryptoProvider?.dogecoin_fee_multiplier || EMPTY_OBJECT;
export const getBitcoinCashFeeMultiplier = state =>
  state?.cryptoProvider?.bitcoin_cash_fee_multiplier || EMPTY_OBJECT;
export const getZcashFeeMultiplier = state =>
  state?.cryptoProvider?.zcash_fee_multiplier || EMPTY_OBJECT;
export const getAdditionalL1FeePercentage = state =>
  state?.cryptoProvider?.additional_l1_fee_percentages || EMPTY_OBJECT;

export const getGoogleAnalyticsKey = state =>
  state?.cryptoProvider?.google_analytics_key;

export const getIsMaxWalletLimitReached = state =>
  state?.cryptoProvider?.is_max_wallet_limit_reached;

export const getAndroidLatestVersion = state =>
  state?.cryptoProvider?.android_latest_version;

export const getTutorialVideos = state =>
  state?.cryptoProvider?.tutorial_videos || EMPTY_ARRAY;
