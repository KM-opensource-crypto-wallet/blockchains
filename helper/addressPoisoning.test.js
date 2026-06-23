// Mock the blockchain helper so the test stays isolated from native modules
// (the real helper/index.js pulls in react-native-device-info, ethers, etc.).
jest.mock('dok-wallet-blockchain-networks/helper', () => {
  const EVM_CHAINS = [
    'ethereum',
    'binance_smart_chain',
    'polygon',
    'base',
    'arbitrum',
    'optimism',
    'optimism_binance_smart_chain',
    'avalanche',
    'fantom',
    'gnosis',
    'viction',
    'linea',
    'zksync',
    'ethereum_classic',
    'ethereum_pow',
    'kava',
    'ink',
    'sei',
    'hyperliquid',
  ];
  return {
    isEVMChain: chain_name => EVM_CHAINS.includes(chain_name),
  };
});

import {
  findLookalikeAddress,
  getAddressGroupKey,
  getCommonAffixLengths,
} from './addressPoisoning';

// A trusted address and a lookalike sharing first-6 (0x + 4) and last-6 chars.
const TRUSTED = '0xAbCdEf1111111111111111111111111111abcdef';
const LOOKALIKE = '0xAbCdEf9999999999999999999999999999abcdef';
const DIFFERENT_PREFIX = '0x123456111111111111111111111111111111abcdef';
const DIFFERENT_SUFFIX = '0xAbCdEf1111111111111111111111111111123456';

describe('getAddressGroupKey', () => {
  it('buckets all EVM chains under "evm"', () => {
    expect(getAddressGroupKey('ethereum')).toBe('evm');
    expect(getAddressGroupKey('polygon')).toBe('evm');
    expect(getAddressGroupKey('arbitrum')).toBe('evm');
  });

  it('keys non-EVM chains by chain_name', () => {
    expect(getAddressGroupKey('solana')).toBe('solana');
    expect(getAddressGroupKey('tron')).toBe('tron');
  });
});

describe('getCommonAffixLengths', () => {
  it('measures the full shared prefix and suffix, not just the threshold', () => {
    const a = '0xdead1234aaaaaaaaaaaaaaaaaaaaaa9876543210';
    const b = '0xdead1234bbbbbbbbbbbbbbbbbbbbbb9876543210';
    expect(getCommonAffixLengths(a, b)).toEqual({
      prefixLength: 10, // 0xdead1234
      suffixLength: 10, // 9876543210
    });
  });

  it('is case-insensitive', () => {
    const a = '0xDEAD1234aaaaaaaaaaaaaaaaaaaaaa9876543210';
    const b = '0xdead1234bbbbbbbbbbbbbbbbbbbbbb9876543210';
    expect(getCommonAffixLengths(a, b)).toEqual({
      prefixLength: 10,
      suffixLength: 10,
    });
  });

  it('does not overlap prefix and suffix for nearly-identical strings', () => {
    const a = '0xaaaaaab';
    const b = '0xaaaaaac';
    const {prefixLength, suffixLength} = getCommonAffixLengths(a, b);
    expect(prefixLength + suffixLength).toBeLessThanOrEqual(a.length);
  });

  it('returns zeros for non-string input', () => {
    expect(getCommonAffixLengths(null, '0xabc')).toEqual({
      prefixLength: 0,
      suffixLength: 0,
    });
  });
});

describe('findLookalikeAddress', () => {
  const sentHistory = {evm: [TRUSTED.toLowerCase()]};

  it('flags a lookalike of a previously-sent EVM address', () => {
    expect(
      findLookalikeAddress({
        inputAddress: LOOKALIKE,
        chain_name: 'ethereum',
        sentHistory,
        addressBook: [],
      }),
    ).toBe(TRUSTED.toLowerCase());
  });

  it('returns null for the identical address', () => {
    expect(
      findLookalikeAddress({
        inputAddress: TRUSTED,
        chain_name: 'ethereum',
        sentHistory,
        addressBook: [],
      }),
    ).toBeNull();
  });

  it('returns null when the prefix differs', () => {
    expect(
      findLookalikeAddress({
        inputAddress: DIFFERENT_PREFIX,
        chain_name: 'ethereum',
        sentHistory,
        addressBook: [],
      }),
    ).toBeNull();
  });

  it('returns null when the suffix differs', () => {
    expect(
      findLookalikeAddress({
        inputAddress: DIFFERENT_SUFFIX,
        chain_name: 'ethereum',
        sentHistory,
        addressBook: [],
      }),
    ).toBeNull();
  });

  it('compares across different EVM chains (history on one chain, send on another)', () => {
    expect(
      findLookalikeAddress({
        inputAddress: LOOKALIKE,
        chain_name: 'polygon',
        sentHistory,
        addressBook: [],
      }),
    ).toBe(TRUSTED.toLowerCase());
  });

  it('is case-insensitive on the input address', () => {
    expect(
      findLookalikeAddress({
        inputAddress: LOOKALIKE.toUpperCase(),
        chain_name: 'ethereum',
        sentHistory,
        addressBook: [],
      }),
    ).toBe(TRUSTED.toLowerCase());
  });

  it('returns null for non-EVM chains (out of scope)', () => {
    expect(
      findLookalikeAddress({
        inputAddress: LOOKALIKE,
        chain_name: 'solana',
        sentHistory: {solana: [TRUSTED.toLowerCase()]},
        addressBook: [],
      }),
    ).toBeNull();
  });

  it('flags a lookalike of an EVM Address Book contact', () => {
    expect(
      findLookalikeAddress({
        inputAddress: LOOKALIKE,
        chain_name: 'ethereum',
        sentHistory: {},
        addressBook: [{address: TRUSTED, chain_name: 'binance_smart_chain'}],
      }),
    ).toBe(TRUSTED);
  });

  it('ignores Address Book contacts on non-EVM chains', () => {
    expect(
      findLookalikeAddress({
        inputAddress: LOOKALIKE,
        chain_name: 'ethereum',
        sentHistory: {},
        addressBook: [{address: TRUSTED, chain_name: 'solana'}],
      }),
    ).toBeNull();
  });
});
