import {
  selectAllWallets,
  selectCurrentWallet,
  selectCoinsForCurrentWallet,
  selectUserCoins,
  selectOtherCoins,
  selectCurrentCoin,
  countTotalAssets,
  selectAllWalletName,
} from 'dok-wallet-blockchain-networks/redux/wallets/walletsSelector';
import {getCoin} from 'dok-wallet-blockchain-networks/cryptoChain';
import {generateMnemonics as newWallet} from 'myWallet/wallet.service';
import {thunk} from 'redux-thunk';
import configureMockStore from 'redux-mock-store';
import {combineReducers, configureStore} from '@reduxjs/toolkit';
import {settingsSlice} from 'dok-wallet-blockchain-networks/redux/settings/settingsSlice';
import {
  walletsSlice,
  addToken,
  createWallet,
  refreshCoins,
  setCurrentCoin,
  setCurrentWalletClientId,
  addOrToggleCoinInWallet,
  updateWalletName,
} from 'dok-wallet-blockchain-networks/redux/wallets/walletsSlice';

// Mock the async functions. Both modules pull in every chain implementation
// (and their native modules), so each mock covers the full surface walletsSlice
// imports, not just what this file asserts on.
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

// Keep the thunks off the network: createWallet registers the new wallet and
// refreshCoins prices the coins, neither of which is under test here.
jest.mock('dok-wallet-blockchain-networks/service/dokApi', () => ({
  fetchCoinByChainAPI: jest.fn(),
  fetchCurrenciesAPI: jest.fn(),
  registerUserAPI: jest.fn(() => Promise.resolve()),
  reportExchangeTransactionHash: jest.fn(),
}));

jest.mock('dok-wallet-blockchain-networks/service/coinMarketCap', () => ({
  getPrice: jest.fn(() => Promise.resolve({})),
}));

describe('walletsSlice tesets', () => {
  describe('wallets selectors', () => {
    const mockState = {
      wallets: {
        allWallets: [
          {
            id: 'wallet1',
            clientId: 'client1',
            walletName: 'Main Wallet',
            coins: [
              {
                id: 'a',
                isInWallet: true,
                isSupported: true,
                page: 'a',
                totalCourse: 20,
              },
              {
                id: 'b',
                isInWallet: false,
                isSupported: true,
                page: 'b',
                totalCourse: 10,
              },
            ],
            selectedCoinIndex: 0,
          },
          {
            id: 'wallet2',
            clientId: 'client2',
            walletName: 'testWallet',
            coins: [
              {
                id: 'c',
                isInWallet: true,
                isSupported: true,
                page: 'c',
                totalCourse: 20,
              },
            ],
            selectedCoinIndex: null,
          },
        ],
        currentWalletClientId: 'client1',
      },
    };

    // Similar tests for the other "selectWallet..." selectors...

    it('selectCurrentWallet returns the current wallet', () => {
      const result = selectCurrentWallet(mockState);
      expect(result).toEqual(mockState.wallets.allWallets[0]);
    });

    it('countTotalAssets returns the tot', () => {
      const result = countTotalAssets(mockState);
      expect(result).toEqual('20.00');
    });

    it('selectAllWalletName returns the alls wallet names in array', () => {
      const result = selectAllWalletName(mockState);
      expect(result).toEqual(['Main Wallet', 'testWallet']);
    });

    it('selectCoinsForCurrentWallet returns all coins for the current wallet', () => {
      const result = selectCoinsForCurrentWallet(mockState);
      expect(result).toEqual([
        {
          id: 'a',
          isInWallet: true,
          isSupported: true,
          page: 'a',
          totalCourse: 20,
        },
        {
          id: 'b',
          isInWallet: false,
          isSupported: true,
          page: 'b',
          totalCourse: 10,
        },
      ]);
    });

    it('selectUserCoins returns coins in the wallet', () => {
      const result = selectUserCoins(mockState);
      expect(result).toEqual([
        {
          id: 'a',
          isInWallet: true,
          isSupported: true,
          page: 'a',
          totalCourse: 20,
        },
      ]);
    });

    it('selectOtherCoins returns supported coins not in the wallet', () => {
      const result = selectOtherCoins(mockState);
      expect(result).toEqual([
        {
          id: 'b',
          isInWallet: false,
          isSupported: true,
          page: 'b',
          totalCourse: 10,
        },
      ]);
    });

    it('selectCurrentCoin returns the current coin', () => {
      const result = selectCurrentCoin(mockState);
      expect(result).toEqual({
        id: 'a',
        isInWallet: true,
        isSupported: true,
        page: 'a',
        totalCourse: 20,
      });
    });

    it('selectCurrentCoin should return null if coins are not initiazlied, even if currentCoinId is set', () => {
      const mockState = {
        wallets: {
          allWallets: [
            {
              id: 'wallet1',
              clientId: 'client1',
              selectedCoin: null,
            },
            {
              id: 'wallet2',
              clientId: 'client2',
            },
          ],
          currentWalletClientId: 'client1',
        },
      };
      const result = selectCurrentCoin(mockState);
      expect(result).toEqual(null);
    });

    it('selectAllWallets should return all wallets', () => {
      const result = selectAllWallets(mockState);
      const expected = mockState.wallets.allWallets;
      expect(result).toEqual(expected);
    });
  });

  describe('wallets reducer', () => {
    const initialState = {
      allWallets: [
        {
          id: 'wallet1',
          clientId: 'client1',
          coins: [
            {_id: 'a', isInWallet: true, isSupported: true, page: 'a'},
            {_id: 'b', isInWallet: false, isSupported: true, page: 'b'},
          ],
          selectedCoin: 'a',
        },
        {
          id: 'wallet2',
          clientId: 'client2',
          coins: [
            {_id: 'a', isInWallet: true, isSupported: true, page: 'a'},
            {_id: 'b', isInWallet: false, isSupported: true, page: 'b'},
          ],
          selectedCoin: 'a',
        },
      ],
      currentWalletClientId: 'client1',
    };
    const walletsReducer = walletsSlice.reducer;

    it('should update wallet name', () => {
      let state = {...initialState};
      const action = updateWalletName({
        clientId: 'client1',
        walletName: 'new name',
      });
      const nextState = walletsReducer(state, action);
      expect(nextState.allWallets[0].walletName).toEqual('new name');
    });

    it('should set the current wallet by clientId', () => {
      let state = {...initialState};
      const action = setCurrentWalletClientId('client2');
      const nextState = walletsReducer(state, action);
      expect(nextState.currentWalletClientId).toEqual('client2');
    });

    it('should throw exception if passing missing clientId', () => {
      let state = {...initialState};
      const action = setCurrentWalletClientId(undefined);
      expect(() => walletsReducer(state, action)).toThrow(
        'setCurrentWalletClientId: missing or invalid action payload: undefined',
      );
    });

    it('should throw exception if passing clientId of non existing wallet', () => {
      let state = {...initialState};
      const action = setCurrentWalletClientId('unknown');
      expect(() => walletsReducer(state, action)).toThrow(
        'setCurrentWalletClientId: missing or invalid action payload: unknown',
      );
    });

    describe('toggleCoinInWallet', () => {
      // Toggling is no longer a sync reducer: addOrToggleCoinInWallet is an
      // async thunk and the flip happens in its fulfilled case, which receives
      // {newCoin, existingCoinId}. An already-present coin yields newCoin=null.
      const toggle = coinId =>
        addOrToggleCoinInWallet.fulfilled(
          {newCoin: null, existingCoinId: coinId},
          'requestId',
          {_id: coinId},
        );

      it('toggleCoinInWallet toggles the isInWallet property of a coin', () => {
        const state = {...initialState};
        const nextState = walletsReducer(state, toggle('a'));
        const foundCoin = nextState.allWallets[0].coins.find(
          item => item._id === 'a',
        );
        expect(foundCoin?.isInWallet).toBe(false);
      });
      it('toggleCoinInWallet toggles the isInWallet property of a coin back', () => {
        const state = {...initialState};
        let nextState = walletsReducer(state, toggle('a'));
        nextState = walletsReducer(nextState, toggle('a'));
        const foundCoin = nextState.allWallets[0].coins.find(
          item => item._id === 'a',
        );
        expect(foundCoin?.isInWallet).toBe(true);
      });
    });

    describe('setCurrentCoin', () => {
      it('setCurrentCoin sets the current coin of the current wallet', () => {
        const state = {...initialState};
        const action = setCurrentCoin('a');
        const nextState = walletsReducer(state, action);
        expect(nextState.allWallets[0].selectedCoin).toEqual('a');
      });

      it('setCurrentCoin can set the current coin back', () => {
        const state = {...initialState};
        let action = setCurrentCoin('b');
        let nextState = walletsReducer(state, action);
        action = setCurrentCoin('a');
        nextState = walletsReducer(nextState, action);
        expect(nextState.allWallets[0].selectedCoin).toEqual('a');
      });

      it('should throw exception if called without page', () => {
        const state = {...initialState};
        let action = setCurrentCoin();
        expect(() => walletsReducer(state, action)).toThrowError(
          'Coin id does not exist',
        );
      });
    });
  });

  describe('wallets thunks', () => {
    // Coin definitions now come from the currency slice
    // (state.currency.currencies) rather than the data/currency module, and are
    // keyed by chain_name/symbol instead of the old `page` field. Only
    // status: true entries are active, so solana below is deliberately excluded.
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
      {
        _id: 'coin3',
        symbol: 'SOL',
        chain_name: 'solana',
        type: 'coin',
        decimal: 9,
        status: false,
      },
    ];

    // Native-coin stubs handed back by the mocked cryptoChain.getCoin. Balances
    // are in smallest units; at decimal 18 they parse to '10.0' and '20.0'.
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
      solana: {
        address: 'SolAddress',
        privateKey: 'SolPrivateKey',
        getBalance: () => Promise.resolve('30'),
      },
    };

    // Slices these thunks read but never write.
    const readOnlySlices = {
      currency: (state = {currencies: mockCurrencies}) => state,
      cryptoProvider: (state = {is_max_wallet_limit_reached: false}) => state,
      customRpc: (state = {customRpcList: {}}) => state,
    };

    const baseState = {
      wallets: {allWallets: []},
      settings: {localCurrency: 'USD'},
      currency: {currencies: mockCurrencies},
      cryptoProvider: {is_max_wallet_limit_reached: false},
      customRpc: {customRpcList: {}},
    };

    const makeStore = preloadedState =>
      configureStore({
        reducer: combineReducers({
          wallets: walletsSlice.reducer,
          settings: settingsSlice.reducer,
          ...readOnlySlices,
        }),
        preloadedState,
        // Coin snapshots carry non-serializable stubs; the checks add noise
        // without telling us anything about the thunks under test.
        middleware: getDefaultMiddleware =>
          getDefaultMiddleware({
            serializableCheck: false,
            immutableCheck: false,
          }),
      });

    beforeEach(() => {
      newWallet.mockResolvedValue({mnemonic: {phrase: 'test phrase'}});
      getCoin.mockImplementation((phrase, coinDef) =>
        Promise.resolve(nativeCoins[coinDef?.chain_name]),
      );
    });

    it('creates a new wallet', async () => {
      const middlewares = [thunk];
      const mockStore = configureMockStore(middlewares);
      const store = mockStore(baseState);

      await store.dispatch(createWallet({walletName: 'Test Wallet'}));

      const fulfilled = store
        .getActions()
        .find(action => action.type.endsWith('fulfilled'));
      expect(fulfilled).toBeDefined();

      const {newStoreWallet} = fulfilled.payload;
      expect(newStoreWallet.walletName).toEqual('Test Wallet');
      expect(newStoreWallet.id).toEqual('1');
      expect(newStoreWallet.clientId).toEqual(expect.any(String));
      expect(newStoreWallet.phrase).toEqual('test phrase');
      // Generated in-app, so it can skip the legacy bitcoin derivation scan.
      expect(newStoreWallet.isLegacyFree).toBe(true);
      expect(fulfilled.payload.isFromImportWallet).toBe(false);

      // Only the two active currencies become coins, each carrying the address
      // and key from its chain and flagged as in-wallet.
      expect(newStoreWallet.coins.map(coin => coin.chain_name)).toEqual([
        'ethereum',
        'polygon',
      ]);
      expect(newStoreWallet.coins.map(coin => coin.address)).toEqual([
        '0xEthAddress',
        '0xPolygonAddress',
      ]);
      expect(newStoreWallet.coins.every(coin => coin.isInWallet)).toBe(true);
    });

    it('creates two new wallets', async () => {
      const store = makeStore(baseState);

      await store.dispatch(createWallet({walletName: 'Test Wallet'}));
      await store.dispatch(createWallet({walletName: 'Test Wallet'}));

      const wallets = store.getState().wallets.allWallets;
      expect(wallets).toHaveLength(2);
      // The requested name is taken, so the second wallet is auto-renamed.
      expect(wallets[0].walletName).toEqual('Test Wallet');
      expect(wallets[1].walletName).toEqual('Wallet 2');
      expect(wallets[1].coins).toBeDefined();
      // Each wallet gets its own clientId, and the newest becomes current.
      expect(wallets[0].clientId).not.toEqual(wallets[1].clientId);
      expect(store.getState().wallets.currentWalletClientId).toEqual(
        wallets[1].clientId,
      );
    });

    it('creates should replace a wallet', async () => {
      const store = makeStore(baseState);

      await store.dispatch(createWallet({walletName: 'Test Wallet'}));
      await store.dispatch(
        createWallet({
          walletName: 'Test Wallet',
          replace: true,
          phrase: 'new test phrase',
        }),
      );

      const wallets = store.getState().wallets.allWallets;
      // replace collapses the list to the single new wallet, and skips the
      // auto-rename branch entirely, so the requested name survives as-is.
      expect(wallets).toHaveLength(1);
      expect(wallets[0].walletName).toEqual('Test Wallet');
      expect(wallets[0].phrase).toEqual('new test phrase');
      expect(wallets[0].coins).toBeDefined();
      // An imported phrase must still be scanned for legacy bitcoin usage.
      expect(wallets[0].isLegacyFree).toBe(false);
    });

    it('test that refreshCoins refreshes the wallets coins', async () => {
      const store = makeStore({
        ...baseState,
        wallets: {
          allWallets: [
            {
              clientId: 'client1',
              phrase: 'test phrase',
              coins: mockCurrencies
                .slice(0, 2)
                .map(coin => ({...coin, isInWallet: true})),
            },
          ],
          currentWalletClientId: 'client1',
        },
      });

      await store.dispatch(refreshCoins());

      const wallet = store.getState().wallets.allWallets[0];
      expect(wallet.coins.map(coin => coin.totalAmount)).toEqual([
        '10.0',
        '20.0',
      ]);
      expect(wallet.coins.map(coin => coin.address)).toEqual([
        '0xEthAddress',
        '0xPolygonAddress',
      ]);
    });
    describe('wallets slice', () => {
      it('handles createWallet.fulfilled', async () => {
        const store = configureStore({reducer: walletsSlice.reducer});

        // Mock the payload
        const mockWallet = {
          newStoreWallet: {
            id: '1',
            clientId: 'client1',
            walletName: 'Test Wallet',
            coins: [
              {id: 1, name: 'Coin One', page: 'coin1'},
              {id: 2, name: 'Coin Two', page: 'coin2'},
            ],
          },
          replace: false,
        };

        // Dispatch the action
        await store.dispatch(createWallet.fulfilled(mockWallet));

        // Check the state
        const state = store.getState();
        // Get the ids array by mapping the coins array to their page values
        const allWallets = state?.allWallets;
        const foundWallet = allWallets.find(
          item => item.id === mockWallet.newStoreWallet.id,
        );
        expect(foundWallet).toEqual(mockWallet.newStoreWallet);

        // Check that the current wallet pointer was updated
        expect(state.currentWalletClientId).toEqual(
          mockWallet.newStoreWallet.clientId,
        );
      });

      it('handles addToken.fulfilled', async () => {
        const preloadedState = {
          allWallets: [
            {
              id: '1',
              clientId: 'client1',
              coins: [
                {id: 'a', isInWallet: true, isSupported: true},
                {id: 'b', isInWallet: false, isSupported: true},
              ],
              selectedCoinIndex: 0,
            },
            {
              id: '2',
              clientId: 'client2',
              coins: [{id: 'c', isInWallet: true, isSupported: true}],
              selectedCoinIndex: 0,
            },
          ],
          currentWalletClientId: 'client1',
        };
        const store = configureStore({
          reducer: walletsSlice.reducer,
          preloadedState,
        });

        let st = store.getState();
        console.log('st', st);
        // Mock the payload
        const payload = {
          page: 'MockCoin',
          title: 'Mock Coin',
        };

        // Dispatch the action
        const res = store.dispatch(addToken.fulfilled(payload));

        // Check the state
        const state = store.getState();
        expect(state.allWallets[0]?.coins[2]?.page?.toLowerCase()).toEqual(
          'mockcoin',
        );
        expect(state.allWallets[0]?.coins[2]?.page).toEqual('MockCoin');
      });
    });
  });
});
