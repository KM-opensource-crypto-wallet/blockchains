import {ethers} from 'ethers';
import {logger} from 'services/logger';
import {createWalletForChain} from 'dok-wallet-blockchain-networks/cryptoChain';

// The EVM chain implementation is irrelevant here: only the wallet resolved
// from the coin is under test.
jest.mock('dok-wallet-blockchain-networks/cryptoChain/chains/EVMChain', () => ({
  EVMChain: () => ({}),
}));
jest.mock('myWallet/wallet.service', () => ({createWallet: jest.fn()}));
jest.mock('services/logger', () => ({
  logger: {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}));

const KEY_A = `0x${'11'.repeat(32)}`;
const KEY_B = `0x${'22'.repeat(32)}`;
const ADDRESS_A = ethers.computeAddress(KEY_A);
const ADDRESS_B = ethers.computeAddress(KEY_B);

const arbitrumCoin = overrides => ({
  _id: 'arb-eth',
  chain_name: 'arbitrum',
  symbol: 'ETH',
  type: 'coin',
  deriveAddresses: [
    {address: ADDRESS_A, privateKey: KEY_A, derivePath: "m/44'/60'/0'/0/0"},
    {address: ADDRESS_B, privateKey: KEY_B, derivePath: "m/44'/60'/0'/0/1"},
  ],
  ...overrides,
});

describe('resolveWallet key/address pairing', () => {
  beforeEach(() => {
    logger.warn.mockClear();
  });

  it('signs with the key of the selected address when the stored key is for another one', async () => {
    const {wallet} = await createWalletForChain(
      null,
      arbitrumCoin({address: ADDRESS_B, privateKey: KEY_A}),
      {},
    );
    expect(wallet.address).toBe(ADDRESS_B);
    expect(wallet.privateKey).toBe(KEY_B);
    expect(new ethers.Wallet(wallet.privateKey).address).toBe(wallet.address);
  });

  it('reports a repaired coin once per session, without addresses', async () => {
    const coin = arbitrumCoin({
      symbol: 'USDC',
      type: 'token',
      address: ADDRESS_B,
      privateKey: KEY_A,
    });
    await createWalletForChain(null, coin, {});
    await createWalletForChain(null, coin, {});
    expect(logger.warn).toHaveBeenCalledTimes(1);
    expect(logger.warn).toHaveBeenCalledWith('coin.key_pair_repaired', {
      chain: 'arbitrum',
      symbol: 'USDC',
      is_token: true,
    });
  });

  it('leaves a consistent coin alone and logs nothing', async () => {
    const {wallet} = await createWalletForChain(
      null,
      arbitrumCoin({symbol: 'DAI', address: ADDRESS_A, privateKey: KEY_A}),
      {},
    );
    expect(wallet.privateKey).toBe(KEY_A);
    expect(logger.warn).not.toHaveBeenCalled();
  });
});
