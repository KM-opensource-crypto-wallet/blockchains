// Pure helpers that separate wallet *secrets* from wallet *state*.
//
// At rest, secrets live only in the vault (security/vault.js). The persisted
// `wallets` slice carries everything else. These functions are the single
// definition of "what is a secret" for the persist transform, the vault
// listener, the migrator, the Sentry scrubber and the tests.
//
// Vault payload v1:
//   { v: 1, wallets: { [clientId]: {
//       phrase, privateKey,                       // wallet-level
//       hideSettings: {secretCodeHash, secretCodeSalt, secretCodeIterations},
//       coins:         { [coinKey]: {privateKey, extendedPrivateKey, phrase, _id} },
//       chainExisting: { [chain_name]: {privateKey, extendedPrivateKey} },
//       deriveKeys:    { [family]: { [derivePath | address]: privateKey } } } } }
//
// `coinKey` = generateUniqueKeyForChain(coin) (chain_symbol), the identity the
// slice already treats as unique. `family` collapses every EVM coin onto one
// list because their derive paths and keys are identical.
//
// Stripped but never hydrated (the live coin is the source of truth): the
// WalletConnect `walletData` entries and the `selectedNft.coin` snapshot.
import {
  generateUniqueKeyForChain,
  isEVMChain,
} from 'dok-wallet-blockchain-networks/helper';

export const VAULT_PAYLOAD_VERSION = 1;

export const SECRET_WALLET_FIELDS = Object.freeze({
  wallet: Object.freeze(['phrase', 'privateKey']),
  coin: Object.freeze(['privateKey', 'extendedPrivateKey', 'phrase']),
  deriveAddress: Object.freeze(['privateKey']),
  chainExisting: Object.freeze(['privateKey', 'extendedPrivateKey']),
  hideSettings: Object.freeze([
    'secretCodeHash',
    'secretCodeSalt',
    'secretCodeIterations',
  ]),
  // WalletConnect per-session data is stripped but never re-hydrated; the
  // transaction modal looks the live coin up by chain + address instead.
  walletData: Object.freeze(['privateKey', 'extendedPrivateKey', 'phrase']),
});

// Every key name that may only ever hold a secret, anywhere in wallet state.
export const SECRET_FIELD_NAMES = Object.freeze([
  'phrase',
  'privateKey',
  'extendedPrivateKey',
  'secretCodeHash',
  'secretCodeSalt',
]);

const hasValue = value => value !== undefined && value !== null && value !== '';

const isPlainObject = value =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

const omit = (object, fields) => {
  if (!isPlainObject(object)) {
    return object;
  }
  let changed = false;
  const out = {};
  for (const key of Object.keys(object)) {
    if (fields.includes(key)) {
      changed = true;
    } else {
      out[key] = object[key];
    }
  }
  return changed ? out : object;
};

const pick = (object, fields) => {
  const out = {};
  for (const field of fields) {
    if (isPlainObject(object) && hasValue(object[field])) {
      out[field] = object[field];
    }
  }
  return out;
};

export const getCoinKey = coin => generateUniqueKeyForChain(coin);

export const getDeriveFamily = chain_name =>
  isEVMChain(chain_name) ? 'evm' : chain_name;

export const getDeriveEntryKey = entry =>
  hasValue(entry?.derivePath) ? entry.derivePath : entry?.address;

// Deep strip for structures whose shape we do not own (WalletConnect data).
const stripDeep = (value, fields) => {
  if (Array.isArray(value)) {
    return value.map(item => stripDeep(item, fields));
  }
  if (isPlainObject(value)) {
    const out = {};
    for (const key of Object.keys(value)) {
      if (!fields.includes(key)) {
        out[key] = stripDeep(value[key], fields);
      }
    }
    return out;
  }
  return value;
};

/**
 * Deep copy of `value` with every key in SECRET_FIELD_NAMES removed at any
 * depth. Last line of defence for state whose shape we do not own (the
 * migrator applies it to non-wallet slices that still hold a secret after
 * their sanitizer ran). Always returns a new object, so callers should only
 * use it when a scan found something.
 */
export const stripSecretFieldsDeep = value =>
  stripDeep(value, SECRET_FIELD_NAMES);

/**
 * Returns a copy of a coin-shaped object with every secret removed, including
 * nested `deriveAddresses[*]` keys. Never mutates. Also used for coin-shaped
 * snapshots stored outside `allWallets` (batch transaction `coinInfo`).
 */
export const stripCoinSecrets = coin => {
  if (!isPlainObject(coin)) {
    return coin;
  }
  const stripped = omit(coin, SECRET_WALLET_FIELDS.coin);
  if (Array.isArray(coin.deriveAddresses)) {
    return {
      ...stripped,
      deriveAddresses: coin.deriveAddresses.map(entry =>
        omit(entry, SECRET_WALLET_FIELDS.deriveAddress),
      ),
    };
  }
  return stripped;
};

/** Returns a copy of `wallet` with every secret removed. Never mutates. */
export const stripWalletSecrets = wallet => {
  if (!isPlainObject(wallet)) {
    return wallet;
  }
  const out = omit(wallet, SECRET_WALLET_FIELDS.wallet);
  const result = out === wallet ? {...wallet} : out;
  if (Array.isArray(wallet.coins)) {
    result.coins = wallet.coins.map(stripCoinSecrets);
  }
  if (isPlainObject(wallet.chain_existing_coin)) {
    result.chain_existing_coin = Object.fromEntries(
      Object.entries(wallet.chain_existing_coin).map(([chain, value]) => [
        chain,
        omit(value, SECRET_WALLET_FIELDS.chainExisting),
      ]),
    );
  }
  if (isPlainObject(wallet.hideSettings)) {
    result.hideSettings = omit(
      wallet.hideSettings,
      SECRET_WALLET_FIELDS.hideSettings,
    );
  }
  if (wallet.walletData !== undefined) {
    result.walletData = stripDeep(
      wallet.walletData,
      SECRET_WALLET_FIELDS.walletData,
    );
  }
  // `selectedNft.coin` is the copy of the live native coin that setSelectedNft
  // stores next to the NFT metadata (key + every derive key). It is a UI
  // snapshot: resetNfts clears it on launch and setSelectedNft rebuilds it from
  // the hydrated coin, so it is stripped here and never re-hydrated.
  if (
    isPlainObject(wallet.selectedNft) &&
    isPlainObject(wallet.selectedNft.coin)
  ) {
    result.selectedNft = {
      ...wallet.selectedNft,
      coin: stripCoinSecrets(wallet.selectedNft.coin),
    };
  }
  return result;
};

export const stripAllWalletsSecrets = allWallets =>
  Array.isArray(allWallets) ? allWallets.map(stripWalletSecrets) : allWallets;

const extractWalletSecrets = wallet => {
  const entry = pick(wallet, SECRET_WALLET_FIELDS.wallet);
  const hide = pick(wallet.hideSettings, SECRET_WALLET_FIELDS.hideSettings);
  if (Object.keys(hide).length) {
    entry.hideSettings = hide;
  }
  const coins = {};
  const deriveKeys = {};
  for (const coin of Array.isArray(wallet.coins) ? wallet.coins : []) {
    if (!isPlainObject(coin)) {
      continue;
    }
    const coinSecrets = pick(coin, SECRET_WALLET_FIELDS.coin);
    if (Object.keys(coinSecrets).length) {
      if (hasValue(coin._id)) {
        coinSecrets._id = coin._id;
      }
      coins[getCoinKey(coin)] = coinSecrets;
    }
    if (Array.isArray(coin.deriveAddresses)) {
      const family = getDeriveFamily(coin.chain_name);
      for (const derive of coin.deriveAddresses) {
        const key = getDeriveEntryKey(derive);
        if (hasValue(key) && hasValue(derive?.privateKey)) {
          deriveKeys[family] = deriveKeys[family] || {};
          deriveKeys[family][key] = derive.privateKey;
        }
      }
    }
  }
  const chainExisting = {};
  if (isPlainObject(wallet.chain_existing_coin)) {
    for (const [chain, value] of Object.entries(wallet.chain_existing_coin)) {
      const secrets = pick(value, SECRET_WALLET_FIELDS.chainExisting);
      if (Object.keys(secrets).length) {
        chainExisting[chain] = secrets;
      }
    }
  }
  return {...entry, coins, chainExisting, deriveKeys};
};

/** Builds the vault payload for a list of wallets. */
export const extractVaultPayload = allWallets => {
  const wallets = {};
  for (const wallet of Array.isArray(allWallets) ? allWallets : []) {
    if (isPlainObject(wallet) && hasValue(wallet.clientId)) {
      wallets[wallet.clientId] = extractWalletSecrets(wallet);
    }
  }
  return {v: VAULT_PAYLOAD_VERSION, wallets};
};

// Merge rule: a value already in memory always wins; the vault only fills
// holes. Never writes `undefined` over an existing field.
const fill = (target, source, fields) => {
  let out = target;
  for (const field of fields) {
    if (!hasValue(out?.[field]) && hasValue(source?.[field])) {
      out = {...out, [field]: source[field]};
    }
  }
  return out;
};

const hydrateCoin = (coin, walletSecrets) => {
  if (!isPlainObject(coin)) {
    return coin;
  }
  let out = fill(
    coin,
    walletSecrets.coins?.[getCoinKey(coin)],
    SECRET_WALLET_FIELDS.coin,
  );
  const familyKeys =
    walletSecrets.deriveKeys?.[getDeriveFamily(coin.chain_name)];
  if (familyKeys && Array.isArray(coin.deriveAddresses)) {
    let changed = false;
    const deriveAddresses = coin.deriveAddresses.map(entry => {
      const key = getDeriveEntryKey(entry);
      const filled = fill(entry, {privateKey: familyKeys[key]}, ['privateKey']);
      changed = changed || filled !== entry;
      return filled;
    });
    if (changed) {
      out = {...out, deriveAddresses};
    }
  }
  return out;
};

/** Returns a new allWallets array with vault secrets merged back in. */
export const hydrateWalletSecrets = (allWallets, payload) => {
  if (!Array.isArray(allWallets) || !isPlainObject(payload?.wallets)) {
    return allWallets;
  }
  return allWallets.map(wallet => {
    const secrets = payload.wallets[wallet?.clientId];
    if (!isPlainObject(wallet) || !secrets) {
      return wallet;
    }
    let out = fill(wallet, secrets, SECRET_WALLET_FIELDS.wallet);
    if (secrets.hideSettings && isPlainObject(wallet.hideSettings)) {
      const hideSettings = fill(
        wallet.hideSettings,
        secrets.hideSettings,
        SECRET_WALLET_FIELDS.hideSettings,
      );
      if (hideSettings !== wallet.hideSettings) {
        out = {...out, hideSettings};
      }
    }
    if (Array.isArray(wallet.coins)) {
      let changed = false;
      const coins = wallet.coins.map(coin => {
        const hydrated = hydrateCoin(coin, secrets);
        changed = changed || hydrated !== coin;
        return hydrated;
      });
      if (changed) {
        out = {...out, coins};
      }
    }
    if (secrets.chainExisting && isPlainObject(wallet.chain_existing_coin)) {
      let changed = false;
      const chain_existing_coin = Object.fromEntries(
        Object.entries(wallet.chain_existing_coin).map(([chain, value]) => {
          const filled = fill(
            value,
            secrets.chainExisting[chain],
            SECRET_WALLET_FIELDS.chainExisting,
          );
          changed = changed || filled !== value;
          return [chain, filled];
        }),
      );
      if (changed) {
        out = {...out, chain_existing_coin};
      }
    }
    return out;
  });
};

/** True when the payload carries any secret material at all. */
export const vaultPayloadHasSecrets = payload =>
  Object.values(payload?.wallets || {}).some(
    entry =>
      hasValue(entry?.phrase) ||
      hasValue(entry?.privateKey) ||
      Object.keys(entry?.hideSettings || {}).length > 0 ||
      Object.keys(entry?.coins || {}).length > 0 ||
      Object.keys(entry?.chainExisting || {}).length > 0 ||
      Object.values(entry?.deriveKeys || {}).some(
        family => Object.keys(family || {}).length > 0,
      ),
  );

/** clientIds present in `allWallets` that the payload has no entry for. */
export const findWalletsMissingSecrets = (allWallets, payload) =>
  (Array.isArray(allWallets) ? allWallets : [])
    .filter(
      wallet =>
        isPlainObject(wallet) &&
        hasValue(wallet.clientId) &&
        !isPlainObject(payload?.wallets?.[wallet.clientId]),
    )
    .map(wallet => wallet.clientId);

// Value shapes that are secrets regardless of key name.
const XPRV_RE = /^[xyztuvYZUV]prv[1-9A-HJ-NP-Za-km-z]{100,112}$/;
const WIF_RE = /^[5KL9c][1-9A-HJ-NP-Za-km-z]{50,51}$/;
const HEX64_RE = /^(?:0x)?[0-9a-fA-F]{64}$/;
const MNEMONIC_RE = /^(?:[a-z]{3,8}\s+){11,23}[a-z]{3,8}$/;

const looksLikeSecretValue = value =>
  typeof value === 'string' &&
  (XPRV_RE.test(value) ||
    WIF_RE.test(value) ||
    MNEMONIC_RE.test(value.trim()) ||
    HEX64_RE.test(value));

// Keys whose 64-hex values are public (hashes, ids), so HEX64 does not apply.
const HEX_ALLOWED_KEYS = new Set([
  'hash',
  'txHash',
  'tx_hash',
  'transactionHash',
  'blockHash',
  'txid',
  'txId',
  'id',
  '_id',
  'publicKey',
  'extendedPublicKey',
  'secretCodeHash',
]);

/**
 * Paths inside `value` that hold a secret: by key name always, and by value
 * shape (64-hex, WIF, xprv, 12/18/24-word phrase) unless
 * `options.valueShapes === false`. The shape heuristics are for tests on
 * synthetic fixtures — real wallet data is full of public 64-hex values under
 * chain-specific keys (Tron `txID`, block hashes, token ids), so production
 * checks such as the migration self-verify use key names only.
 * `options.allowHexKeys` extends the public-hex allow list.
 */
export const findSecretPaths = (value, options = {}) => {
  const found = [];
  const valueShapes = options.valueShapes !== false;
  const allowedHex = new Set([
    ...HEX_ALLOWED_KEYS,
    ...(options.allowHexKeys || []),
  ]);
  const walk = (node, path, parentKey) => {
    if (typeof node === 'string') {
      if (
        SECRET_FIELD_NAMES.includes(parentKey) &&
        hasValue(node) &&
        parentKey !== 'secretCodeSalt'
      ) {
        found.push(path);
        return;
      }
      if (parentKey === 'secretCodeSalt' && hasValue(node)) {
        found.push(path);
        return;
      }
      if (valueShapes && looksLikeSecretValue(node)) {
        if (HEX64_RE.test(node) && allowedHex.has(parentKey)) {
          return;
        }
        found.push(path);
      }
      return;
    }
    if (Array.isArray(node)) {
      node.forEach((item, index) => walk(item, `${path}[${index}]`, parentKey));
      return;
    }
    if (isPlainObject(node)) {
      for (const key of Object.keys(node)) {
        walk(node[key], path ? `${path}.${key}` : key, key);
      }
    }
  };
  walk(value, '', undefined);
  return found;
};

export const assertNoSecrets = (value, options) => {
  const paths = findSecretPaths(value, options);
  if (paths.length) {
    throw new Error(
      `Secret material found at: ${paths.slice(0, 10).join(', ')}${
        paths.length > 10 ? ` (+${paths.length - 10} more)` : ''
      }`,
    );
  }
};
