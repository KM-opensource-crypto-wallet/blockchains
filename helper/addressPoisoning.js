import {isEVMChain} from 'dok-wallet-blockchain-networks/helper';

// Group key under which a chain's trusted addresses are compared. EVM chains
// share a single 'evm' bucket because they all use the same (case-insensitive)
// address space; non-EVM chains are keyed by their own chain_name.
export const getAddressGroupKey = chain_name =>
  isEVMChain(chain_name) ? 'evm' : chain_name;

export const PREFIX_LENGTH = 6;
export const SUFFIX_LENGTH = 6;
const MIN_ADDRESS_LENGTH = PREFIX_LENGTH + SUFFIX_LENGTH;

// Length of the actual matching prefix/suffix shared by two addresses
// (case-insensitive). Used by the UI to highlight exactly how much overlaps —
// which is usually more than the PREFIX_LENGTH/SUFFIX_LENGTH detection threshold.
export const getCommonAffixLengths = (a, b) => {
  if (typeof a !== 'string' || typeof b !== 'string') {
    return {prefixLength: 0, suffixLength: 0};
  }
  const x = a.toLowerCase();
  const y = b.toLowerCase();
  const minLength = Math.min(x.length, y.length);
  let prefixLength = 0;
  while (prefixLength < minLength && x[prefixLength] === y[prefixLength]) {
    prefixLength += 1;
  }
  let suffixLength = 0;
  // Stop before overlapping the prefix so the same chars aren't highlighted twice.
  while (
    suffixLength < minLength - prefixLength &&
    x[x.length - 1 - suffixLength] === y[y.length - 1 - suffixLength]
  ) {
    suffixLength += 1;
  }
  return {prefixLength, suffixLength};
};

const isLookalike = (candidate, input) =>
  candidate !== input &&
  candidate.slice(0, PREFIX_LENGTH) === input.slice(0, PREFIX_LENGTH) &&
  candidate.slice(-SUFFIX_LENGTH) === input.slice(-SUFFIX_LENGTH);

/**
 * Detects an address-poisoning lookalike: a previously-trusted address that
 * shares the first 6 and last 6 characters of `inputAddress` but is not the
 * same address.
 *
 * EVM-only for now — returns null for non-EVM chains (their addresses are
 * case-sensitive, so lowercase-normalized matching is unsafe).
 *
 * @returns the matched trusted address (original casing from the source) or null.
 */
export const findLookalikeAddress = ({
  inputAddress,
  chain_name,
  sentHistory,
  addressBook,
}) => {
  if (!isEVMChain(chain_name) || typeof inputAddress !== 'string') {
    return null;
  }
  const input = inputAddress.trim().toLowerCase();
  if (input.length < MIN_ADDRESS_LENGTH) {
    return null;
  }
  const groupKey = getAddressGroupKey(chain_name);

  // Previously-sent addresses (already stored lowercased).
  const sentBucket = Array.isArray(sentHistory?.[groupKey])
    ? sentHistory[groupKey]
    : [];
  for (const candidate of sentBucket) {
    if (typeof candidate === 'string' && isLookalike(candidate, input)) {
      return candidate;
    }
  }

  // Address Book entries on the same group (i.e. EVM contacts).
  const book = Array.isArray(addressBook) ? addressBook : [];
  for (const entry of book) {
    const entryAddress = entry?.address;
    if (
      typeof entryAddress === 'string' &&
      getAddressGroupKey(entry?.chain_name) === groupKey &&
      isLookalike(entryAddress.trim().toLowerCase(), input)
    ) {
      return entryAddress;
    }
  }

  return null;
};
