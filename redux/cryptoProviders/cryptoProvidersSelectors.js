export const getCryptoProviders = state => state.cryptoProvider.providers || [];
export const getCryptoProvidersOTC = state =>
  state.cryptoProvider.shownOTC || false;

export const getCryptoProvidersLoading = state =>
  state.cryptoProvider.loading || false;

export const getSelectedCountry = state => state?.cryptoProvider?.country;
export const getFetchProvider = state => state?.cryptoProvider?.fetchProvider;
export const getDisableMessage = state => state?.cryptoProvider?.disableMessage;
export const getExchangeProviders = state =>
  state?.cryptoProvider?.exchangeProviders || [];
export const getSellCryptoAllProviders = state =>
  state?.cryptoProvider?.sellCryptoProviders || [];
export const getMessageAllowUrls = state =>
  state?.cryptoProvider?.messageAllowUrls || [];

export const getCmcApiKeys = state => state?.cryptoProvider?.cmc_api_keys || [];
export const getBitcoinFeeMultiplier = state =>
  state?.cryptoProvider?.bitcoin_fee_multiplier || {};

export const getLitecoinFeeMultiplier = state =>
  state?.cryptoProvider?.litecoin_fee_multiplier || {};
export const getDogecoinFeeMultiplier = state =>
  state?.cryptoProvider?.dogecoin_fee_multiplier || {};
export const getBitcoinCashFeeMultiplier = state =>
  state?.cryptoProvider?.bitcoin_cash_fee_multiplier || {};

export const getAdditionalL1Fee = state =>
  state?.cryptoProvider?.additional_l1_fees || {};

export const getGoogleAnalyticsKey = state =>
  state?.cryptoProvider?.google_analytics_key;

export const getIsMaxWalletLimitReached = state =>
  state?.cryptoProvider?.is_max_wallet_limit_reached;
