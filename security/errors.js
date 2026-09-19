// Error types shared by the vault core and by each app's platform adapters
// (`security/vaultCrypto`, `security/secureStore`). Callers branch on `code`,
// never on the message, so the message can stay human-readable.

export const VAULT_ERROR_CODES = Object.freeze({
  INVALID_PASSWORD: 'invalid_password',
  NO_VAULT: 'no_vault',
  VAULT_EXISTS: 'vault_exists',
  LOCKED: 'locked',
  UNSUPPORTED_ENVELOPE: 'unsupported_envelope',
  CORRUPT_ENVELOPE: 'corrupt_envelope',
  BIOMETRIC_UNSUPPORTED: 'biometric_unsupported',
  BIOMETRIC_NOT_ENROLLED: 'biometric_not_enrolled',
  BIOMETRIC_INVALIDATED: 'biometric_invalidated',
  BIOMETRIC_CANCELLED: 'biometric_cancelled',
});

export class VaultError extends Error {
  constructor(code, message, cause) {
    super(message || code);
    this.name = 'VaultError';
    this.code = code;
    if (cause !== undefined) {
      this.cause = cause;
    }
  }
}

export const SECURE_STORE_ERROR_CODES = Object.freeze({
  // Biometric enrollment changed; the platform destroyed the key.
  KEY_INVALIDATED: 'key_invalidated',
  // The user dismissed the OS authentication prompt.
  USER_CANCELLED: 'user_cancelled',
  // Store cannot be opened at all (no Keystore, no IndexedDB, private window).
  UNAVAILABLE: 'unavailable',
  UNKNOWN: 'unknown',
});

export class SecureStoreError extends Error {
  constructor(code, message, cause) {
    super(message || code);
    this.name = 'SecureStoreError';
    this.code = code;
    if (cause !== undefined) {
      this.cause = cause;
    }
  }
}

export const VAULT_CRYPTO_ERROR_CODES = Object.freeze({
  // AES-GCM tag mismatch: wrong key, wrong AAD or tampered ciphertext.
  AUTH_FAILED: 'auth_failed',
  UNAVAILABLE: 'unavailable',
});

export class VaultCryptoError extends Error {
  constructor(code, message, cause) {
    super(message || code);
    this.name = 'VaultCryptoError';
    this.code = code;
    if (cause !== undefined) {
      this.cause = cause;
    }
  }
}

export const isErrorCode = (error, code) =>
  Boolean(error) && error.code === code;
