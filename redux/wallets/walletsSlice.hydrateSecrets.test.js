import {
  clearWalletSecrets,
  hydrateWalletSecrets,
  resetCoinsToDefaultAddressForPrivacyMode,
  walletsSlice,
} from 'dok-wallet-blockchain-networks/redux/wallets/walletsSlice';
import {
  assertNoSecrets,
  extractVaultPayload,
  stripAllWalletsSecrets,
} from 'dok-wallet-blockchain-networks/redux/wallets/walletSecrets';

// Same module mocks as walletSlice.test.js: the slice pulls every chain
// implementation in through cryptoChain and myWallet/wallet.service.
jest.mock('dok-wallet-blockchain-networks/cryptoChain', () => ({
  getChain: jest.fn(),
  getCoin: jest.fn(),
  getHashString: jest.fn(),
}));
jest.mock('myWallet/wallet.service', () => ({
  addCustomDeriveAddressToWallet: jest.fn(),
  addDeriveAddresses: jest.fn(),
  generateMnemonics: jest.fn(),
}));
jest.mock('dok-wallet-blockchain-networks/service/dokApi', () => ({
  fetchCoinByChainAPI: jest.fn(),
  fetchCurrenciesAPI: jest.fn(),
  registerUserAPI: jest.fn(() => Promise.resolve()),
  reportExchangeTransactionHash: jest.fn(),
}));
jest.mock('dok-wallet-blockchain-networks/service/coinMarketCap', () => ({
  getPrice: jest.fn(() => Promise.resolve({})),
}));

const HEX = i => `0x${String(i).padStart(2, '0').repeat(32)}`;

const wallets = [
  {
    clientId: 'w1',
    walletName: 'Main',
    phrase: 'abandon '.repeat(11) + 'about',
    coins: [
      {
        _id: 'c1',
        chain_name: 'ethereum',
        symbol: 'ETH',
        address: '0xa0',
        privateKey: HEX(1),
        deriveAddresses: [
          {address: '0xa0', derivePath: "m/44'/60'/0'/0/0", privateKey: HEX(1)},
          {address: '0xa1', derivePath: "m/44'/60'/0'/1/0", privateKey: HEX(2)},
        ],
      },
    ],
    chain_existing_coin: {ethereum: {address: '0xa0', privateKey: HEX(1)}},
  },
  {
    clientId: 'w2',
    walletName: 'Imported',
    privateKey: HEX(9),
    coins: [
      {
        _id: 'c2',
        chain_name: 'ethereum',
        symbol: 'ETH',
        address: '0xb0',
        privateKey: HEX(9),
      },
    ],
  },
];

describe('walletsSlice.hydrateWalletSecrets', () => {
  const reduce = (state, action) => walletsSlice.reducer(state, action);
  const stateWith = allWallets => ({
    ...walletsSlice.getInitialState(),
    allWallets,
    currentWalletClientId: 'w1',
  });

  it('restores stripped secrets from the vault payload', () => {
    const payload = extractVaultPayload(wallets);
    const stripped = stateWith(stripAllWalletsSecrets(wallets));
    expect(stripped.allWallets[0].phrase).toBeUndefined();

    const next = reduce(stripped, hydrateWalletSecrets(payload));

    expect(next.allWallets).toEqual(wallets);
    expect(next.currentWalletClientId).toBe('w1');
  });

  it('leaves in-memory values alone and never writes undefined', () => {
    const payload = extractVaultPayload([wallets[0]]);
    const inMemory = stateWith(stripAllWalletsSecrets(wallets));
    inMemory.allWallets[0].coins[0].deriveAddresses[1].privateKey = 'mine';

    const next = reduce(inMemory, hydrateWalletSecrets(payload));

    expect(next.allWallets[0].coins[0].deriveAddresses[1].privateKey).toBe(
      'mine',
    );
    expect(next.allWallets[0].coins[0].deriveAddresses[0].privateKey).toBe(
      HEX(1),
    );
    // w2 is not in the payload: same object, nothing added.
    expect(next.allWallets[1]).toBe(inMemory.allWallets[1]);
    expect('privateKey' in next.allWallets[1]).toBe(false);
  });

  it('is a no-op for a malformed payload', () => {
    const state = stateWith(stripAllWalletsSecrets(wallets));
    expect(reduce(state, hydrateWalletSecrets(undefined)).allWallets).toEqual(
      state.allWallets,
    );
  });

  it('clearWalletSecrets strips every secret in memory and hydrate restores them', () => {
    const state = stateWith(wallets);
    const locked = reduce(state, clearWalletSecrets());
    expect(() => assertNoSecrets(locked.allWallets)).not.toThrow();
    expect(locked.allWallets[0].walletName).toBe('Main');
    expect(locked.currentWalletClientId).toBe('w1');
    const restored = reduce(
      locked,
      hydrateWalletSecrets(extractVaultPayload(wallets)),
    );
    expect(restored.allWallets).toEqual(wallets);
  });

  describe('privacy mode vs the vault split', () => {
    // Wallet in privacy mode whose coin currently points at derive entry #1.
    const privacyWallet = () => ({
      ...wallets[0],
      privacyMode: true,
      coins: [
        {
          ...wallets[0].coins[0],
          address: '0xa1',
          privateKey: HEX(2),
        },
      ],
      chain_existing_coin: {ethereum: {address: '0xa1', privateKey: HEX(2)}},
    });

    it('after hydrate, the reset re-points address AND key to the default entry', () => {
      const payload = extractVaultPayload([privacyWallet()]);
      let state = stateWith(stripAllWalletsSecrets([privacyWallet()]));
      state = reduce(state, hydrateWalletSecrets(payload));
      state = reduce(state, resetCoinsToDefaultAddressForPrivacyMode());
      const coin = state.allWallets[0].coins[0];
      expect(coin.address).toBe('0xa0');
      expect(coin.privateKey).toBe(HEX(1));
      // extractChainExistingCoins never overwrites an existing chain entry
      // (pre-existing behaviour): it keeps the last pair, and that pair is
      // internally consistent (address 0xa1 with its own key).
      const existing = state.allWallets[0].chain_existing_coin.ethereum;
      expect([existing.address, existing.privateKey]).toEqual(['0xa1', HEX(2)]);
    });

    it('before hydrate (keys stripped), the reset leaves the coin alone so hydrate cannot mis-pair it', () => {
      const payload = extractVaultPayload([privacyWallet()]);
      let state = stateWith(stripAllWalletsSecrets([privacyWallet()]));
      state = reduce(state, resetCoinsToDefaultAddressForPrivacyMode());
      // Address untouched: still the selected entry, with no key yet.
      expect(state.allWallets[0].coins[0].address).toBe('0xa1');
      expect(state.allWallets[0].coins[0].privateKey).toBeUndefined();
      state = reduce(state, hydrateWalletSecrets(payload));
      const coin = state.allWallets[0].coins[0];
      // Consistent pair: the selected address with the selected key.
      expect(coin.address).toBe('0xa1');
      expect(coin.privateKey).toBe(HEX(2));
      // And the post-unlock reset now lands on the default pair.
      const after = reduce(state, resetCoinsToDefaultAddressForPrivacyMode())
        .allWallets[0].coins[0];
      expect([after.address, after.privateKey]).toEqual(['0xa0', HEX(1)]);
    });
  });
});
