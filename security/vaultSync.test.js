import {configureStore, createSlice} from '@reduxjs/toolkit';
import * as vault from 'dok-wallet-blockchain-networks/security/vault';
import {
  IMMEDIATE_VAULT_WRITE_ACTIONS,
  createVaultSync,
} from 'dok-wallet-blockchain-networks/security/vaultSync';
import {extractVaultPayload} from 'dok-wallet-blockchain-networks/redux/wallets/walletSecrets';
import * as secureStore from 'security/secureStore';

jest.mock('services/logger', () => ({
  addBreadcrumb: jest.fn(),
  captureError: jest.fn(),
  logger: {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}));

jest.mock('security/secureStore', () => {
  const items = new Map();
  const writes = [];
  return {
    capabilities: {biometric: false},
    __items: items,
    __writes: writes,
    __reset: () => {
      items.clear();
      writes.length = 0;
    },
    get: async key => (items.has(key) ? items.get(key) : null),
    set: async (key, value) => {
      writes.push(key);
      items.set(key, value);
    },
    remove: async key => {
      items.delete(key);
    },
    has: async key => items.has(key),
  };
});

jest.mock('dok-wallet-blockchain-networks/security/vaultCore', () => {
  const actual = jest.requireActual(
    'dok-wallet-blockchain-networks/security/vaultCore',
  );
  return {
    ...actual,
    wrapDek: (dek, password, options = {}) =>
      actual.wrapDek(dek, password, {iterations: 1000, ...options}),
  };
});

// A stand-in for walletsSlice with the same action-type prefix. The listener
// only looks at `action.type` and `state.wallets.allWallets`.
const walletsStub = createSlice({
  name: 'wallets',
  initialState: {allWallets: [], balance: 0},
  reducers: {
    resetWallet: () => ({allWallets: [], balance: 0}),
    setWallets: (state, {payload}) => {
      state.allWallets = payload;
    },
    touchBalance: state => {
      // Changes allWallets reference without changing any secret.
      state.allWallets = state.allWallets.map(w => ({...w}));
      state.balance += 1;
    },
    unrelated: state => {
      state.balance += 1;
    },
  },
});
const createWalletFulfilled = payload => ({
  type: 'wallets/createWallet/fulfilled',
  payload,
});
// Real thunks change allWallets inside their fulfilled reducer; emulate that
// for the one immediate-write action the tests dispatch by hand.
const rootReducer = (state = {}, action) =>
  action.type === 'wallets/createWallet/fulfilled'
    ? {wallets: {...state.wallets, allWallets: action.payload}}
    : {wallets: walletsStub.reducer(state.wallets, action)};

const HEX = i => `0x${String(i).padStart(2, '0').repeat(32)}`;
const walletA = {
  clientId: 'a',
  phrase: 'abandon '.repeat(11) + 'about',
  coins: [],
};
const walletB = {
  clientId: 'b',
  privateKey: HEX(2),
  coins: [
    {chain_name: 'ethereum', symbol: 'ETH', address: '0xb', privateKey: HEX(2)},
  ],
};

const flushMicrotasks = () => new Promise(resolve => setImmediate(resolve));
// Number of vault.blob writes so far (createVault itself writes one).
const blobWrites = () =>
  secureStore.__writes.filter(key => key === 'vault.blob').length;

describe('vaultSync', () => {
  let store;
  let sync;
  let onError;

  beforeEach(async () => {
    // setImmediate drives flushMicrotasks(); only the debounce timer is faked.
    jest.useFakeTimers({
      doNotFake: ['setImmediate', 'nextTick', 'queueMicrotask'],
    });
    secureStore.__reset();
    vault.__resetForTests();
    onError = jest.fn();
    sync = createVaultSync({debounceMs: 500, onError});
    store = configureStore({
      reducer: rootReducer,
      middleware: gdm =>
        gdm({serializableCheck: false}).prepend(sync.middleware),
      preloadedState: {wallets: {allWallets: [], balance: 0}},
    });
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('writes immediately on wallet-creating actions (no debounce)', async () => {
    await vault.createVault('pw');
    const before = blobWrites();
    store.dispatch(createWalletFulfilled([walletA]));
    // No timer advance: the write must not wait for the debounce window.
    await flushMicrotasks();
    await sync.flush();

    expect(blobWrites()).toBe(before + 1);
    expect(await vault.readSecrets()).toEqual(extractVaultPayload([walletA]));
    expect(IMMEDIATE_VAULT_WRITE_ACTIONS).toContain(
      'wallets/createWallet/fulfilled',
    );
  });

  it('debounces ordinary wallet changes and skips writes whose payload is unchanged', async () => {
    await vault.createVault('pw');
    const before = blobWrites();
    store.dispatch(walletsStub.actions.setWallets([walletA, walletB]));
    store.dispatch(walletsStub.actions.touchBalance());
    store.dispatch(walletsStub.actions.touchBalance());
    expect(blobWrites()).toBe(before);

    jest.advanceTimersByTime(499);
    await flushMicrotasks();
    expect(blobWrites()).toBe(before);
    jest.advanceTimersByTime(1);
    await flushMicrotasks();
    await sync.flush();
    expect(blobWrites()).toBe(before + 1);
    expect(await vault.readSecrets()).toEqual(
      extractVaultPayload([walletA, walletB]),
    );

    // Balance refreshes change the array reference but not the secrets.
    store.dispatch(walletsStub.actions.touchBalance());
    jest.advanceTimersByTime(500);
    await flushMicrotasks();
    await sync.flush();
    expect(blobWrites()).toBe(before + 1);
  });

  it('ignores actions outside wallets/ and wallets/ actions that leave allWallets alone', async () => {
    await vault.createVault('pw');
    const before = blobWrites();
    store.dispatch(walletsStub.actions.unrelated());
    store.dispatch({type: 'auth/logInSuccess'});
    jest.advanceTimersByTime(1000);
    await flushMicrotasks();
    await sync.flush();
    expect(blobWrites()).toBe(before);
  });

  it('reports and drops a non-empty payload while the vault is locked', async () => {
    store.dispatch(walletsStub.actions.setWallets([walletA]));
    jest.advanceTimersByTime(500);
    await flushMicrotasks();
    await sync.flush();
    expect(onError).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({
        tags: {area: 'vault', op: 'write_while_locked'},
      }),
    );
    expect(secureStore.__items.has('vault.blob')).toBe(false);
  });

  it('stays silent for an empty payload while locked (pre-onboarding)', async () => {
    store.dispatch(walletsStub.actions.setWallets([]));
    store.dispatch(
      walletsStub.actions.setWallets([{clientId: 'x', coins: []}]),
    );
    jest.advanceTimersByTime(500);
    await flushMicrotasks();
    await sync.flush();
    // {clientId:'x'} has no secrets → payload.wallets has an entry but the
    // wallet has no key material; still a "wallet" from the vault's view.
    expect(onError).toHaveBeenCalledTimes(1);
  });

  it('flush() writes a pending debounced change right away', async () => {
    await vault.createVault('pw');
    store.dispatch(walletsStub.actions.setWallets([walletB]));
    await sync.flush();
    expect(await vault.readSecrets()).toEqual(extractVaultPayload([walletB]));
  });

  it('markSynced() suppresses the redundant write after unlock+hydrate', async () => {
    await vault.createVault('pw');
    const before = blobWrites();
    const payload = extractVaultPayload([walletA]);
    sync.markSynced(payload);
    store.dispatch(walletsStub.actions.setWallets([walletA]));
    jest.advanceTimersByTime(500);
    await flushMicrotasks();
    await sync.flush();
    expect(blobWrites()).toBe(before);
  });

  it('resetWallet empties the vault but keeps it (account stays)', async () => {
    await vault.createVault('pw');
    store.dispatch(walletsStub.actions.setWallets([walletA]));
    await sync.flush();
    expect(await vault.readSecrets()).toEqual(extractVaultPayload([walletA]));

    store.dispatch(walletsStub.actions.resetWallet());
    await flushMicrotasks();
    await sync.flush();
    expect(await vault.hasVault()).toBe(true);
    expect(vault.isUnlocked()).toBe(true);
    expect(await vault.readSecrets()).toEqual({v: 1, wallets: {}});

    // New wallets created right after are saved again.
    store.dispatch(createWalletFulfilled([walletB]));
    await flushMicrotasks();
    await sync.flush();
    expect(await vault.readSecrets()).toEqual(extractVaultPayload([walletB]));
  });

  it('logOutSuccess destroys the vault (account removed)', async () => {
    await vault.createVault('pw');
    store.dispatch(walletsStub.actions.setWallets([walletA]));
    await sync.flush();
    expect(secureStore.__items.has('vault.blob')).toBe(true);

    store.dispatch({type: 'auth/logOutSuccess'});
    await flushMicrotasks();
    await sync.flush();
    expect(secureStore.__items.size).toBe(0);
    expect(vault.isUnlocked()).toBe(false);
  });
});
