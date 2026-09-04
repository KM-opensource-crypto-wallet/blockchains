import * as bitcoin from 'bitcoinjs-lib';
import ecc from '@bitcoinerlab/secp256k1';
import {BIP32Factory} from 'bip32';
import {toXOnly} from 'bitcoinjs-lib/src/psbt/bip371';
import {IS_SANDBOX} from 'dok-wallet-blockchain-networks/config/config';
import {mergeUniqueAccounts} from 'dok-wallet-blockchain-networks/helper';

/**
 * BIP44/49/84/86 HD address helpers.
 *
 * Standard account layout (what BlueWallet / Electrum / hardware wallets
 * follow): two chains per account — external/receive `…/0/i` and
 * internal/change `…/1/i` — discovered with a gap limit of 20 consecutive
 * unused addresses (BIP44).
 *
 * Bulk generation with private keys happens natively (getDeriveAddresses /
 * getDeriveAddressRange in the iOS/Android modules). This module only derives
 * small watch-only increments from the account xpub where the mnemonic is not
 * available (balance-flow gap top-ups); those entries are signed via the
 * xprv fallback in BitcoinChain buildUTXO.
 */

export const RECEIVE_CHAIN = 0;
export const CHANGE_CHAIN = 1;
export const GAP_LIMIT = 20;
export const MAX_ADDRESSES_PER_CHAIN = 500;
// Older app versions derived the nonstandard scheme …/i/0 (index in the
// change slot). Funds and change may sit on i=2..19 forever, so restores
// must keep deriving that window until a one-time usage scan proves the
// whole window unused (i=0,1 coincide with standard receive#0 / change#0
// and need no extra entries).
export const LEGACY_SCHEME_WINDOW = 20;
const LEGACY_WINDOW_START = 2;

const bip32 = BIP32Factory(ecc);

// bitcoinjs-lib needs the secp256k1 backend registered before any taproot
// (p2tr) call; idempotent, so every entry point may call it.
let eccInitDone = false;
export const ensureEccInit = () => {
  if (!eccInitDone) {
    bitcoin.initEccLib(ecc);
    eccInitDone = true;
  }
};

/**
 * One row per bitcoin address type (chain_name): BIP purpose, SLIP-132
 * extended-key version bytes (BIP-86 taproot has no dedicated prefix and uses
 * plain xpub/xprv), and whether the app's old nonstandard `…/i/0` scheme ever
 * existed for it (it predates taproot support, so taproot has no legacy
 * window to scan). Native coin classes must stay in step with the purpose.
 */
export const BITCOIN_ADDRESS_TYPES = {
  bitcoin: {
    purpose: 84,
    mainnet: {public: 0x04b24746, private: 0x04b2430c}, // zpub / zprv
    testnet: {public: 0x045f1cf6, private: 0x045f18bc}, // vpub / vprv
    hasLegacyScheme: true,
  },
  bitcoin_segwit: {
    purpose: 49,
    mainnet: {public: 0x049d7cb2, private: 0x049d7878}, // ypub / yprv
    testnet: {public: 0x044a5262, private: 0x044a4e28}, // upub / uprv
    hasLegacyScheme: true,
  },
  bitcoin_legacy: {
    purpose: 44,
    mainnet: {public: 0x0488b21e, private: 0x0488ade4}, // xpub / xprv
    testnet: {public: 0x043587cf, private: 0x04358394}, // tpub / tprv
    hasLegacyScheme: true,
  },
  bitcoin_taproot: {
    purpose: 86,
    mainnet: {public: 0x0488b21e, private: 0x0488ade4}, // xpub / xprv
    testnet: {public: 0x043587cf, private: 0x04358394}, // tpub / tprv
    hasLegacyScheme: false,
  },
};

export const isKnownBitcoinChain = chain_name =>
  !!BITCOIN_ADDRESS_TYPES[chain_name];

export const hasLegacyScheme = chain_name =>
  !!BITCOIN_ADDRESS_TYPES[chain_name]?.hasLegacyScheme;

// Unknown names keep the historical BIP84 default.
export const getBitcoinPurpose = chain_name =>
  BITCOIN_ADDRESS_TYPES[chain_name]?.purpose ?? 84;

export const getNetworkByChainName = chain_name => {
  const addressType = BITCOIN_ADDRESS_TYPES[chain_name];
  if (!addressType) {
    return '';
  }
  return IS_SANDBOX
    ? Object.assign({}, bitcoin.networks.testnet, {bip32: addressType.testnet})
    : Object.assign({}, bitcoin.networks.bitcoin, {bip32: addressType.mainnet});
};

export const getAccountBasePath = chain_name => {
  const coinType = IS_SANDBOX ? 1 : 0;
  return `m/${getBitcoinPurpose(chain_name)}'/${coinType}'/0'`;
};

/**
 * Last two path segments as numbers. Standard paths (`…/0/i`, `…/1/i`) parse
 * as {chainIndex: 0|1, addressIndex: i}; the app's legacy paths (`…/i/0`)
 * parse as {chainIndex: i, addressIndex: 0} — deriving
 * account/(chainIndex)/(addressIndex) reproduces both schemes, so signing and
 * sorting work uniformly.
 */
export const parsePathTail = derivePath => {
  const parts = typeof derivePath === 'string' ? derivePath.split('/') : [];
  if (parts.length < 2) {
    return {chainIndex: 0, addressIndex: 0};
  }
  return {
    chainIndex: Number(parts[parts.length - 2]) || 0,
    addressIndex: Number(parts[parts.length - 1]) || 0,
  };
};

/**
 * Address for a compressed public key in the chain's script type: P2PKH
 * (legacy), P2SH-P2WPKH (segwit), P2TR key-path (taproot), else P2WPKH.
 */
export const buildAddressByChain = (chain_name, pubkey, network) => {
  if (chain_name === 'bitcoin_legacy') {
    return bitcoin.payments.p2pkh({pubkey, network}).address;
  }
  if (chain_name === 'bitcoin_segwit') {
    const p2wpkh = bitcoin.payments.p2wpkh({pubkey, network});
    return bitcoin.payments.p2sh({redeem: p2wpkh, network}).address;
  }
  if (chain_name === 'bitcoin_taproot') {
    ensureEccInit();
    return bitcoin.payments.p2tr({internalPubkey: toXOnly(pubkey), network})
      .address;
  }
  return bitcoin.payments.p2wpkh({pubkey, network}).address;
};

const deriveItemsFromNode = ({
  chain_name,
  accountNode,
  network,
  basePath,
  chainIndex,
  start,
  count,
}) => {
  const chainNode = accountNode.derive(chainIndex);
  const hasPrivateKey = !accountNode.isNeutered();
  const result = [];
  for (let i = start; i < start + count; i++) {
    const child = chainNode.derive(i);
    const item = {
      derivePath: `${basePath}/${chainIndex}/${i}`,
      address: buildAddressByChain(
        chain_name,
        // eslint-disable-next-line no-undef
        Buffer.from(child.publicKey),
        network,
      ),
    };
    if (hasPrivateKey) {
      item.privateKey = child.toWIF();
    }
    result.push(item);
  }
  return result;
};

/**
 * Derives `count` addresses on one chain from an account-level extended key.
 * xprv → items include a WIF privateKey; xpub → watch-only items.
 */
export const deriveAddressRange = ({
  chain_name,
  accountKey,
  chainIndex,
  start,
  count,
}) => {
  const network = getNetworkByChainName(chain_name);
  if (!network || !accountKey || !(count > 0) || start < 0 || chainIndex < 0) {
    return [];
  }
  return deriveItemsFromNode({
    chain_name,
    accountNode: bip32.fromBase58(accountKey, network),
    network,
    basePath: getAccountBasePath(chain_name),
    chainIndex,
    start,
    count,
  });
};

/**
 * WIF for one derive path from the account xprv (both path schemes work
 * through parsePathTail). Returns null for xpubs or on any failure.
 */
export const derivePrivateKeyForPath = ({
  chain_name,
  extendedPrivateKey,
  derivePath,
}) => {
  try {
    const network = getNetworkByChainName(chain_name);
    if (!network || !extendedPrivateKey || !derivePath) {
      return null;
    }
    const node = bip32.fromBase58(extendedPrivateKey, network);
    if (node.isNeutered()) {
      return null;
    }
    const {chainIndex, addressIndex} = parsePathTail(derivePath);
    return node.derive(chainIndex).derive(addressIndex).toWIF();
  } catch (e) {
    return null;
  }
};

const standardPathPrefix = (chain_name, chainIndex) =>
  `${getAccountBasePath(chain_name)}/${chainIndex}/`;

/** Entries whose derivePath sits on a standard receive/change chain. */
export const getStandardChainItems = (chain_name, deriveAddresses) => {
  const items = Array.isArray(deriveAddresses) ? deriveAddresses : [];
  const receivePrefix = standardPathPrefix(chain_name, RECEIVE_CHAIN);
  const changePrefix = standardPathPrefix(chain_name, CHANGE_CHAIN);
  return items.filter(
    item =>
      typeof item?.derivePath === 'string' &&
      (item.derivePath.startsWith(receivePrefix) ||
        item.derivePath.startsWith(changePrefix)),
  );
};

/**
 * The legacy-scheme paths `${basePath}/2/0` … `${basePath}/19/0`; empty for
 * address types that never had the old scheme.
 */
export const buildLegacyWindowPaths = chain_name => {
  const paths = [];
  if (!hasLegacyScheme(chain_name)) {
    return paths;
  }
  const basePath = getAccountBasePath(chain_name);
  for (let i = LEGACY_WINDOW_START; i < LEGACY_SCHEME_WINDOW; i++) {
    paths.push(`${basePath}/${i}/0`);
  }
  return paths;
};

/** True only for the exact legacy-window shape `${basePath}/i/0`, i=2..19. */
export const isLegacyWindowPath = (chain_name, derivePath) => {
  if (typeof derivePath !== 'string' || !hasLegacyScheme(chain_name)) {
    return false;
  }
  const {chainIndex, addressIndex} = parsePathTail(derivePath);
  return (
    addressIndex === 0 &&
    chainIndex >= LEGACY_WINDOW_START &&
    chainIndex < LEGACY_SCHEME_WINDOW &&
    derivePath === `${getAccountBasePath(chain_name)}/${chainIndex}/0`
  );
};

/** Non-custom entries sitting on the legacy window (usage-scan candidates). */
export const getLegacyWindowItems = (chain_name, deriveAddresses) => {
  const items = Array.isArray(deriveAddresses) ? deriveAddresses : [];
  return items.filter(
    item => !item?.isCustom && isLegacyWindowPath(chain_name, item?.derivePath),
  );
};

/**
 * All-or-nothing prune decision: the legacy window may be deleted only when
 * EVERY entry has an explicit empty-history result (usage[address] === false),
 * none carries a recorded balance, and none is a protected address (e.g. the
 * coin's active address). A single used/unknown/errored entry keeps all 18.
 */
export const shouldPruneLegacyWindow = ({
  legacyItems,
  usage,
  keepAddresses,
}) => {
  const items = Array.isArray(legacyItems) ? legacyItems : [];
  if (!items.length) {
    return false;
  }
  return items.every(
    item =>
      usage?.[item?.address] === false &&
      !(Number(item?.balance) > 0) &&
      !keepAddresses?.has(item?.address),
  );
};

/** The list without non-custom legacy-window entries. */
export const removeLegacyWindowItems = (chain_name, deriveAddresses) => {
  const items = Array.isArray(deriveAddresses) ? deriveAddresses : [];
  return items.filter(
    item => item?.isCustom || !isLegacyWindowPath(chain_name, item?.derivePath),
  );
};

/**
 * Guarantees the base window exists: standard receive 0..19 + change 0..19,
 * plus (while includeLegacyWindow) the legacy-scheme window …/i/0 (i=2..19)
 * so restored-from-seed wallets keep seeing funds/change the old app put on
 * those paths. Once a coin's one-time legacy usage scan has resolved the
 * window, callers pass includeLegacyWindow: false so pruned entries are never
 * re-derived. Idempotent; watch-only additions when accountKey is an xpub.
 * Returns the input list unchanged when nothing is missing or no accountKey
 * is available (private-key-imported coins).
 */
export const ensureStandardAddresses = ({
  chain_name,
  deriveAddresses,
  accountKey,
  includeLegacyWindow = true,
}) => {
  const existing = Array.isArray(deriveAddresses) ? deriveAddresses : [];
  if (!accountKey) {
    return existing;
  }
  const existingPaths = new Set(existing.map(item => item?.derivePath));
  const basePath = getAccountBasePath(chain_name);
  const includeLegacy = includeLegacyWindow && hasLegacyScheme(chain_name);
  const requiredPaths = [];
  for (const chainIndex of [RECEIVE_CHAIN, CHANGE_CHAIN]) {
    for (let i = 0; i < GAP_LIMIT; i++) {
      requiredPaths.push(`${basePath}/${chainIndex}/${i}`);
    }
  }
  if (includeLegacy) {
    requiredPaths.push(...buildLegacyWindowPaths(chain_name));
  }
  if (requiredPaths.every(path => existingPaths.has(path))) {
    return existing;
  }
  try {
    const network = getNetworkByChainName(chain_name);
    const accountNode = bip32.fromBase58(accountKey, network);
    const common = {chain_name, accountNode, network, basePath};
    const additions = [RECEIVE_CHAIN, CHANGE_CHAIN].flatMap(chainIndex =>
      deriveItemsFromNode({...common, chainIndex, start: 0, count: GAP_LIMIT}),
    );
    if (includeLegacy) {
      for (let i = LEGACY_WINDOW_START; i < LEGACY_SCHEME_WINDOW; i++) {
        additions.push(
          ...deriveItemsFromNode({
            ...common,
            chainIndex: i,
            start: 0,
            count: 1,
          }),
        );
      }
    }
    return mergeUniqueAccounts(existing, additions);
  } catch (e) {
    console.error('error ensuring standard bitcoin addresses', e);
    return existing;
  }
};

/** True when the path sits on the internal/change chain (…/1/i). */
export const isInternalChainAddress = (chain_name, derivePath) =>
  typeof derivePath === 'string' &&
  derivePath.startsWith(standardPathPrefix(chain_name, CHANGE_CHAIN));

/**
 * Entries shown in address pickers: internal/change-chain addresses are not
 * user accounts, so they only appear when they actually hold funds.
 */
export const getVisibleDeriveAddresses = (chain_name, deriveAddresses) => {
  const items = Array.isArray(deriveAddresses) ? deriveAddresses : [];
  return items.filter(
    item =>
      item?.address &&
      (!isInternalChainAddress(chain_name, item?.derivePath) ||
        Number(item?.balance) > 0),
  );
};

/**
 * Display label for a derive-address entry. Only meaningful for bitcoin
 * chains — callers gate with isBitcoinChain. Precedence: a user-added entry
 * is Custom regardless of where its path sits.
 */
export const getDeriveAddressLabel = (chain_name, item) => {
  if (item?.isCustom) {
    return 'Custom';
  }
  if (isLegacyWindowPath(chain_name, item?.derivePath)) {
    return 'Legacy';
  }
  if (isInternalChainAddress(chain_name, item?.derivePath)) {
    return 'Change';
  }
  return 'Receive';
};

/**
 * BIP44 gap limit: per chain, make sure GAP_LIMIT addresses exist beyond the
 * highest used index. `usedAddresses` is a Set of addresses with tx history.
 * Returns the input list unchanged when nothing needs deriving.
 */
export const extendByGapLimit = ({
  chain_name,
  deriveAddresses,
  accountKey,
  usedAddresses,
}) => {
  const existing = Array.isArray(deriveAddresses) ? deriveAddresses : [];
  if (!accountKey || !usedAddresses) {
    return existing;
  }
  const additions = [];
  for (const chainIndex of [RECEIVE_CHAIN, CHANGE_CHAIN]) {
    const prefix = standardPathPrefix(chain_name, chainIndex);
    let highestDerived = -1;
    let highestUsed = -1;
    existing.forEach(item => {
      if (!item?.derivePath?.startsWith(prefix)) {
        return;
      }
      const {addressIndex} = parsePathTail(item.derivePath);
      if (addressIndex > highestDerived) {
        highestDerived = addressIndex;
      }
      if (usedAddresses.has(item.address) && addressIndex > highestUsed) {
        highestUsed = addressIndex;
      }
    });
    const target = Math.min(
      highestUsed + GAP_LIMIT,
      MAX_ADDRESSES_PER_CHAIN - 1,
    );
    if (target > highestDerived) {
      additions.push(
        ...deriveAddressRange({
          chain_name,
          accountKey,
          chainIndex,
          start: highestDerived + 1,
          count: target - highestDerived,
        }),
      );
    }
  }
  if (!additions.length) {
    return existing;
  }
  return mergeUniqueAccounts(existing, additions);
};
