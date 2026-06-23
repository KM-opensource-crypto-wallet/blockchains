import {isEVMChain} from 'dok-wallet-blockchain-networks/helper';

// Pure, redux-free logic for the sentAddressHistory slice. Kept separate so it
// can be unit-tested without importing @reduxjs/toolkit (and its ESM-only immer
// dependency, which the jest config does not transform).

// Given the current `addresses` map and a raw recordSentAddress payload, return
// the next map. EVM-only; the recipient is normalized (trimmed + lowercased),
// stored newest-first, deduped, and capped at `max`. Returns the same map
// reference (a no-op) when the payload should be ignored.
export const computeNextAddresses = (addresses, payload, max) => {
  const chainName = payload?.chain_name;
  const rawAddress = payload?.address;
  // EVM-only scope: ignore non-EVM chains (case-sensitive address spaces).
  if (!chainName || !rawAddress || !isEVMChain(chainName)) {
    return addresses;
  }
  const normalized = rawAddress.trim().toLowerCase();
  if (!normalized) {
    return addresses;
  }
  const groupKey = 'evm';
  const current = addresses || {};
  const bucket = Array.isArray(current[groupKey]) ? current[groupKey] : [];
  const deduped = bucket.filter(item => item !== normalized);
  deduped.unshift(normalized); // newest-first
  return {...current, [groupKey]: deduped.slice(0, max)};
};
