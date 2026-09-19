// The vault: holds the DEK in memory while unlocked and owns every read/write
// of the three secure-store items. UI flows call this instead of comparing a
// stored password; "correct password" is "unwrapDek authenticated".
//
// Platform pieces arrive through aliases each app resolves to its own file:
//   security/secureStore  - get/set/remove/has + capabilities (RNSI | IndexedDB)
//   security/vaultCrypto  - used indirectly through ./vaultCore
// Nothing here branches on platform; the biometric path is gated on
// `secureStore.capabilities.biometric` so the web adapter simply reports false.
import * as secureStore from 'security/secureStore';
import {
  SECURE_STORE_ERROR_CODES,
  VAULT_ERROR_CODES,
  VaultError,
} from './errors';
import {base64Decode, base64Encode, zeroBytes} from './bytes';
import {
  decryptBlob,
  deriveStateKey,
  encryptBlob,
  generateDek,
  isKdfStale,
  unwrapDek,
  wrapDek,
} from './vaultCore';

export const VAULT_KEYS = Object.freeze({
  dekPassword: 'vault.dek.password',
  dekBiometric: 'vault.dek.biometric',
  blob: 'vault.blob',
});

export const BIOMETRIC_ACCESS_CONTROL = 'biometryCurrentSet';

export const EMPTY_VAULT_PAYLOAD = Object.freeze({v: 1, wallets: {}});

let dek = null;
let stateKey = null;
let stateKeyPromise = null;

const requireUnlocked = () => {
  if (!dek) {
    throw new VaultError(VAULT_ERROR_CODES.LOCKED, 'Vault is locked');
  }
  return dek;
};

const setDek = bytes => {
  lock();
  dek = bytes;
};

const readJson = async key => {
  const raw = await secureStore.get(key);
  if (raw == null) {
    return null;
  }
  try {
    return JSON.parse(raw);
  } catch (error) {
    throw new VaultError(
      VAULT_ERROR_CODES.CORRUPT_ENVELOPE,
      `Secure item "${key}" is not JSON`,
      error,
    );
  }
};

const writeJson = (key, value, options) =>
  secureStore.set(key, JSON.stringify(value), options);

const readPayload = async currentDek => {
  const blob = await readJson(VAULT_KEYS.blob);
  if (!blob) {
    return {...EMPTY_VAULT_PAYLOAD, wallets: {}};
  }
  return decryptBlob(currentDek, blob);
};

const biometricOptions = prompt => ({
  accessControl: BIOMETRIC_ACCESS_CONTROL,
  authenticationPrompt: prompt,
});

export const isUnlocked = () => dek !== null;

export const lock = () => {
  zeroBytes(dek);
  zeroBytes(stateKey);
  dek = null;
  stateKey = null;
  stateKeyPromise = null;
};

export const hasVault = async () =>
  (await secureStore.get(VAULT_KEYS.dekPassword)) != null;

/** Registration: new DEK wrapped under the password, empty blob, unlocked. */
export const createVault = async password => {
  if (await hasVault()) {
    throw new VaultError(
      VAULT_ERROR_CODES.VAULT_EXISTS,
      'A vault already exists; unlock or destroy it first',
    );
  }
  const newDek = generateDek();
  const envelope = await wrapDek(newDek, password);
  await writeJson(VAULT_KEYS.dekPassword, envelope);
  await writeJson(
    VAULT_KEYS.blob,
    await encryptBlob(newDek, EMPTY_VAULT_PAYLOAD),
  );
  setDek(newDek);
};

/**
 * Login. Resolves with the decrypted secrets payload; rejects with
 * INVALID_PASSWORD (GCM auth) or NO_VAULT.
 */
export const unlockWithPassword = async password => {
  const envelope = await readJson(VAULT_KEYS.dekPassword);
  if (!envelope) {
    throw new VaultError(VAULT_ERROR_CODES.NO_VAULT, 'No vault to unlock');
  }
  const unwrapped = await unwrapDek(envelope, password);
  const payload = await readPayload(unwrapped);
  setDek(unwrapped);
  // In-place KDF upgrade (MetaMask pattern): the password is in hand and just
  // proved itself, so re-wrap under the current parameters. The blob is
  // untouched; a failure here is reported by the caller and the old wrap
  // keeps working.
  if (isKdfStale(envelope)) {
    await writeJson(
      VAULT_KEYS.dekPassword,
      await wrapDek(unwrapped, password, {createdAt: envelope.createdAt}),
    );
  }
  return payload;
};

/** True/false for the typed password; other failures propagate. */
export const verifyPassword = async password => {
  const envelope = await readJson(VAULT_KEYS.dekPassword);
  if (!envelope) {
    throw new VaultError(VAULT_ERROR_CODES.NO_VAULT, 'No vault to verify');
  }
  try {
    const unwrapped = await unwrapDek(envelope, password);
    zeroBytes(unwrapped);
    return true;
  } catch (error) {
    if (error?.code === VAULT_ERROR_CODES.INVALID_PASSWORD) {
      return false;
    }
    throw error;
  }
};

/** Re-wraps the DEK only; the blob is untouched. Verifies `current` first. */
export const changePassword = async (current, next) => {
  const envelope = await readJson(VAULT_KEYS.dekPassword);
  if (!envelope) {
    throw new VaultError(VAULT_ERROR_CODES.NO_VAULT, 'No vault to re-key');
  }
  const unwrapped = await unwrapDek(envelope, current);
  const rewrapped = await wrapDek(unwrapped, next, {
    createdAt: envelope.createdAt,
  });
  await writeJson(VAULT_KEYS.dekPassword, rewrapped);
  if (dek) {
    zeroBytes(unwrapped);
  } else {
    setDek(unwrapped);
  }
};

/** Whether the stored wrap uses older KDF parameters than the current build. */
export const needsKdfUpgrade = async () => {
  const envelope = await readJson(VAULT_KEYS.dekPassword);
  return Boolean(envelope) && isKdfStale(envelope);
};

export const supportsBiometric = () =>
  Boolean(secureStore.capabilities?.biometric);

export const hasBiometric = async () =>
  supportsBiometric() && (await secureStore.has(VAULT_KEYS.dekBiometric));

/**
 * Platform can store biometric items AND a sensor is enrolled right now.
 * Adapters without the runtime check (web) fall back to the static flag.
 */
export const isBiometricAvailable = async () => {
  if (!supportsBiometric()) {
    return false;
  }
  if (typeof secureStore.isBiometricAvailable !== 'function') {
    return true;
  }
  return Boolean(await secureStore.isBiometricAvailable());
};

const assertBiometricAvailable = async () => {
  if (!(await isBiometricAvailable())) {
    throw new VaultError(
      VAULT_ERROR_CODES.BIOMETRIC_UNSUPPORTED,
      'Biometric unlock is not available on this device',
    );
  }
};

/**
 * Store the raw DEK under a biometric-bound item. Requires an unlocked vault
 * and an enrolled sensor: the platform shows its prompt for this write, and
 * without an enrolled sensor iOS would fall back to the device passcode.
 * The item is deleted first — the Keychain keeps an existing item's access
 * policy on update, so writing over an old item would silently keep the old
 * policy.
 */
export const enableBiometric = async prompt => {
  await assertBiometricAvailable();
  const current = requireUnlocked();
  await secureStore.remove(VAULT_KEYS.dekBiometric);
  await secureStore.set(
    VAULT_KEYS.dekBiometric,
    base64Encode(current),
    biometricOptions(prompt),
  );
};

export const disableBiometric = async () => {
  await secureStore.remove(VAULT_KEYS.dekBiometric);
};

/**
 * Login with the OS biometric prompt. Enrollment change → the platform has
 * destroyed the key: the item is removed and BIOMETRIC_INVALIDATED is thrown
 * so the caller falls back to the password and re-enables afterwards.
 */
export const unlockWithBiometric = async prompt => {
  await assertBiometricAvailable();
  let raw;
  try {
    raw = await secureStore.get(
      VAULT_KEYS.dekBiometric,
      biometricOptions(prompt),
    );
  } catch (error) {
    if (error?.code === SECURE_STORE_ERROR_CODES.KEY_INVALIDATED) {
      await disableBiometric();
      throw new VaultError(
        VAULT_ERROR_CODES.BIOMETRIC_INVALIDATED,
        'Biometric enrollment changed; unlock with your password',
        error,
      );
    }
    if (error?.code === SECURE_STORE_ERROR_CODES.USER_CANCELLED) {
      throw new VaultError(
        VAULT_ERROR_CODES.BIOMETRIC_CANCELLED,
        'Biometric prompt cancelled',
        error,
      );
    }
    throw error;
  }
  if (raw == null) {
    throw new VaultError(
      VAULT_ERROR_CODES.BIOMETRIC_NOT_ENROLLED,
      'Biometric unlock is not set up',
    );
  }
  const unwrapped = base64Decode(raw);
  const payload = await readPayload(unwrapped);
  setDek(unwrapped);
  return payload;
};

/** Persist the secrets payload. Requires an unlocked vault. */
export const saveSecrets = async payload => {
  const current = requireUnlocked();
  await writeJson(VAULT_KEYS.blob, await encryptBlob(current, payload));
};

/** Decrypt and return the stored payload. Requires an unlocked vault. */
export const readSecrets = () => readPayload(requireUnlocked());

/**
 * Tier 1 sealing key, derived once per unlock. Requires an unlocked vault.
 * Returns a copy: lock() zeroises the vault's own buffer, and a caller that
 * kept the original (the sealed storage adapter) would otherwise silently
 * continue with an all-zero key.
 */
export const getStateKey = () => {
  const current = requireUnlocked();
  if (stateKey) {
    return Promise.resolve(new Uint8Array(stateKey));
  }
  if (!stateKeyPromise) {
    stateKeyPromise = deriveStateKey(current).then(derived => {
      stateKey = derived;
      return new Uint8Array(derived);
    });
  }
  return stateKeyPromise.then(key => new Uint8Array(key));
};

/** Wallet reset / delete-all-data: remove every vault item and lock. */
export const destroy = async () => {
  lock();
  await secureStore.remove(VAULT_KEYS.blob);
  await secureStore.remove(VAULT_KEYS.dekBiometric);
  await secureStore.remove(VAULT_KEYS.dekPassword);
};

// Test hook only.
export const __resetForTests = () => {
  lock();
};
