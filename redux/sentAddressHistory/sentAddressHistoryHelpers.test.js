// Mock the blockchain helper so the test stays isolated from native modules
// (the real helper/index.js pulls in react-native-device-info, ethers, etc.).
jest.mock('dok-wallet-blockchain-networks/helper', () => {
  const EVM_CHAINS = [
    'ethereum',
    'binance_smart_chain',
    'polygon',
    'base',
    'arbitrum',
  ];
  return {
    isEVMChain: chain_name => EVM_CHAINS.includes(chain_name),
  };
});

import {computeNextAddresses} from './sentAddressHistoryHelpers';

const MAX = 1000;
const A = '0xaaaa000000000000000000000000000000000001';
const B = '0xbbbb000000000000000000000000000000000002';

const record = (addresses, address, chain_name = 'ethereum', max = MAX) =>
  computeNextAddresses(addresses, {chain_name, address}, max);

describe('computeNextAddresses', () => {
  it('stores newest-first', () => {
    let state = record({}, A);
    state = record(state, B);
    expect(state.evm).toEqual([B, A]);
  });

  it('dedupes and refreshes recency when re-recording the same address', () => {
    let state = record({}, A);
    state = record(state, B);
    state = record(state, A); // re-record A
    expect(state.evm).toEqual([A, B]); // A back to front, no duplicate, length 2
  });

  it('evicts the oldest (tail) entry once the cap is exceeded', () => {
    const cap = 3;
    let state = {};
    state = record(state, A, 'ethereum', cap);
    state = record(state, B, 'ethereum', cap);
    state = record(
      state,
      '0xcccc000000000000000000000000000000000003',
      'ethereum',
      cap,
    );
    // bucket is now [C, B, A]; adding a 4th drops A (oldest tail)
    const D = '0xdddd000000000000000000000000000000000004';
    state = record(state, D, 'ethereum', cap);
    expect(state.evm).toHaveLength(cap);
    expect(state.evm[0]).toBe(D);
    expect(state.evm).not.toContain(A);
  });

  it('normalizes: lowercases and trims', () => {
    const state = record({}, '  0xAbCdEf0000000000000000000000000000001234  ');
    expect(state.evm).toEqual(['0xabcdef0000000000000000000000000000001234']);
  });

  it('ignores non-EVM chains (returns the same reference)', () => {
    const addresses = {evm: [A]};
    const next = record(addresses, 'SoLaNaAddr1111111111', 'solana');
    expect(next).toBe(addresses);
  });

  it('ignores empty / missing addresses (returns the same reference)', () => {
    const addresses = {evm: [A]};
    expect(record(addresses, '   ')).toBe(addresses);
    expect(record(addresses, undefined)).toBe(addresses);
  });

  it('all EVM chains share the single evm bucket', () => {
    let state = record({}, A, 'ethereum');
    state = record(state, B, 'polygon');
    expect(Object.keys(state)).toEqual(['evm']);
    expect(state.evm).toEqual([B, A]);
  });
});
