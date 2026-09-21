// Pure vault primitives: envelope format, DEK wrapping and blob/state sealing.
//
// Platform crypto comes from the `security/vaultCrypto` alias, which each app
// resolves to its own adapter (mobile: react-native-quick-crypto; web:
// WebCrypto). Same pattern as `myWallet/wallet.service` and `utils/hideWallet`.
// Nothing in this file may branch on platform.
//
// Envelope v1 (all byte fields base64):
//   DEK wrap : {v:1, kdf:{alg, iterations, salt}, cipher, iv, ct, aad, createdAt, updatedAt}
//   blob     : {v:1, cipher, iv, ct, aad}
// `ct` always carries the 16-byte GCM tag appended (WebCrypto's native shape).
// `aad` binds a ciphertext to its purpose so a DEK wrap can never be fed to the
// blob decryptor or vice versa.
import * as vaultCrypto from 'security/vaultCrypto';
import {
  VAULT_CRYPTO_ERROR_CODES,
  VAULT_ERROR_CODES,
  VaultError,
} from './errors';
import {
  base64Decode,
  base64Encode,
  utf8Decode,
  utf8Encode,
  zeroBytes,
} from './bytes';

export const ENVELOPE_VERSION = 1;
export const CIPHER = 'aes-256-gcm';
export const KDF_ALG = 'pbkdf2-sha256';
// OWASP minimum for PBKDF2-HMAC-SHA256; travels in the envelope so it can be
// raised later without a migration (unlock re-wraps when stale, Phase 5).
export const KDF_ITERATIONS = 600000;
export const SALT_BYTES = 32;
export const IV_BYTES = 12;
export const DEK_BYTES = 32;
export const STATE_KEY_BYTES = 32;
export const GCM_TAG_BYTES = 16;

export const AAD = Object.freeze({
  dek: 'dok.dek.password.v1',
  vault: 'dok.vault.v1',
  state: 'dok.state.v1',
});

// HKDF context for the Tier 1 state key. Salt is a fixed public string: the
// IKM (DEK) is already uniformly random, so the salt only needs to be
// domain-separating, not secret.
const STATE_KEY_HKDF_SALT = 'dok.state.hkdf.salt.v1';

export const generateDek = () => vaultCrypto.randomBytes(DEK_BYTES);

// A GCM authentication failure means different things per purpose: on the
// password-wrapped DEK it is the wrong password; on the blob or a sealed state
// item the key is the live DEK-derived one, so it can only be corrupt or
// tampered data. Callers pick `authFailureCode` accordingly — the Login screen
// counts INVALID_PASSWORD towards the wipe-after-N-attempts lockout.
const wrapCryptoError = (error, authFailureCode, fallbackCode) => {
  if (error && error.code === VAULT_CRYPTO_ERROR_CODES.AUTH_FAILED) {
    return new VaultError(authFailureCode, 'Authentication failed', error);
  }
  if (error instanceof VaultError) {
    return error;
  }
  return new VaultError(fallbackCode, error?.message, error);
};

const decodeField = (envelope, field) => {
  try {
    const bytes = base64Decode(envelope[field]);
    if (!bytes.byteLength) {
      throw new Error('empty');
    }
    return bytes;
  } catch (error) {
    throw new VaultError(
      VAULT_ERROR_CODES.CORRUPT_ENVELOPE,
      `Envelope field "${field}" is not valid base64`,
      error,
    );
  }
};

const assertEnvelopeShape = (envelope, expectedAad) => {
  if (!envelope || typeof envelope !== 'object') {
    throw new VaultError(
      VAULT_ERROR_CODES.CORRUPT_ENVELOPE,
      'Envelope is missing',
    );
  }
  if (envelope.v !== ENVELOPE_VERSION) {
    throw new VaultError(
      VAULT_ERROR_CODES.UNSUPPORTED_ENVELOPE,
      `Unsupported envelope version ${envelope.v}`,
    );
  }
  if (envelope.cipher !== CIPHER) {
    throw new VaultError(
      VAULT_ERROR_CODES.UNSUPPORTED_ENVELOPE,
      `Unsupported cipher ${envelope.cipher}`,
    );
  }
  if (envelope.aad !== expectedAad) {
    throw new VaultError(
      VAULT_ERROR_CODES.UNSUPPORTED_ENVELOPE,
      `Envelope purpose mismatch: expected ${expectedAad}`,
    );
  }
};

const assertKdfShape = kdf => {
  if (!kdf || kdf.alg !== KDF_ALG) {
    throw new VaultError(
      VAULT_ERROR_CODES.UNSUPPORTED_ENVELOPE,
      `Unsupported KDF ${kdf?.alg}`,
    );
  }
  if (!Number.isInteger(kdf.iterations) || kdf.iterations < 1) {
    throw new VaultError(
      VAULT_ERROR_CODES.CORRUPT_ENVELOPE,
      'KDF iterations missing',
    );
  }
};

export const deriveKek = (password, salt, iterations) => {
  if (typeof password !== 'string' || !password.length) {
    return Promise.reject(
      new VaultError(VAULT_ERROR_CODES.INVALID_PASSWORD, 'Password is empty'),
    );
  }
  return vaultCrypto.pbkdf2(password, salt, iterations, DEK_BYTES);
};

const sealBytes = async (key, plaintext, aad) => {
  const iv = vaultCrypto.randomBytes(IV_BYTES);
  const ct = await vaultCrypto.aesGcmEncrypt(key, iv, plaintext, aad);
  return {
    v: ENVELOPE_VERSION,
    cipher: CIPHER,
    iv: base64Encode(iv),
    ct: base64Encode(ct),
    aad,
  };
};

const openBytes = async (key, envelope, aad, authFailureCode) => {
  assertEnvelopeShape(envelope, aad);
  const iv = decodeField(envelope, 'iv');
  const ct = decodeField(envelope, 'ct');
  // A tag-only ciphertext (exactly GCM_TAG_BYTES) is a valid empty plaintext.
  if (iv.byteLength !== IV_BYTES || ct.byteLength < GCM_TAG_BYTES) {
    throw new VaultError(
      VAULT_ERROR_CODES.CORRUPT_ENVELOPE,
      'Envelope byte lengths are wrong',
    );
  }
  try {
    return await vaultCrypto.aesGcmDecrypt(key, iv, ct, aad);
  } catch (error) {
    throw wrapCryptoError(
      error,
      authFailureCode,
      VAULT_ERROR_CODES.CORRUPT_ENVELOPE,
    );
  }
};

/**
 * Wrap a DEK under a password. `options.iterations` exists for tests and for
 * the in-place upgrade path; production callers omit it.
 */
export const wrapDek = async (dek, password, options = {}) => {
  const iterations = options.iterations ?? KDF_ITERATIONS;
  const salt = vaultCrypto.randomBytes(SALT_BYTES);
  const kek = await deriveKek(password, salt, iterations);
  try {
    const sealed = await sealBytes(kek, dek, AAD.dek);
    const now = Date.now();
    return {
      ...sealed,
      kdf: {alg: KDF_ALG, iterations, salt: base64Encode(salt)},
      createdAt: options.createdAt ?? now,
      updatedAt: now,
    };
  } finally {
    zeroBytes(kek);
  }
};

/** Unwrap the DEK. Wrong password surfaces as INVALID_PASSWORD (GCM auth). */
export const unwrapDek = async (envelope, password) => {
  assertEnvelopeShape(envelope, AAD.dek);
  assertKdfShape(envelope.kdf);
  const salt = decodeField(envelope.kdf, 'salt');
  const kek = await deriveKek(password, salt, envelope.kdf.iterations);
  try {
    const dek = await openBytes(
      kek,
      envelope,
      AAD.dek,
      VAULT_ERROR_CODES.INVALID_PASSWORD,
    );
    if (dek.byteLength !== DEK_BYTES) {
      throw new VaultError(
        VAULT_ERROR_CODES.CORRUPT_ENVELOPE,
        'Unwrapped DEK has the wrong length',
      );
    }
    return dek;
  } finally {
    zeroBytes(kek);
  }
};

// Encrypt side mirrors decryptBlob/decryptString: the encoded plaintext buffer
// is zeroised once sealed. Best-effort — the source JS string cannot be wiped.
export const encryptBlob = async (dek, payload) => {
  const plaintext = utf8Encode(JSON.stringify(payload));
  try {
    return await sealBytes(dek, plaintext, AAD.vault);
  } finally {
    zeroBytes(plaintext);
  }
};

/** Blob under the live DEK: an auth failure is corruption, never a password. */
export const decryptBlob = async (dek, envelope) => {
  const plaintext = await openBytes(
    dek,
    envelope,
    AAD.vault,
    VAULT_ERROR_CODES.CORRUPT_ENVELOPE,
  );
  try {
    return JSON.parse(utf8Decode(plaintext));
  } catch (error) {
    throw new VaultError(
      VAULT_ERROR_CODES.CORRUPT_ENVELOPE,
      'Vault blob is not JSON',
      error,
    );
  } finally {
    zeroBytes(plaintext);
  }
};

/** Tier 1 sealing key (web today; mobile option in Phase 5). */
export const deriveStateKey = dek =>
  vaultCrypto.hkdf(
    dek,
    utf8Encode(STATE_KEY_HKDF_SALT),
    AAD.state,
    STATE_KEY_BYTES,
  );

export const encryptString = async (stateKey, text) => {
  const plaintext = utf8Encode(text);
  try {
    return await sealBytes(stateKey, plaintext, AAD.state);
  } finally {
    zeroBytes(plaintext);
  }
};

export const decryptString = async (stateKey, envelope) => {
  const plaintext = await openBytes(
    stateKey,
    envelope,
    AAD.state,
    VAULT_ERROR_CODES.CORRUPT_ENVELOPE,
  );
  return utf8Decode(plaintext);
};

export const isKdfStale = envelope =>
  !envelope?.kdf ||
  envelope.kdf.alg !== KDF_ALG ||
  envelope.kdf.iterations < KDF_ITERATIONS;
