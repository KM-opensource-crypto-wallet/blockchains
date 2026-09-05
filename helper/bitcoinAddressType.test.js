import {isAddressOrPrivateKeyExists} from 'dok-wallet-blockchain-networks/helper';

jest.mock('utils/common', () => ({APP_VERSION: '9.9.9'}));
jest.mock('dok-wallet-blockchain-networks/config/config', () => ({
  ...jest.requireActual('dok-wallet-blockchain-networks/config/config'),
  IS_SANDBOX: false,
}));
// helper/index.js pulls the RPC session layer (uuid ESM, DokApi); none of it
// is exercised here.
jest.mock('dok-wallet-blockchain-networks/rpcUrls/rpcUrls', () => ({
  getRPCUrl: jest.fn(),
}));
jest.mock('dok-wallet-blockchain-networks/rpcUrls/rpcSession', () => ({
  rpcSessionAdapter: jest.fn(),
}));

const coin = (chain_name, address) => ({
  chain_name,
  address,
  privateKey: 'wif',
  appVersion: '9.9.9',
});

describe('isAddressOrPrivateKeyExists bitcoin address-type prefixes', () => {
  it.each([
    ['bitcoin', 'bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu', true],
    [
      'bitcoin',
      'bc1p5cyxnuxmeuwuvkwfem96lqzszd02n6xdcjrs20cac6yqjjwudpxqkedrcr',
      false,
    ],
    [
      'bitcoin_taproot',
      'bc1p5cyxnuxmeuwuvkwfem96lqzszd02n6xdcjrs20cac6yqjjwudpxqkedrcr',
      true,
    ],
    ['bitcoin_taproot', 'bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu', false],
    ['bitcoin_segwit', '3J98t1WpEZ73CNmQviecrnyiWrnqRhWNLy', true],
    ['bitcoin_segwit', '1BvBMSEYstWetqTFn5Au4m4GFg7xJaNVN2', false],
    ['bitcoin_legacy', '1BvBMSEYstWetqTFn5Au4m4GFg7xJaNVN2', true],
    ['bitcoin_legacy', '3J98t1WpEZ73CNmQviecrnyiWrnqRhWNLy', false],
  ])('%s with %s -> %s', (chain_name, address, expected) => {
    expect(isAddressOrPrivateKeyExists(coin(chain_name, address))).toBe(
      expected,
    );
  });

  it('rejects a bitcoin coin stored by an older app version', () => {
    expect(
      isAddressOrPrivateKeyExists({
        ...coin(
          'bitcoin_taproot',
          'bc1p5cyxnuxmeuwuvkwfem96lqzszd02n6xdcjrs20cac6yqjjwudpxqkedrcr',
        ),
        appVersion: '1.0.0',
      }),
    ).toBe(false);
  });
});
