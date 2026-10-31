/*
 * WalletConnect Verify API result for a session proposal or request
 * (`verifyContext.verified`). It says whether the request came from the domain
 * the dApp registered and whether that domain is flagged as malicious; it says
 * nothing about the request itself. UNKNOWN is normal for unregistered dApps
 * (and always for React Native dApps), so it is shown as neutral.
 *
 *   isScam              -> 'scam'      (flagged as malicious)
 *   validation INVALID  -> 'mismatch'  (sent from another domain)
 *   validation VALID    -> 'verified'
 *   anything else       -> 'unknown'
 */
export const getWalletConnectVerifyStatus = verifyContext => {
  const verified = verifyContext?.verified;
  const origin = typeof verified?.origin === 'string' ? verified.origin : '';
  if (verified?.isScam === true) {
    return {status: 'scam', origin};
  }
  if (verified?.validation === 'INVALID') {
    return {status: 'mismatch', origin};
  }
  if (verified?.validation === 'VALID') {
    return {status: 'verified', origin};
  }
  return {status: 'unknown', origin};
};

export const isRiskyVerifyStatus = status =>
  status === 'scam' || status === 'mismatch';

// "https://app.example.com/path" -> "app.example.com"; returns the input when
// it is not a URL.
export const verifyHost = value => {
  if (typeof value !== 'string' || !value) {
    return '';
  }
  try {
    return new URL(value).host || value;
  } catch (e) {
    return value;
  }
};
