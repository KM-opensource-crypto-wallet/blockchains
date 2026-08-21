import * as bitcoin from 'bitcoinjs-lib';
import ecc from '@bitcoinerlab/secp256k1';
import {BIP32Factory} from 'bip32';
import {IS_SANDBOX} from 'dok-wallet-blockchain-networks/config/config';
import {mergeUniqueAccounts} from 'dok-wallet-blockchain-networks/helper';

/**
 * BIP44/49/84 HD address helpers.
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
// must keep deriving that window (i=0,1 coincide with standard receive#0 /
// change#0 and need no extra entries).
const LEGACY_SCHEME_WINDOW = 20;

const bip32 = BIP32Factory(ecc);

const mainNetworkKeys = {
  bitcoin: {
    public: 0x04b24746,
    private: 0x04b2430c,
  },
  bitcoin_segwit: {
    public: 0x049d7cb2,
    private: 0x049d7878,
  },
  bitcoin_legacy: {
    public: 0x0488b21e,
    private: 0x0488ade4,
  },
};

const testnetNetworkKeys = {
  bitcoin: {
    public: 0x045f1cf6,
    private: 0x045f18bc,
  },
  bitcoin_segwit: {
    public: 0x044a5262,
    private: 0x044a4e28,
  },
  bitcoin_legacy: {
    public: 0x043587cf,
    private: 0x04358394,
  },
};

export const getNetworkByChainName = chain_name => {
  return chain_name === 'bitcoin' && IS_SANDBOX
    ? Object.assign({}, bitcoin.networks.testnet, {
        bip32: testnetNetworkKeys.bitcoin,
      })
    : chain_name === 'bitcoin'
    ? Object.assign({}, bitcoin.networks.bitcoin, {
        bip32: mainNetworkKeys.bitcoin,
      })
    : chain_name === 'bitcoin_legacy' && IS_SANDBOX
    ? Object.assign({}, bitcoin.networks.testnet, {
        bip32: testnetNetworkKeys.bitcoin_legacy,
      })
    : chain_name === 'bitcoin_legacy'
    ? Object.assign({}, bitcoin.networks.bitcoin, {
        bip32: mainNetworkKeys.bitcoin_legacy,
      })
    : chain_name === 'bitcoin_segwit' && IS_SANDBOX
    ? Object.assign({}, bitcoin.networks.testnet, {
        bip32: testnetNetworkKeys.bitcoin_segwit,
      })
    : chain_name === 'bitcoin_segwit'
    ? Object.assign({}, bitcoin.networks.bitcoin, {
        bip32: mainNetworkKeys.bitcoin_segwit,
      })
    : '';
};

export const getAccountBasePath = chain_name =>
  chain_name === 'bitcoin_segwit'
    ? "m/49'/0'/0'"
    : chain_name === 'bitcoin_legacy'
    ? "m/44'/0'/0'"
    : "m/84'/0'/0'";

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

const buildAddress = (chain_name, pubkey, network) => {
  if (chain_name === 'bitcoin_legacy') {
    return bitcoin.payments.p2pkh({pubkey, network}).address;
  }
  if (chain_name === 'bitcoin_segwit') {
    const p2wpkh = bitcoin.payments.p2wpkh({pubkey, network});
    return bitcoin.payments.p2sh({redeem: p2wpkh, network}).address;
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
      address: buildAddress(
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
 * Guarantees the base window exists: standard receive 0..19 + change 0..19,
 * plus the legacy-scheme window …/i/0 (i=2..19) so restored-from-seed wallets
 * keep seeing funds/change the old app put on those paths.
 * Idempotent; watch-only additions when accountKey is an xpub. Returns the
 * input list unchanged when nothing is missing or no accountKey is available
 * (private-key-imported coins).
 */
export const ensureStandardAddresses = ({
  chain_name,
  deriveAddresses,
  accountKey,
}) => {
  const existing = Array.isArray(deriveAddresses) ? deriveAddresses : [];
  if (!accountKey) {
    return existing;
  }
  const existingPaths = new Set(existing.map(item => item?.derivePath));
  const basePath = getAccountBasePath(chain_name);
  const requiredPaths = [];
  for (const chainIndex of [RECEIVE_CHAIN, CHANGE_CHAIN]) {
    for (let i = 0; i < GAP_LIMIT; i++) {
      requiredPaths.push(`${basePath}/${chainIndex}/${i}`);
    }
  }
  for (let i = 2; i < LEGACY_SCHEME_WINDOW; i++) {
    requiredPaths.push(`${basePath}/${i}/0`);
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
    for (let i = 2; i < LEGACY_SCHEME_WINDOW; i++) {
      additions.push(
        ...deriveItemsFromNode({...common, chainIndex: i, start: 0, count: 1}),
      );
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
