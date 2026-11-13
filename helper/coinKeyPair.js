// A coin's `address` and `privateKey` are two separate fields, and some code
// paths have written one without the other (adding a coin copied the parent's
// selected address but kept the default key; address-picker refreshes fell
// back to the previous key). An EVM send then fails in ethers with
// "transaction from mismatch": the key signs for a different account than
// `tx.from`. Re-selecting the address in the picker fixed it because
// setSelectedDeriveAddress re-reads the key from that address's own
// `deriveAddresses` entry; this does the same automatically.
//
// EVM only: other chains store keys in chain-specific formats, and this check
// derives the address from the key with ethers.
import {computeAddress} from 'ethers';
import {isEVMChain} from 'dok-wallet-blockchain-networks/helper';

const normalizeHex = value =>
  typeof value === 'string'
    ? value.trim().toLowerCase().replace(/^0x/, '')
    : '';

const isSameAddress = (a, b) =>
  typeof a === 'string' &&
  typeof b === 'string' &&
  a.length > 0 &&
  a.toLowerCase() === b.toLowerCase();

const addressOfPrivateKey = privateKey => {
  const hex = normalizeHex(privateKey);
  if (!hex) {
    return null;
  }
  try {
    return computeAddress(`0x${hex}`);
  } catch (e) {
    return null;
  }
};

/** True when ethers derives `address` from `privateKey` (EVM keys only). */
export const isPrivateKeyForAddress = (privateKey, address) =>
  isSameAddress(addressOfPrivateKey(privateKey), address);

/**
 * The private key that signs for `coin.address`. Returns `coin.privateKey`
 * unchanged unless the coin is on an EVM chain and its `deriveAddresses`
 * entry for that address carries a different key that provably belongs to
 * the address. Cheap in the normal case (one array scan, no key math); the
 * key-to-address check runs only when the two keys differ.
 */
export const getPrivateKeyForCoinAddress = coin => {
  const privateKey = coin?.privateKey;
  if (
    !isEVMChain(coin?.chain_name) ||
    !coin?.address ||
    !Array.isArray(coin?.deriveAddresses)
  ) {
    return privateKey;
  }
  const entry = coin.deriveAddresses.find(item =>
    isSameAddress(item?.address, coin.address),
  );
  const entryKey = entry?.privateKey;
  if (!entryKey || normalizeHex(entryKey) === normalizeHex(privateKey)) {
    return privateKey;
  }
  return isSameAddress(addressOfPrivateKey(entryKey), coin.address)
    ? entryKey
    : privateKey;
};
