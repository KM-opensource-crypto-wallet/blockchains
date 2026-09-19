// Pure helpers for migrating the legacy single-blob redux-persist root
// (mobile `persist:root2` in react-native-sensitive-info, web `persist:root`
// in localStorage) into per-slice envelopes plus a vault payload.
//
// Nothing here touches storage or crypto. Each app's migrator:
//   1. reads and (web) decrypts the legacy blob,
//   2. calls parseLegacyRoot → splitLegacyRoot,
//   3. writes the vault from `vaultPayload`/`password`, and each sanitized
//      slice via buildPersistEnvelope,
//   4. reads back and calls verifyMigration before advancing schemaVersion.
import {
  extractVaultPayload,
  findSecretPaths,
  stripAllWalletsSecrets,
  stripWalletSecrets,
} from '../wallets/walletSecrets';

export const PERSIST_ENVELOPE_VERSION = 1;

const isPlainObject = value =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

const parseJson = (raw, label) => {
  if (typeof raw !== 'string') {
    return raw;
  }
  try {
    return JSON.parse(raw);
  } catch (error) {
    const err = new Error(`Legacy root: "${label}" is not valid JSON`);
    err.code = 'legacy_parse';
    err.cause = error;
    throw err;
  }
};

/**
 * Parse the legacy root written by redux-persist's createPersistoid:
 * `{ "<slice>": "<json>", ..., "_persist": "<json>" }` (string or object).
 * `options.decodeValue(sliceName, rawValue)` lets the web migrator decrypt
 * each crypto-js ciphertext before it is parsed.
 */
export const parseLegacyRoot = (root, options = {}) => {
  const outer = parseJson(root, 'root');
  if (!isPlainObject(outer)) {
    const err = new Error('Legacy root is not an object');
    err.code = 'legacy_parse';
    throw err;
  }
  const decode = options.decodeValue || ((_, value) => value);
  const slices = {};
  let persist = null;
  for (const [name, raw] of Object.entries(outer)) {
    const value = parseJson(decode(name, raw), name);
    if (name === '_persist') {
      persist = value;
    } else {
      slices[name] = value;
    }
  }
  return {slices, persist};
};

/** One-time `currentWalletIndex` → `currentWalletClientId` (from store.js). */
export const fixCurrentWalletIndex = wallets => {
  if (!isPlainObject(wallets)) {
    return wallets;
  }
  if (wallets.currentWalletClientId) {
    return wallets;
  }
  const allWallets = Array.isArray(wallets.allWallets)
    ? wallets.allWallets
    : [];
  const {currentWalletIndex, ...rest} = wallets;
  return {
    ...rest,
    currentWalletClientId:
      allWallets[currentWalletIndex]?.clientId ||
      allWallets[0]?.clientId ||
      null,
  };
};

export const sanitizeAuth = auth => {
  const {password, loading, error, ...rest} = isPlainObject(auth) ? auth : {};
  return {...rest, hasAccount: Boolean(password)};
};

export const sanitizeWallets = wallets => {
  const fixed = fixCurrentWalletIndex(wallets);
  if (!isPlainObject(fixed)) {
    return fixed;
  }
  return {
    ...fixed,
    allWallets: stripAllWalletsSecrets(fixed.allWallets || []),
    // In-flight flags never survive a migration (same as the persist transform).
    isRefreshingAllWallets: false,
    refreshingWalletClientId: null,
    refreshCoinsRequestIds: {},
  };
};

export const sanitizeSellCrypto = sellCrypto => {
  if (!isPlainObject(sellCrypto?.requestDetails?.selectedFromWallet)) {
    return sellCrypto;
  }
  return {
    ...sellCrypto,
    requestDetails: {
      ...sellCrypto.requestDetails,
      selectedFromWallet: stripWalletSecrets(
        sellCrypto.requestDetails.selectedFromWallet,
      ),
    },
  };
};

export const sanitizeBatchTransaction = batch => {
  if (!isPlainObject(batch?.transactions)) {
    return batch;
  }
  const transactions = Object.fromEntries(
    Object.entries(batch.transactions).map(([walletId, list]) => [
      walletId,
      Array.isArray(list)
        ? list.map(tx => {
            if (!isPlainObject(tx?.coinInfo)) {
              return tx;
            }
            const {privateKey, extendedPrivateKey, phrase, ...coinInfo} =
              tx.coinInfo;
            return {...tx, coinInfo};
          })
        : list,
    ]),
  );
  return {...batch, transactions};
};

export const sanitizeSchedulePayment = schedule =>
  isPlainObject(schedule)
    ? {...schedule, isSubmitting: false, pendingSubmitCount: 0}
    : schedule;

const SANITIZERS = {
  auth: sanitizeAuth,
  wallets: sanitizeWallets,
  sellCrypto: sanitizeSellCrypto,
  batchTransaction: sanitizeBatchTransaction,
  schedulePayment: sanitizeSchedulePayment,
};

const countPayload = payload => {
  let coins = 0;
  let deriveKeys = 0;
  for (const wallet of Object.values(payload.wallets)) {
    coins += Object.keys(wallet.coins || {}).length;
    for (const family of Object.values(wallet.deriveKeys || {})) {
      deriveKeys += Object.keys(family).length;
    }
  }
  return {wallets: Object.keys(payload.wallets).length, coins, deriveKeys};
};

/**
 * Turn parsed legacy slices into what the new stores need. Every slice name
 * in `slices` comes back (sanitized where needed); the caller decides which
 * are plain and which are sealed on its platform.
 */
export const splitLegacyRoot = slices => {
  if (!isPlainObject(slices)) {
    throw new Error('splitLegacyRoot: slices must be an object');
  }
  const password =
    typeof slices.auth?.password === 'string' ? slices.auth.password : '';
  const legacyWallets = fixCurrentWalletIndex(slices.wallets);
  const vaultPayload = extractVaultPayload(legacyWallets?.allWallets || []);
  const sanitized = {};
  for (const [name, value] of Object.entries(slices)) {
    sanitized[name] = SANITIZERS[name] ? SANITIZERS[name](value) : value;
  }
  return {
    slices: sanitized,
    vaultPayload,
    password,
    hasAccount: Boolean(password),
    counts: countPayload(vaultPayload),
  };
};

/** Serialize a slice the way redux-persist's persistoid does (field-wise). */
export const buildPersistEnvelope = (
  sliceState,
  {version = PERSIST_ENVELOPE_VERSION} = {},
) => {
  const out = {};
  if (isPlainObject(sliceState)) {
    for (const [field, value] of Object.entries(sliceState)) {
      if (field !== '_persist' && value !== undefined) {
        out[field] = JSON.stringify(value);
      }
    }
  }
  out._persist = JSON.stringify({version, rehydrated: true});
  return JSON.stringify(out);
};

/** Inverse of buildPersistEnvelope; `_persist` is returned parsed as well. */
export const parsePersistEnvelope = raw => {
  const outer = parseJson(raw, 'envelope');
  const out = {};
  for (const [field, value] of Object.entries(outer || {})) {
    out[field] = parseJson(value, field);
  }
  return out;
};

const walletSummary = allWallets =>
  Object.fromEntries(
    (Array.isArray(allWallets) ? allWallets : [])
      .filter(w => isPlainObject(w) && w.clientId)
      .map(w => [w.clientId, Array.isArray(w.coins) ? w.coins.length : 0]),
  );

const deepEqual = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/**
 * Compare what was written with what the legacy blob held. Returns
 * {ok, problems[]}; never throws so the caller can log every problem at once.
 */
export const verifyMigration = ({
  legacyWallets,
  migratedWallets,
  decryptedVault,
}) => {
  const problems = [];
  const legacy = walletSummary(legacyWallets?.allWallets);
  const migrated = walletSummary(migratedWallets?.allWallets);
  const legacyIds = Object.keys(legacy).sort();
  const migratedIds = Object.keys(migrated).sort();
  if (!deepEqual(legacyIds, migratedIds)) {
    problems.push(
      `wallet clientIds differ: legacy=${legacyIds.length} migrated=${migratedIds.length}`,
    );
  }
  for (const id of legacyIds) {
    if (migrated[id] !== undefined && migrated[id] !== legacy[id]) {
      problems.push(
        `coin count differs for a wallet: ${legacy[id]} → ${migrated[id]}`,
      );
    }
  }
  // Key-name scan only: value-shape heuristics misfire on public hashes.
  const secretPaths = findSecretPaths(migratedWallets, {valueShapes: false});
  if (secretPaths.length) {
    const keys = [...new Set(secretPaths.map(p => p.split('.').pop()))];
    problems.push(
      `secrets left in migrated wallets: ${
        secretPaths.length
      } field(s) under ${keys.join(', ')}`,
    );
  }
  // The exact contract: what was written must be the legacy wallets with
  // nothing but secrets removed (slimming happens later, in the persist
  // transform, not in the migrator).
  const expectedWallets = stripAllWalletsSecrets(
    fixCurrentWalletIndex(legacyWallets)?.allWallets || [],
  );
  if (
    migratedWallets !== undefined &&
    !deepEqual(migratedWallets.allWallets, expectedWallets)
  ) {
    problems.push('migrated wallets differ from the stripped legacy wallets');
  }
  const expectedVault = extractVaultPayload(
    fixCurrentWalletIndex(legacyWallets)?.allWallets || [],
  );
  if (!deepEqual(decryptedVault, expectedVault)) {
    problems.push('vault payload does not match legacy secrets');
  }
  return {ok: problems.length === 0, problems};
};
