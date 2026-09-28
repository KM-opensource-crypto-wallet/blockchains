// Stable references: a fresh array per call makes useSelector re-render on
// every store update. Consumers only read it.
const NO_PROVIDERS = Object.freeze([]);
export const getSellCryptoProviders = state =>
  state?.sellCrypto?.providers || NO_PROVIDERS;
export const getSellCryptoLoading = state =>
  state?.sellCrypto?.loading ?? false;
export const getSellCryptoError = state => state?.sellCrypto?.error ?? null;
export const getSellCryptoTransferDetails = state =>
  state.sellCrypto.transferDetails || null;
export const getSellCryptoRequestDetails = state =>
  state.sellCrypto.requestDetails || null;
