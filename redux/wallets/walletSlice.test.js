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
import { getCoin } from 'dok-wallet-blockchain-networks/cryptoChain';
import { generateMnemonics as newWallet } from '../../service/wallet.service';
import thunk from 'redux-thunk';
import configureMockStore from 'redux-mock-store';
import * as dataModule from '../data/currency';
import { combineReducers, configureStore } from '@reduxjs/toolkit';
import { settingsSlice } from 'dok-wallet-blockchain-networks/redux/settings/settingsSlice';
import walletsSlice, {
  addToken,
  createWallet,
  refreshCoins,
  setCurrentCoin,
  setCurrentWalletIndex,
  addOrToggleCoinInWallet,
  updateWalletName,
} from 'dok-wallet-blockchain-networks/redux/wallets/walletsSlice';

// Mock the async functions
jest.mock('../../crypto', () => ({
  newWallet: jest.fn(),
  getCoin: jest.fn(),
}));

// Mock the module
jest.mock('../data/currency');

describe('walletsSlice tesets', () => {
  describe('wallets selectors', () => {
    const mockState = {
      wallets: {
        allWallets: [
          {
            id: 'wallet1',
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
        currentWalletIndex: 0,
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
              selectedCoin: null,
            },
            {
              id: 'wallet2',
            },
          ],
          currentWalletIndex: 0,
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
          coins: [
            { _id: 'a', isInWallet: true, isSupported: true, page: 'a' },
            { _id: 'b', isInWallet: false, isSupported: true, page: 'b' },
          ],
          selectedCoin: 'a',
        },
        {
          id: 'wallet2',
          coins: [
            { _id: 'a', isInWallet: true, isSupported: true, page: 'a' },
            { _id: 'b', isInWallet: false, isSupported: true, page: 'b' },
          ],
          selectedCoin: 'a',
        },
      ],
      currentWalletIndex: 0,
    };
    const walletsReducer = walletsSlice.reducer;

    it('should update wallet name', () => {
      let state = { ...initialState };
      const action = updateWalletName({ index: 0, walletName: 'new name' });
      const nextState = walletsReducer(state, action);
      expect(nextState.allWallets[0].walletName).toEqual('new name');
    });

    it('should set the current wallet by index.js', () => {
      let state = { ...initialState };
      const action = setCurrentWalletIndex(1);
      const nextState = walletsReducer(state, action);
      expect(nextState.currentWalletIndex).toEqual(1);
    });

    it('should throw exception if passing non number index.js', () => {
      let state = { ...initialState };
      const action = setCurrentWalletIndex('a');
      // const nextState = walletsReducer(state, action);
      expect(() => walletsReducer(state, action)).toThrow(
        'setCurrentWalletIndex: missing or invalid action payload: a',
      );
    });

    it('should throw exception if passing index.js of non existing wallet', () => {
      let state = { ...initialState };
      const action = setCurrentWalletIndex(25);
      // const nextState = walletsReducer(state, action);
      expect(() => walletsReducer(state, action)).toThrow(
        'setCurrentWalletIndex: missing or invalid action payload: 25',
      );
    });

    describe('toggleCoinInWallet', () => {
      it('toggleCoinInWallet toggles the isInWallet property of a coin', async () => {
        const state = { ...initialState };
        const action = await addOrToggleCoinInWallet({ _id: 'a' });
        const nextState = walletsSlice.reducer(state, action);
        console.log('next state', nextState);
        const foundCoin = nextState.allWallets[0].coins.find(
          item => item._id === 'a',
        );
        expect(foundCoin?.isInWallet).toBe(false);
      });
      it('toggleCoinInWallet toggles the isInWallet property of a coin back', () => {
        const state = { ...initialState };
        let action = addOrToggleCoinInWallet({ _id: 'a' });
        let nextState = walletsReducer(state, action);
        action = addOrToggleCoinInWallet({ _id: 'a' });
        nextState = walletsSlice.reducer(nextState, action);
        const foundCoin = nextState.allWallets[0].coins.find(
          item => item._id === 'a',
        );
        expect(foundCoin?.isInWallet).toBe(true);
      });
    });

    describe('setCurrentCoin', () => {
      it('setCurrentCoin sets the current coin of the current wallet', () => {
        const state = { ...initialState };
        const action = setCurrentCoin('a');
        const nextState = walletsReducer(state, action);
        expect(nextState.allWallets[0].selectedCoin).toEqual('a');
      });

      it('setCurrentCoin can set the current coin back', () => {
        const state = { ...initialState };
        let action = setCurrentCoin('b');
        let nextState = walletsReducer(state, action);
        action = setCurrentCoin('a');
        nextState = walletsReducer(nextState, action);
        expect(nextState.allWallets[0].selectedCoin).toEqual('a');
      });

      it('should throw exception if called without page', () => {
        const state = { ...initialState };
        let action = setCurrentCoin();
        expect(() => walletsReducer(state, action)).toThrowError(
          'Coin id does not exist',
        );
      });
    });
  });

  describe('wallets thunks', () => {
    // Define your mock data
    const mockCurrency = [
      {
        page: 'MockCoin',
        title: 'MCK',
        top: 'true',
        // ...other properties
      },
      {
        page: 'MockCoin2',
        title: 'MCK2',
        top: 'true',
        // ...other properties
      },
      {
        page: 'MockCoin3',
        title: 'MCK3',
        top: 'false',
        // ...other properties
      },
      // ...other mock coins
    ];

    // Use the mock data in your tests
    beforeEach(() => {
      dataModule.currency = mockCurrency;
    });

    const middlewares = [thunk];
    const mockStore = configureMockStore(middlewares);
    // const mockStore = configureStore({reducer: walletsSlice.reducer});
    it('creates a new wallet', async () => {
      // Mock the initial state
      const initialState = {
        wallets: {
          allWallets: [],
        },
        settings: {
          localCurrency: 'USD',
        },
      };

      // Mock the new wallet and coins
      const mockWallet = { mnemonic: { phrase: 'test phrase' } };
      const mockCoins = [
        {
          chain_name: 'MockCoin',
          id: 'coin1',
          status: true,
          address: '0x1234',
          privateKey: '0x1234567890',
        },
        {
          chain_name: 'MockCoin2',
          id: 'coin2',
          status: false,
          address: '0x4321',
          privateKey: '0x0987654321',
        },
        {
          chain_name: 'MockCoin3',
          id: 'coin3',
          status: false,
          address: '0x33333',
          privateKey: '0x33333333',
        },
      ];

      // Set up the mock functions to return the mock wallet and coins
      newWallet.mockResolvedValue(mockWallet);
      // getCoin.mockResolvedValue(mockCoins); // If getCoin returns the coins
      getCoin.mockImplementation((phrase, coinPage) => {
        return Promise.resolve({
          ...mockCoins.find(coin => {
            if (!coin.chain_name) {
              console.log(`Coin ${coin.id} has no page`);
            }
            return (
              coin.chain_name?.toLowerCase() ===
              coinPage.chain_name.toLowerCase()
            );
          }),
          phrase,
        });
      });

      // Create a mock store
      const store = mockStore(initialState);

      // Dispatch the thunk
      await store.dispatch(createWallet({ walletName: 'Test Wallet' }));

      // Get the actions dispatched by the store
      const actions = store.getActions();

      const fulfilled = actions.find(action =>
        action.type.endsWith('fulfilled'),
      );
      expect(fulfilled).toBeDefined();
      // Assert that the correct actions were dispatched
      expect(fulfilled.payload).toEqual({
        newStoreWallet: {
          id: '1',
          walletName: 'Main Wallet',
          coins: [
            {
              address: '0x1234',
              isInWallet: true,
              chain_name: 'MockCoin',
              phrase: 'test phrase',
              privateKey: '0x1234567890',
              title: 'MCK',
              top: 'true',
              totalAmount: 0,
              totalCourse: '0.00',
              currencyRate: '0.00',
              transactions: [],
            },
            {
              address: '0x4321',
              isInWallet: true,
              chain_name: 'MockCoin2',
              phrase: 'test phrase',
              privateKey: '0x0987654321',
              title: 'MCK2',
              top: 'true',
              totalAmount: 0,
              totalCourse: '0.00',
              currencyRate: '0.00',
              transactions: [],
            },
            {
              address: '0x33333',
              chain_name: 'MockCoin3',
              phrase: 'test phrase',
              privateKey: '0x33333333',
              title: 'MCK3',
              top: 'false',
              totalAmount: 0,
              totalCourse: '0.00',
              currencyRate: '0.00',
              transactions: [],
            },
          ],
          phrase: mockWallet.mnemonic.phrase,
        },
        replace: undefined,
      });
    });

    it('creates two new wallets', async () => {
      // Mock the initial state
      const initialState = {
        wallets: {
          allWallets: [],
        },
        settings: {
          localCurrency: 'USD',
        },
      };

      // Mock the new wallet and coins
      const mockWallet = { mnemonic: { phrase: 'test phrase' } };
      const mockCoins = [
        {
          page: 'MockCoin',
          id: 'coin1',
          top: 'true',
          address: '0x1234',
          privateKey: '0x1234567890',
        },
        {
          page: 'MockCoin2',
          id: 'coin2',
          top: 'false',
          address: '0x4321',
          privateKey: '0x0987654321',
        },
        {
          page: 'MockCoin3',
          id: 'coin3',
          top: 'false',
          address: '0x33333',
          privateKey: '0x33333333',
        },
      ];

      // Set up the mock functions to return the mock wallet and coins
      newWallet.mockResolvedValue(mockWallet);
      // getCoin.mockResolvedValue(mockCoins); // If getCoin returns the coins
      getCoin.mockImplementation((phrase, coinPage) => {
        return Promise.resolve({
          ...mockCoins.find(coin => {
            if (!coin.page) {
              console.log(`Coin ${coin.id} has no page`);
            }
            return coin.page?.toLowerCase() === coinPage;
          }),
          phrase,
        });
      });

      let dispatchedActions = [];

      const recordDispatchedActions = storeAPI => next => action => {
        dispatchedActions.push(action);
        return next(action);
      };

      const rootReducer = combineReducers({
        wallets: walletsSlice.reducer,
        settings: settingsSlice.reducer,
        // Include other slices here
      });

      const store = configureStore({
        reducer: rootReducer,
        preloadedState: initialState,
        middleware: getDefaultMiddleware =>
          getDefaultMiddleware().concat(recordDispatchedActions),
      });

      // Dispatch the thunk
      await store.dispatch(createWallet({ walletName: 'Test Wallet' }));

      await store.dispatch(createWallet({ walletName: 'Test Wallet' }));
      const state = store.getState();
      const wallets = state.wallets.allWallets;
      expect(wallets[1].walletName).toEqual('Wallet 2');
      expect(wallets[1].coins).toBeDefined();
    });

    it('creates should replace a wallet', async () => {
      // Mock the initial state
      const initialState = {
        wallets: {
          allWallets: [],
        },
        settings: {
          localCurrency: 'USD',
        },
      };

      // Mock the new wallet and coins
      const mockWallet = { mnemonic: { phrase: 'test phrase' } };
      const mockCoins = [
        {
          page: 'MockCoin',
          id: 'coin1',
          top: 'true',
          address: '0x1234',
          privateKey: '0x1234567890',
        },
        {
          page: 'MockCoin2',
          id: 'coin2',
          top: 'false',
          address: '0x4321',
          privateKey: '0x0987654321',
        },
        {
          page: 'MockCoin3',
          id: 'coin3',
          top: 'false',
          address: '0x33333',
          privateKey: '0x33333333',
        },
      ];

      // Set up the mock functions to return the mock wallet and coins
      newWallet.mockResolvedValue(mockWallet);
      // getCoin.mockResolvedValue(mockCoins); // If getCoin returns the coins
      getCoin.mockImplementation((phrase, coinPage) => {
        return Promise.resolve({
          ...mockCoins.find(coin => {
            if (!coin.page) {
              console.log(`Coin ${coin.id} has no page`);
            }
            return coin.page?.toLowerCase() === coinPage;
          }),
          phrase,
        });
      });

      let dispatchedActions = [];

      const recordDispatchedActions = storeAPI => next => action => {
        dispatchedActions.push(action);
        return next(action);
      };

      const rootReducer = combineReducers({
        wallets: walletsSlice.reducer,
        settings: settingsSlice.reducer,
        // Include other slices here
      });

      const store = configureStore({
        reducer: rootReducer,
        preloadedState: initialState,
        middleware: getDefaultMiddleware =>
          getDefaultMiddleware().concat(recordDispatchedActions),
      });

      // Dispatch the thunk
      await store.dispatch(createWallet({ walletName: 'Test Wallet' }));

      await store.dispatch(
        createWallet({
          walletName: 'Test Wallet',
          replace: true,
          phrase: 'new test phrase',
        }),
      );
      const state = store.getState();
      const wallets = state.wallets.allWallets;
      expect(wallets[0].walletName).toEqual('Main Wallet');
      expect(wallets[0].phrase).toEqual('new test phrase');
      expect(wallets[0].coins).toBeDefined();
    });

    it('test that refreshCoins refreshes the wallets coins', async () => {
      const mockCoins = [
        {
          page: 'a',
          id: 'coin1',
          top: 'true',
          address: '0x1234',
          privateKey: '0x1234567890',
          getBalance: () => Promise.resolve('10.0'),
        },
        {
          page: 'b',
          id: 'coin2',
          top: 'false',
          address: '0x4321',
          privateKey: '0x0987654321',
          getBalance: () => Promise.resolve('20.0'),
        },
      ];
      getCoin.mockImplementation((phrase, coinPage) => {
        return Promise.resolve({
          ...mockCoins.find(coin => {
            if (!coin.page) {
              console.log(`Coin ${coin.page} has no page`);
            }
            return coin.page?.toLowerCase() === coinPage?.page?.toLowerCase();
          }),
          phrase,
        });
      });

      const initialState = {
        wallets: {
          allWallets: [
            {
              coins: [
                { id: 'a', isInWallet: true, isSupported: true, page: 'A' },
                { id: 'b', isInWallet: false, isSupported: true, page: 'B' },
              ],
              selectedCoinIndex: 0,
            },
          ],
          currentWalletIndex: 0,
        },
        settings: {
          localCurrency: 'USD',
        },
      };

      let dispatchedActions = [];

      const recordDispatchedActions = storeAPI => next => action => {
        dispatchedActions.push(action);
        return next(action);
      };

      const rootReducer = combineReducers({
        wallets: walletsSlice.reducer,
        settings: settingsSlice.reducer,
        // Include other slices here
      });

      const store = configureStore({
        reducer: rootReducer,
        preloadedState: initialState,
        middleware: getDefaultMiddleware =>
          getDefaultMiddleware().concat(recordDispatchedActions),
      });

      // Dispatch the thunk
      await store.dispatch(refreshCoins());
      const state = store.getState();
      const wallet = state.wallets.allWallets[0];
      expect(wallet.coins[0].totalAmount).toEqual('10.0');
    });
    describe('wallets slice', () => {
      it('handles createWallet.fulfilled', async () => {
        const store = configureStore({ reducer: walletsSlice.reducer });

        // Mock the payload
        const mockWallet = {
          newStoreWallet: {
            id: '1',
            walletName: 'Test Wallet',
            coins: [
              { id: 1, name: 'Coin One', page: 'coin1' },
              { id: 2, name: 'Coin Two', page: 'coin2' },
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

        // Check that the currentWalletIndex was updated
        expect(state.currentWalletIndex).toEqual(0);
      });

      it('handles addToken.fulfilled', async () => {
        const preloadedState = {
          allWallets: [
            {
              id: '1',
              coins: [
                { id: 'a', isInWallet: true, isSupported: true },
                { id: 'b', isInWallet: false, isSupported: true },
              ],
              selectedCoinIndex: 0,
            },
            {
              id: '2',
              coins: [{ id: 'c', isInWallet: true, isSupported: true }],
              selectedCoinIndex: 0,
            },
          ],
          currentWalletIndex: 0, // Moved inside the preloadedState object
        };
        const store = configureStore({
          reducer: walletsSlice.reducer,
          preloadedState,
          currentWalletIndex: '1',
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
