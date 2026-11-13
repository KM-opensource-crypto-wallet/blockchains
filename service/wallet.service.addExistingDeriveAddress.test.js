import {ethers} from 'ethers';
import {addExistingDeriveAddress} from 'dok-wallet-blockchain-networks/service/wallet.service';

jest.mock('dok-wallet-blockchain-networks/cryptoChain', () => ({
  getCoin: jest.fn(),
}));
jest.mock('dok-wallet-blockchain-networks/service/coinMarketCap', () => ({
  getPrice: jest.fn(() => Promise.resolve({})),
}));

const KEY_A = `0x${'11'.repeat(32)}`;
const KEY_B = `0x${'22'.repeat(32)}`;
const ADDRESS_A = ethers.computeAddress(KEY_A);
const ADDRESS_B = ethers.computeAddress(KEY_B);

const deriveAddresses = [
  {address: ADDRESS_A, privateKey: KEY_A, derivePath: "m/44'/60'/0'/0/0"},
  {address: ADDRESS_B, privateKey: KEY_B, derivePath: "m/44'/60'/0'/0/1"},
];

// The user picked derive address B on the parent coin.
const ethereumCoin = {
  _id: 'eth',
  type: 'coin',
  chain_name: 'ethereum',
  symbol: 'ETH',
  address: ADDRESS_B,
  privateKey: KEY_B,
  deriveAddresses,
};

// A freshly created coin resolves its key from chain_existing_coin / the
// default derivation: account A.
const freshCoin = overrides => ({
  chain_name: 'arbitrum',
  symbol: 'ETH',
  type: 'coin',
  address: ADDRESS_A,
  privateKey: KEY_A,
  ...overrides,
});

const expectConsistent = coin =>
  expect(new ethers.Wallet(coin.privateKey).address).toBe(coin.address);

describe('addExistingDeriveAddress', () => {
  it('gives a new EVM-chain coin the key of the Ethereum coin’s selected address', () => {
    const wallet = {coins: [ethereumCoin]};
    const result = addExistingDeriveAddress(wallet, freshCoin());
    expect(result.address).toBe(ADDRESS_B);
    expect(result.privateKey).toBe(KEY_B);
    expect(result.deriveAddresses).toBe(deriveAddresses);
    expectConsistent(result);
  });

  it('gives a new token the key of its native coin’s selected address', () => {
    const arbitrumNative = {
      ...ethereumCoin,
      _id: 'arb',
      chain_name: 'arbitrum',
    };
    const wallet = {coins: [ethereumCoin, arbitrumNative]};
    const token = freshCoin({
      type: 'token',
      symbol: 'USDC',
      contractAddress: '0xaf88d065e77c8cc2239327c5edb3a432268e5831',
    });
    const result = addExistingDeriveAddress(wallet, token);
    expect(result.address).toBe(ADDRESS_B);
    expect(result.privateKey).toBe(KEY_B);
    expectConsistent(result);
  });

  it('takes the derive entry key when the parent coin itself is mismatched', () => {
    const brokenParent = {...ethereumCoin, privateKey: KEY_A};
    const result = addExistingDeriveAddress(
      {coins: [brokenParent]},
      freshCoin(),
    );
    expect(result.privateKey).toBe(KEY_B);
    expectConsistent(result);
  });

  it('leaves the coin alone when the parent has no derive addresses', () => {
    const parent = {...ethereumCoin, deriveAddresses: undefined};
    const coin = freshCoin();
    const result = addExistingDeriveAddress({coins: [parent]}, coin);
    expect(result.address).toBe(ADDRESS_A);
    expect(result.privateKey).toBe(KEY_A);
  });
});
