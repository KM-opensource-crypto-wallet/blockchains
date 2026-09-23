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
import {v4} from 'uuid';
import {
  extractVaultPayload,
  findSecretPaths,
  stripAllWalletsSecrets,
  stripCoinSecrets,
  stripSecretFieldsDeep,
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
    err.slice = label;
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

const hasClientId = wallet =>
  !isPlainObject(wallet) || Boolean(wallet.clientId);

/**
 * Wallets created before `clientId` existed only get one at runtime
 * (`walletsSlice.createClientIdIfNotExist`, dispatched after rehydrate). The
 * migration runs before the store exists and keys the vault by clientId, so it
 * has to assign the id itself, once, and use that same id for both the
 * stripped slice and the vault payload. Same generator as the reducer.
 * Returns `wallets` unchanged (same reference) when nothing is missing.
 */
export const ensureWalletClientIds = wallets => {
  if (!isPlainObject(wallets) || !Array.isArray(wallets.allWallets)) {
    return wallets;
  }
  if (wallets.allWallets.every(hasClientId)) {
    return wallets;
  }
  return {
    ...wallets,
    allWallets: wallets.allWallets.map(wallet =>
      hasClientId(wallet) ? wallet : {...wallet, clientId: v4()},
    ),
  };
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

// The sell screen stores copies of the live wallet AND the live coin it sells
// from; both carry keys. initiateSellCryptoTransfer re-resolves the live
// objects from the wallets slice before signing, so the stubs need no keys.
export const sanitizeSellCrypto = sellCrypto => {
  const details = sellCrypto?.requestDetails;
  if (!isPlainObject(details)) {
    return sellCrypto;
  }
  const hasWallet = isPlainObject(details.selectedFromWallet);
  const hasAsset = isPlainObject(details.selectedFromAsset);
  if (!hasWallet && !hasAsset) {
    return sellCrypto;
  }
  return {
    ...sellCrypto,
    requestDetails: {
      ...details,
      ...(hasWallet
        ? {selectedFromWallet: stripWalletSecrets(details.selectedFromWallet)}
        : {}),
      ...(hasAsset
        ? {selectedFromAsset: stripCoinSecrets(details.selectedFromAsset)}
        : {}),
    },
  };
};

// `coinInfo` copies the selected coin's privateKey on purpose (in-memory
// signing); every persisted copy of a transaction list drops it.
const sanitizeBatchTransactionList = list =>
  Array.isArray(list)
    ? list.map(tx =>
        isPlainObject(tx?.coinInfo)
          ? {...tx, coinInfo: stripCoinSecrets(tx.coinInfo)}
          : tx,
      )
    : list;

export const sanitizeBatchTransaction = batch => {
  if (!isPlainObject(batch)) {
    return batch;
  }
  const out = {...batch};
  if (isPlainObject(batch.transactions)) {
    out.transactions = Object.fromEntries(
      Object.entries(batch.transactions).map(([walletId, list]) => [
        walletId,
        sanitizeBatchTransactionList(list),
      ]),
    );
  }
  // initializeFilters.fulfilled stores clones of the in-memory transactions
  // (derived UI state, recomputed every time the sheet opens).
  if (Array.isArray(batch.filteredData?.filteredTransactions)) {
    out.filteredData = {
      ...batch.filteredData,
      filteredTransactions: sanitizeBatchTransactionList(
        batch.filteredData.filteredTransactions,
      ),
    };
  }
  return out;
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
  // Ids first: fixCurrentWalletIndex and extractVaultPayload both key on them.
  const legacyWallets = fixCurrentWalletIndex(
    ensureWalletClientIds(slices.wallets),
  );
  const vaultPayload = extractVaultPayload(legacyWallets?.allWallets || []);
  const sanitized = {};
  // Secrets found in a non-wallet slice after its sanitizer ran (a shape no
  // sanitizer knows). Key names and counts only, never values; the caller
  // reports it. The slice itself is deep-stripped so nothing is written.
  const residualSecrets = {};
  for (const [name, value] of Object.entries(slices)) {
    // The wallets slice is sanitized from the normalized copy so the stripped
    // slice carries exactly the clientIds the vault payload was keyed by.
    const source = name === 'wallets' ? legacyWallets : value;
    let out = SANITIZERS[name] ? SANITIZERS[name](source) : source;
    if (name !== 'wallets') {
      // Key names only: value-shape heuristics misfire on public hashes.
      const paths = findSecretPaths(out, {valueShapes: false});
      if (paths.length) {
        residualSecrets[name] = {
          count: paths.length,
          keys: [...new Set(paths.map(path => path.split('.').pop()))],
        };
        out = stripSecretFieldsDeep(out);
      }
    }
    sanitized[name] = out;
  }
  return {
    slices: sanitized,
    vaultPayload,
    // Pass this (not the raw parsed slice) to verifyMigration.
    legacyWallets,
    password,
    hasAccount: Boolean(password),
    counts: countPayload(vaultPayload),
    residualSecrets,
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

// ---------------------------------------------------------------------------
// Failure diagnostics. Everything below describes STRUCTURE only: normalized
// field names, array lengths, string lengths, counts and wallet indices. No
// value, address, clientId, derive path or map key ever reaches the output,
// so the report can go to Sentry as-is. Sentry's scrubObject drops any object
// KEY that looks sensitive, so callers must put these strings under neutral
// keys (never key an object by path).

const FIELD_NAME_RE = /^[A-Za-z_][A-Za-z0-9_]{0,31}$/;
const MAX_FIELD_DIGITS = 3;
const MAX_SHAPE_KEYS = 12;

// A path segment is kept only when it looks like a code-defined field name.
// Addresses, uuids, derive paths, `chain_symbol_address` keys and session ids
// fail the shape (length, digits, punctuation) and become `<key>`.
const normalizeSegment = name => {
  if (name === '') {
    return '';
  }
  if (!FIELD_NAME_RE.test(name)) {
    return '<key>';
  }
  return (name.match(/[0-9]/g) || []).length > MAX_FIELD_DIGITS
    ? '<key>'
    : name;
};

/** `allWallets[3].coins[12].privateKey` → `allWallets[*].coins[*].privateKey`. */
export const normalizePathPattern = path =>
  String(path)
    .split('.')
    .map(segment => {
      const match = segment.match(/^([^[\]]*)((?:\[\d+\])*)$/);
      if (!match) {
        return '<key>';
      }
      const brackets = (match[2].match(/\[/g) || []).length;
      return normalizeSegment(match[1]) + '[*]'.repeat(brackets);
    })
    .join('.');

const summarizePaths = (paths, {maxEntries = 20} = {}) => {
  const counts = new Map();
  for (const path of paths) {
    const pattern = normalizePathPattern(path);
    counts.set(pattern, (counts.get(pattern) || 0) + 1);
  }
  const sorted = [...counts.entries()].sort(
    (a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1),
  );
  const out = sorted
    .slice(0, maxEntries)
    .map(([pattern, count]) => `${pattern} x${count}`);
  if (sorted.length > maxEntries) {
    out.push(`… +${sorted.length - maxEntries} more patterns`);
  }
  return out;
};

/** Value-free signature of any JSON value. */
export const shapeOf = value => {
  if (value === undefined) {
    return 'missing';
  }
  if (value === null) {
    return 'null';
  }
  if (typeof value === 'string') {
    return `string(${value.length})`;
  }
  if (Array.isArray(value)) {
    return `array(${value.length})`;
  }
  if (typeof value === 'object') {
    const keys = Object.keys(value).map(normalizeSegment).sort();
    const shown = keys.slice(0, MAX_SHAPE_KEYS);
    if (keys.length > MAX_SHAPE_KEYS) {
      shown.push('…');
    }
    return `object{${shown.join(',')}}`;
  }
  return typeof value;
};

/**
 * First `maxEntries` differences between two JSON values, as
 * "<pattern>: <labelA> <shape> vs <labelB> <shape>". Arrays of different
 * length are reported once and not descended; equal-length arrays and objects
 * (key union) are. Differing primitives report their shapes only.
 */
export const structuralDiff = (
  a,
  b,
  {labelA = 'legacy', labelB = 'migrated', maxEntries = 10} = {},
) => {
  const out = [];
  let overflow = 0;
  const record = (path, x, y) => {
    if (out.length < maxEntries) {
      out.push(
        `${normalizePathPattern(path)}: ${labelA} ${shapeOf(
          x,
        )} vs ${labelB} ${shapeOf(y)}`,
      );
    } else {
      overflow += 1;
    }
  };
  const walk = (x, y, path) => {
    if (x === y) {
      return;
    }
    if (isPlainObject(x) && isPlainObject(y)) {
      const keys = [...new Set([...Object.keys(x), ...Object.keys(y)])];
      for (const key of keys) {
        walk(x[key], y[key], path ? `${path}.${key}` : key);
      }
      return;
    }
    if (Array.isArray(x) && Array.isArray(y)) {
      if (x.length !== y.length) {
        record(path, x, y);
        return;
      }
      x.forEach((item, index) => walk(item, y[index], `${path}[${index}]`));
      return;
    }
    record(path, x, y);
  };
  walk(a, b, '');
  if (overflow) {
    out.push(`… +${overflow} more differences`);
  }
  return out;
};

// Union of normalized wallet field names plus `coins[*].<field>` names.
const walletFieldInventory = allWallets => {
  const names = new Set();
  for (const wallet of Array.isArray(allWallets) ? allWallets : []) {
    if (!isPlainObject(wallet)) {
      continue;
    }
    for (const key of Object.keys(wallet)) {
      names.add(normalizeSegment(key));
    }
    for (const coin of Array.isArray(wallet.coins) ? wallet.coins : []) {
      if (isPlainObject(coin)) {
        for (const key of Object.keys(coin)) {
          names.add(`coins[*].${normalizeSegment(key)}`);
        }
      }
    }
  }
  return [...names].sort();
};

const perWalletCounts = allWallets =>
  (Array.isArray(allWallets) ? allWallets : []).map(wallet =>
    Array.isArray(wallet?.coins) ? wallet.coins.length : 0,
  );

const perWalletDeriveCounts = allWallets =>
  (Array.isArray(allWallets) ? allWallets : []).map(wallet =>
    (Array.isArray(wallet?.coins) ? wallet.coins : []).reduce(
      (sum, coin) =>
        sum +
        (Array.isArray(coin?.deriveAddresses)
          ? coin.deriveAddresses.length
          : 0),
      0,
    ),
  );

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
  // Structure-only diagnostics per problem (see the helpers above). Empty
  // when everything passes.
  const details = {};
  const legacyList = Array.isArray(legacyWallets?.allWallets)
    ? legacyWallets.allWallets
    : [];
  const migratedList = Array.isArray(migratedWallets?.allWallets)
    ? migratedWallets.allWallets
    : [];
  // A wallet without a clientId cannot be matched to its vault entry, so it
  // would silently lose its secrets. splitLegacyRoot assigns ids up front;
  // this catches a caller that passed the raw slice or a write that lost them.
  const withoutId = list => list.filter(w => !hasClientId(w)).length;
  const legacyMissing = withoutId(legacyList);
  const migratedMissing = withoutId(migratedList);
  if (legacyMissing || migratedMissing) {
    problems.push(
      `wallets without clientId: legacy=${legacyMissing} migrated=${migratedMissing}`,
    );
  }
  const legacy = walletSummary(legacyList);
  const migrated = walletSummary(migratedList);
  const legacyIds = Object.keys(legacy).sort();
  const migratedIds = Object.keys(migrated).sort();
  if (!deepEqual(legacyIds, migratedIds)) {
    problems.push(
      `wallet clientIds differ: legacy=${legacyIds.length} migrated=${migratedIds.length}`,
    );
  }
  if (legacyMissing || migratedMissing || !deepEqual(legacyIds, migratedIds)) {
    details.walletCounts = {
      legacy: legacyList.length,
      migrated: migratedList.length,
      legacyWithoutId: legacyMissing,
      migratedWithoutId: migratedMissing,
    };
  }
  const coinCountDrift = [];
  for (const id of legacyIds) {
    if (migrated[id] !== undefined && migrated[id] !== legacy[id]) {
      problems.push(
        `coin count differs for a wallet: ${legacy[id]} → ${migrated[id]}`,
      );
      const index = legacyList.findIndex(w => w?.clientId === id);
      coinCountDrift.push(`wallet#${index}: ${legacy[id]} -> ${migrated[id]}`);
    }
  }
  if (coinCountDrift.length) {
    details.coinCountDrift = coinCountDrift;
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
    details.leakedPathPatterns = summarizePaths(secretPaths);
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
    details.walletsDiff = structuralDiff(
      {allWallets: expectedWallets},
      {allWallets: migratedWallets.allWallets},
      {labelA: 'legacy', labelB: 'migrated'},
    );
  }
  const expectedVault = extractVaultPayload(
    fixCurrentWalletIndex(legacyWallets)?.allWallets || [],
  );
  if (!deepEqual(decryptedVault, expectedVault)) {
    problems.push('vault payload does not match legacy secrets');
    details.vaultDiff = structuralDiff(expectedVault, decryptedVault, {
      labelA: 'expected',
      labelB: 'actual',
    });
  }
  if (problems.length) {
    details.walletFieldInventory = walletFieldInventory(migratedList);
    details.counts = {
      legacyWallets: legacyList.length,
      migratedWallets: migratedList.length,
      coinsPerWallet: perWalletCounts(migratedList),
      deriveAddressesPerWallet: perWalletDeriveCounts(migratedList),
    };
  }
  return {ok: problems.length === 0, problems, details};
};
