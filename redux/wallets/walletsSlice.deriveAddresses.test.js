import {configureStore} from '@reduxjs/toolkit';
import {
  addEVMAndTronDeriveAddresses,
  walletsSlice,
} from 'dok-wallet-blockchain-networks/redux/wallets/walletsSlice';
import {selectDerivableWallets} from 'dok-wallet-blockchain-networks/redux/wallets/walletsSelector';
import {addDeriveAddresses} from 'myWallet/wallet.service';
import {showToast} from 'utils/toast';

// Same module mocks as walletsSlice.hydrateSecrets.test.js: the slice pulls
// every chain implementation in through cryptoChain and myWallet. The derive
// workers sit behind addDeriveAddresses; the toast is the user-visible output.
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
jest.mock('utils/toast', () => ({showToast: jest.fn(() => 'toast-1')}));

const PHRASE = 'abandon '.repeat(11) + 'about';

const mnemonicWallet = {
  clientId: 'w1',
  walletName: 'Main',
  phrase: PHRASE,
  coins: [],
  isEVMAddressesAdded: false,
};
const privateKeyWallet = {
  clientId: 'w2',
  walletName: 'Imported',
  privateKey: `0x${'9'.repeat(64)}`,
  isImportWalletWithPrivateKey: true,
  coins: [],
  isEVMAddressesAdded: false,
};

const makeStore = allWallets =>
  configureStore({
    reducer: {wallets: walletsSlice.reducer},
    preloadedState: {
      wallets: {
        ...walletsSlice.getInitialState(),
        allWallets,
        currentWalletClientId: allWallets[0].clientId,
      },
    },
    middleware: getDefaultMiddleware =>
      getDefaultMiddleware({serializableCheck: false, immutableCheck: false}),
  });

const switchOf = (store, clientId) =>
  store.getState().wallets.allWallets.find(w => w.clientId === clientId)
    .isEVMAddressesAdded;

beforeEach(() => {
  jest.clearAllMocks();
});

describe('selectDerivableWallets', () => {
  it('lists only visible wallets that have a recovery phrase', () => {
    const phraseLost = {...mnemonicWallet, clientId: 'w3', phrase: undefined};
    const state = {
      wallets: {allWallets: [mnemonicWallet, privateKeyWallet, phraseLost]},
    };
    expect(selectDerivableWallets(state).map(w => w.clientId)).toEqual(['w1']);
  });
});

describe('addEVMAndTronDeriveAddresses', () => {
  it('derives EVM, Tron and Solana addresses from the phrase', async () => {
    addDeriveAddresses.mockResolvedValue({deriveAddresses: []});
    const store = makeStore([mnemonicWallet]);

    const action = await store.dispatch(
      addEVMAndTronDeriveAddresses({clientId: 'w1', wallet: mnemonicWallet}),
    );

    expect(action.meta.requestStatus).toBe('fulfilled');
    expect(addDeriveAddresses.mock.calls).toEqual([
      ['ethereum', PHRASE],
      ['tron', PHRASE],
      ['solana', PHRASE],
    ]);
    expect(switchOf(store, 'w1')).toBe(true);
  });

  it('refuses a wallet without a recovery phrase before deriving anything', async () => {
    // DOKWALLET-WALLET-WEB-1R: the EVM worker received `undefined` and
    // ethers threw reading toLowerCase of it.
    const store = makeStore([privateKeyWallet]);

    const action = await store.dispatch(
      addEVMAndTronDeriveAddresses({clientId: 'w2', wallet: privateKeyWallet}),
    );

    expect(action.meta.requestStatus).toBe('rejected');
    expect(addDeriveAddresses).not.toHaveBeenCalled();
    expect(switchOf(store, 'w2')).toBe(false);
    expect(showToast).toHaveBeenCalledWith(
      expect.objectContaining({type: 'errorToast'}),
    );
  });

  it('turns the switch back off when deriving fails', async () => {
    addDeriveAddresses.mockRejectedValueOnce(new Error('worker error'));
    const store = makeStore([mnemonicWallet]);

    const action = await store.dispatch(
      addEVMAndTronDeriveAddresses({clientId: 'w1', wallet: mnemonicWallet}),
    );

    expect(action.meta.requestStatus).toBe('rejected');
    expect(switchOf(store, 'w1')).toBe(false);
  });

  it('leaves an already-enabled switch on when a repeat run fails', async () => {
    addDeriveAddresses.mockRejectedValueOnce(new Error('worker error'));
    const enabled = {...mnemonicWallet, isEVMAddressesAdded: true};
    const store = makeStore([enabled]);

    await store.dispatch(
      addEVMAndTronDeriveAddresses({clientId: 'w1', wallet: enabled}),
    );

    expect(switchOf(store, 'w1')).toBe(true);
  });
});
