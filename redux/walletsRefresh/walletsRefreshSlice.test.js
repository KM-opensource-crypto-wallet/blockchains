import {combineReducers, configureStore} from '@reduxjs/toolkit';
import {getCoin} from 'dok-wallet-blockchain-networks/cryptoChain';
import {settingsSlice} from 'dok-wallet-blockchain-networks/redux/settings/settingsSlice';
import {walletsSlice} from 'dok-wallet-blockchain-networks/redux/wallets/walletsSlice';
import {
  refreshAllWalletsCoins,
  walletsRefreshSlice,
} from 'dok-wallet-blockchain-networks/redux/walletsRefresh/walletsRefreshSlice';
import {
  selectIsRefreshingAllWallets,
  selectRefreshingWalletClientId,
} from 'dok-wallet-blockchain-networks/redux/walletsRefresh/walletsRefreshSelectors';

// walletsSlice pulls in every chain implementation (and their native
// modules); each mock covers the surface it imports, not just what is
// asserted on here. Same set as redux/wallets/walletSlice.test.js.
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

describe('walletsRefreshSlice', () => {
  const mockCurrencies = [
    {
      _id: 'coin1',
      symbol: 'ETH',
      chain_name: 'ethereum',
      type: 'coin',
      decimal: 18,
      status: true,
    },
    {
      _id: 'coin2',
      symbol: 'MATIC',
      chain_name: 'polygon',
      type: 'coin',
      decimal: 18,
      status: true,
    },
  ];

  // Balances in smallest units; at decimal 18 they parse to '10.0'/'20.0'.
  const nativeCoins = {
    ethereum: {
      address: '0xEthAddress',
      privateKey: '0xEthPrivateKey',
      getBalance: () => Promise.resolve('10000000000000000000'),
    },
    polygon: {
      address: '0xPolygonAddress',
      privateKey: '0xPolygonPrivateKey',
      getBalance: () => Promise.resolve('20000000000000000000'),
    },
  };

  // isWalletHiddenAndLocked treats a missing walletName as hidden, so every
  // wallet here needs one to count as visible.
  const makeWallet = (clientId, extra = {}) => ({
    clientId,
    walletName: `Wallet ${clientId}`,
    phrase: `phrase ${clientId}`,
    coins: mockCurrencies.map(coin => ({...coin, isInWallet: true})),
    ...extra,
  });

  const makeStore = allWallets =>
    configureStore({
      reducer: combineReducers({
        wallets: walletsSlice.reducer,
        walletsRefresh: walletsRefreshSlice.reducer,
        settings: settingsSlice.reducer,
        // Read-only slices the refresh path consults.
        currency: (state = {currencies: mockCurrencies}) => state,
        customRpc: (state = {customRpcList: {}}) => state,
      }),
      preloadedState: {
        wallets: {allWallets, currentWalletClientId: allWallets[0]?.clientId},
        settings: {localCurrency: 'USD'},
      },
      // Coin snapshots carry non-serializable stubs.
      middleware: getDefaultMiddleware =>
        getDefaultMiddleware({
          serializableCheck: false,
          immutableCheck: false,
        }),
    });

  const refreshedAmounts = wallet => wallet.coins.map(coin => coin.totalAmount);
  const untouched = wallet =>
    wallet.coins.every(coin => coin.totalAmount === undefined);

  beforeEach(() => {
    getCoin.mockReset();
    getCoin.mockImplementation((phrase, coinDef) =>
      Promise.resolve(nativeCoins[coinDef?.chain_name]),
    );
  });

  it('starts idle and outside the persisted wallets slice', () => {
    const store = makeStore([makeWallet('client1')]);
    expect(selectIsRefreshingAllWallets(store.getState())).toBe(false);
    expect(selectRefreshingWalletClientId(store.getState())).toBeNull();
    expect(store.getState().wallets.isRefreshing).toBeUndefined();
  });

  it('refreshes every visible wallet one after another and skips hidden ones', async () => {
    const store = makeStore([
      makeWallet('client1'),
      makeWallet('hidden', {hideSettings: {isHidden: true}}),
      makeWallet('client2'),
    ]);
    // getCoin receives the wallet as its 4th argument; record which wallet
    // each balance call belonged to, and the loading state at that moment.
    const seen = [];
    getCoin.mockImplementation((phrase, coinDef, _cb, wallet) => {
      seen.push({
        clientId: wallet?.clientId,
        isRefreshing: selectIsRefreshingAllWallets(store.getState()),
        refreshingWalletClientId: selectRefreshingWalletClientId(
          store.getState(),
        ),
      });
      return Promise.resolve(nativeCoins[coinDef?.chain_name]);
    });

    const result = await store.dispatch(refreshAllWalletsCoins()).unwrap();

    expect(result).toEqual({total: 2, failed: 0});
    // Two coins per wallet, wallets strictly in order, never interleaved.
    expect(seen.map(s => s.clientId)).toEqual([
      'client1',
      'client1',
      'client2',
      'client2',
    ]);
    // Loading state pointed at the wallet being fetched the whole time.
    expect(seen.every(s => s.isRefreshing)).toBe(true);
    expect(seen.map(s => s.refreshingWalletClientId)).toEqual(
      seen.map(s => s.clientId),
    );

    const [first, hidden, second] = store.getState().wallets.allWallets;
    expect(refreshedAmounts(first)).toEqual(['10.0', '20.0']);
    expect(refreshedAmounts(second)).toEqual(['10.0', '20.0']);
    expect(untouched(hidden)).toBe(true);
    // Loading state is cleared once the run is over.
    expect(selectIsRefreshingAllWallets(store.getState())).toBe(false);
    expect(selectRefreshingWalletClientId(store.getState())).toBeNull();
  });

  it('keeps going after one wallet fails and reports the failure count', async () => {
    const store = makeStore([
      makeWallet('client1'),
      makeWallet('broken'),
      makeWallet('client2'),
    ]);
    getCoin.mockImplementation((phrase, coinDef) =>
      phrase === 'phrase broken'
        ? Promise.reject(new Error('rpc down'))
        : Promise.resolve(nativeCoins[coinDef?.chain_name]),
    );

    const result = await store.dispatch(refreshAllWalletsCoins()).unwrap();

    expect(result).toEqual({total: 3, failed: 1});
    const [first, broken, second] = store.getState().wallets.allWallets;
    expect(refreshedAmounts(first)).toEqual(['10.0', '20.0']);
    expect(untouched(broken)).toBe(true);
    expect(refreshedAmounts(second)).toEqual(['10.0', '20.0']);
    expect(selectIsRefreshingAllWallets(store.getState())).toBe(false);
    expect(selectRefreshingWalletClientId(store.getState())).toBeNull();
  });

  it('skips a wallet that disappeared while an earlier one was refreshing', async () => {
    const store = makeStore([makeWallet('client1'), makeWallet('client2')]);
    let deleted = false;
    getCoin.mockImplementation((phrase, coinDef, _cb, wallet) => {
      if (wallet?.clientId === 'client1' && !deleted) {
        // Simulate the user deleting the second wallet mid-run (once: the
        // reducer throws for an unknown wallet).
        deleted = true;
        store.dispatch(walletsSlice.actions.deleteWallet('client2'));
      }
      return Promise.resolve(nativeCoins[coinDef?.chain_name]);
    });

    const result = await store.dispatch(refreshAllWalletsCoins()).unwrap();

    expect(result).toEqual({total: 2, failed: 0});
    expect(
      getCoin.mock.calls.map(([, , , wallet]) => wallet?.clientId),
    ).toEqual(['client1', 'client1']);
  });

  it('ignores a second dispatch while a run is in flight', async () => {
    const store = makeStore([makeWallet('client1')]);

    const first = store.dispatch(refreshAllWalletsCoins());
    const second = await store.dispatch(refreshAllWalletsCoins());
    await first;

    // A thunk skipped by `condition` rejects with meta.condition = true.
    expect(second.meta.condition).toBe(true);
    // Each coin of the single wallet was fetched exactly once.
    expect(getCoin).toHaveBeenCalledTimes(2);
  });

  it('clears the loading state when the run is rejected', () => {
    const state = walletsRefreshSlice.reducer(
      {isRefreshing: true, refreshingWalletClientId: 'client1'},
      refreshAllWalletsCoins.rejected(new Error('boom'), 'req1'),
    );
    expect(state.isRefreshing).toBe(false);
    expect(state.refreshingWalletClientId).toBeNull();
  });
});
