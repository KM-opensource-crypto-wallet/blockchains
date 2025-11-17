export const getUserPassword = state => state.auth.password;
export const getIsLogin = state => state.auth.isLogin;
export const getLoading = state => state.auth.loading;
export const getFingerprintAuth = state => state.auth.fingerprintAuth;

export const getLastUpdateCheckTimestamp = state =>
  state.auth.lastUpdateCheckTimestamp;

export const getAttempts = state => state.auth.attempts;
export const getIsLocked = state => state.auth.isLocked;
export const getMaxAttempt = state => state.auth.maxAttempt;
