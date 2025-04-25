export const getSellCryptoProviders = state => [
  ...(state?.sellCrypto?.providers || []),
];
export const getSellCryptoLoading = state =>
  state?.sellCrypto?.loading ?? false;
export const getSellCryptoError = state => state?.sellCrypto?.error ?? null;
export const getSellCryptoTransferDetails = state =>
  state.sellCrypto.transferDetails || null;
export const getSellCryptoRequestDetails = state =>
  state.sellCrypto.requestDetails || null;
