// "Has this device completed onboarding?" — the routing check. The migrator
// derives it from the legacy blob; the password itself is never in state.
export const getHasAccount = state => Boolean(state.auth.hasAccount);
export const getIsLogin = state => state.auth.isLogin;
export const getLoading = state => state.auth.loading;
export const getFingerprintAuth = state => state.auth.fingerprintAuth;

export const getLastUpdateCheckTimestamp = state =>
  state.auth.lastUpdateCheckTimestamp;

export const getAttempts = state => state.auth.attempts;
export const getMaxAttempt = state => state.auth.maxAttempt;
export const getLastAttempt = state => state.auth.lastAttempt;
export const getIsVaultUnlocked = state => Boolean(state.auth.isVaultUnlocked);
