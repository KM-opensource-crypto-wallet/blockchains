import {ethers} from 'ethers';
import {getPrivateKeyForCoinAddress} from 'dok-wallet-blockchain-networks/helper/coinKeyPair';

const KEY_A = `0x${'11'.repeat(32)}`;
const KEY_B = `0x${'22'.repeat(32)}`;
const KEY_C = `0x${'33'.repeat(32)}`;
const ADDRESS_A = ethers.computeAddress(KEY_A);
const ADDRESS_B = ethers.computeAddress(KEY_B);

const deriveAddresses = [
  {address: ADDRESS_A, privateKey: KEY_A, derivePath: "m/44'/60'/0'/0/0"},
  {address: ADDRESS_B, privateKey: KEY_B, derivePath: "m/44'/60'/0'/0/1"},
];

const evmCoin = overrides => ({
  chain_name: 'arbitrum',
  symbol: 'ETH',
  deriveAddresses,
  ...overrides,
});

describe('getPrivateKeyForCoinAddress', () => {
  it('returns the derive entry key when the stored key is for another address', () => {
    const coin = evmCoin({address: ADDRESS_B, privateKey: KEY_A});
    expect(getPrivateKeyForCoinAddress(coin)).toBe(KEY_B);
  });

  it('leaves a matching pair untouched', () => {
    const coin = evmCoin({address: ADDRESS_B, privateKey: KEY_B});
    expect(getPrivateKeyForCoinAddress(coin)).toBe(KEY_B);
  });

  it('treats the same key with or without 0x / in another case as a match', () => {
    const raw = KEY_B.slice(2).toUpperCase();
    const coin = evmCoin({address: ADDRESS_B, privateKey: raw});
    expect(getPrivateKeyForCoinAddress(coin)).toBe(raw);
  });

  it('matches the entry by address case-insensitively', () => {
    const coin = evmCoin({
      address: ADDRESS_B.toLowerCase(),
      privateKey: KEY_A,
    });
    expect(getPrivateKeyForCoinAddress(coin)).toBe(KEY_B);
  });

  it('keeps the stored key when the entry for the address has no key', () => {
    const coin = evmCoin({
      address: ADDRESS_B,
      privateKey: KEY_A,
      deriveAddresses: [{address: ADDRESS_B, derivePath: "m/44'/60'/0'/0/1"}],
    });
    expect(getPrivateKeyForCoinAddress(coin)).toBe(KEY_A);
  });

  it('never swaps to an entry key that does not sign for the address', () => {
    const coin = evmCoin({
      address: ADDRESS_B,
      privateKey: KEY_A,
      deriveAddresses: [{address: ADDRESS_B, privateKey: KEY_C}],
    });
    expect(getPrivateKeyForCoinAddress(coin)).toBe(KEY_A);
  });

  it('keeps the stored key when the address is not in deriveAddresses', () => {
    const coin = evmCoin({
      address: ethers.computeAddress(KEY_C),
      privateKey: KEY_A,
    });
    expect(getPrivateKeyForCoinAddress(coin)).toBe(KEY_A);
  });

  it('keeps the stored key when the coin has no deriveAddresses', () => {
    const coin = evmCoin({
      address: ADDRESS_B,
      privateKey: KEY_A,
      deriveAddresses: undefined,
    });
    expect(getPrivateKeyForCoinAddress(coin)).toBe(KEY_A);
  });

  it('fills a missing stored key from the entry', () => {
    const coin = evmCoin({address: ADDRESS_B, privateKey: undefined});
    expect(getPrivateKeyForCoinAddress(coin)).toBe(KEY_B);
  });

  it('does not touch non-EVM chains', () => {
    const tron = {
      chain_name: 'tron',
      address: 'TAddressB',
      privateKey: 'keyA',
      deriveAddresses: [{address: 'TAddressB', privateKey: 'keyB'}],
    };
    expect(getPrivateKeyForCoinAddress(tron)).toBe('keyA');
  });
});
