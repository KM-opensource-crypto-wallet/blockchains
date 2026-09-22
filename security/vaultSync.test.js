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
  // `failSets`: how many upcoming writes of `failSetKey` should throw.
  const state = {failSetKey: null, failSets: 0};
  return {
    capabilities: {biometric: false},
    __items: items,
    __writes: writes,
    __state: state,
    __reset: () => {
      items.clear();
      writes.length = 0;
      state.failSetKey = null;
      state.failSets = 0;
    },
    get: async key => (items.has(key) ? items.get(key) : null),
    set: async (key, value) => {
      if (state.failSets > 0 && key === state.failSetKey) {
        state.failSets -= 1;
        throw new Error('secure store write failed');
      }
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

  it('stays silent while locked for secret-stripped wallets (pre-login housekeeping)', async () => {
    // What the store holds before login: persisted wallets with every secret
    // removed. Startup actions reorder / touch them constantly.
    const stripped = {
      clientId: 'x',
      walletName: 'Main',
      coins: [{chain_name: 'ethereum', symbol: 'ETH', address: '0xa'}],
      hideSettings: {isHidden: true, relockOption: 'RELAUNCH'},
    };
    store.dispatch(walletsStub.actions.setWallets([]));
    store.dispatch(walletsStub.actions.setWallets([stripped]));
    store.dispatch(walletsStub.actions.touchBalance());
    jest.advanceTimersByTime(500);
    await flushMicrotasks();
    await sync.flush();
    expect(onError).not.toHaveBeenCalled();
    expect(secureStore.__items.has('vault.blob')).toBe(false);
  });

  it('flush() writes a pending debounced change right away', async () => {
    await vault.createVault('pw');
    store.dispatch(walletsStub.actions.setWallets([walletB]));
    await sync.flush();
    expect(await vault.readSecrets()).toEqual(extractVaultPayload([walletB]));
  });

  const failNextBlobWrites = n => {
    secureStore.__state.failSetKey = 'vault.blob';
    secureStore.__state.failSets = n;
  };
  const saveErrors = () =>
    onError.mock.calls.filter(([, ctx]) => ctx?.tags?.op === 'save_secrets');
  // The write runs through the platform crypto adapter: node crypto settles
  // within microtasks, WebCrypto on real macrotasks (threadpool). Wait for the
  // reported failure instead of assuming one tick.
  const waitForSaveErrors = async n => {
    for (let i = 0; i < 1000 && saveErrors().length < n; i++) {
      await flushMicrotasks();
    }
  };

  it('a failed vault write stays dirty and is retried by the timer', async () => {
    await vault.createVault('pw');
    failNextBlobWrites(1);
    store.dispatch(createWalletFulfilled([walletA]));
    await waitForSaveErrors(1);

    expect(saveErrors()).toHaveLength(1);
    expect(await vault.readSecrets()).toEqual({v: 1, wallets: {}});

    jest.advanceTimersByTime(500); // first retry after one debounce window
    await flushMicrotasks();
    await sync.flush();
    expect(await vault.readSecrets()).toEqual(extractVaultPayload([walletA]));
    expect(saveErrors()).toHaveLength(1);
  });

  it('flush() retries a failed write instead of dropping it, and never rejects', async () => {
    await vault.createVault('pw');
    failNextBlobWrites(1);
    store.dispatch(createWalletFulfilled([walletA]));
    await waitForSaveErrors(1);
    expect(saveErrors()).toHaveLength(1);

    // e.g. app goes to background before the retry timer fires.
    await expect(sync.flush()).resolves.toBeUndefined();
    expect(await vault.readSecrets()).toEqual(extractVaultPayload([walletA]));

    // Once written, nothing is left dirty: no further write on the next flush.
    const writesAfter = blobWrites();
    jest.advanceTimersByTime(60000);
    await flushMicrotasks();
    await sync.flush();
    expect(blobWrites()).toBe(writesAfter);
  });

  it('retries back off and a newer change supersedes the failed snapshot', async () => {
    await vault.createVault('pw');
    failNextBlobWrites(2);
    store.dispatch(createWalletFulfilled([walletA]));
    await waitForSaveErrors(1);
    expect(saveErrors()).toHaveLength(1);

    jest.advanceTimersByTime(500); // retry #1 fails → next retry in 1000ms
    await waitForSaveErrors(2);
    expect(saveErrors()).toHaveLength(2);
    expect(saveErrors()[1][1].extra.retryInMs).toBe(1000);

    // A newer change arrives during the backoff: it carries walletA too, so
    // it replaces the dirty snapshot and goes out on the normal debounce.
    store.dispatch(walletsStub.actions.setWallets([walletA, walletB]));
    jest.advanceTimersByTime(500);
    await flushMicrotasks();
    await sync.flush();
    expect(await vault.readSecrets()).toEqual(
      extractVaultPayload([walletA, walletB]),
    );
    expect(saveErrors()).toHaveLength(2);

    // Nothing stale fires later.
    const writesAfter = blobWrites();
    jest.advanceTimersByTime(60000);
    await flushMicrotasks();
    expect(blobWrites()).toBe(writesAfter);
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

  it('a failed reset write is retried until the vault is really emptied', async () => {
    await vault.createVault('pw');
    store.dispatch(walletsStub.actions.setWallets([walletA]));
    await sync.flush();
    expect(await vault.readSecrets()).toEqual(extractVaultPayload([walletA]));

    failNextBlobWrites(1);
    store.dispatch(walletsStub.actions.resetWallet());
    await waitForSaveErrors(1);
    // Reported, and the old keys are still there for now…
    expect(await vault.readSecrets()).toEqual(extractVaultPayload([walletA]));

    // …until the retry (here via flush, e.g. going to background) lands.
    await sync.flush();
    expect(await vault.readSecrets()).toEqual({v: 1, wallets: {}});
    expect(saveErrors()).toHaveLength(1);
  });

  it('a write that fails after resetWallet is never retried over the emptied vault', async () => {
    await vault.createVault('pw');
    failNextBlobWrites(1);
    // The wallet write is in flight (will fail) when the reset comes in, so
    // the empty write is queued behind it. The stale snapshot must not be
    // restored and retried once the failure surfaces: that would put the old
    // wallets' keys back into a vault the user just reset.
    store.dispatch(createWalletFulfilled([walletA]));
    store.dispatch(walletsStub.actions.resetWallet());
    await waitForSaveErrors(1);
    await sync.flush();
    expect(await vault.readSecrets()).toEqual({v: 1, wallets: {}});

    jest.advanceTimersByTime(60000);
    await flushMicrotasks();
    await sync.flush();
    expect(await vault.readSecrets()).toEqual({v: 1, wallets: {}});
    expect(saveErrors()).toHaveLength(1);
  });

  it('a write that fails behind a newer immediate write is never retried over it', async () => {
    await vault.createVault('pw');
    failNextBlobWrites(1);
    store.dispatch(createWalletFulfilled([walletA]));
    store.dispatch(createWalletFulfilled([walletA, walletB]));
    await waitForSaveErrors(1);
    await sync.flush();
    expect(await vault.readSecrets()).toEqual(
      extractVaultPayload([walletA, walletB]),
    );

    jest.advanceTimersByTime(60000);
    await flushMicrotasks();
    await sync.flush();
    expect(await vault.readSecrets()).toEqual(
      extractVaultPayload([walletA, walletB]),
    );
    expect(saveErrors()).toHaveLength(1);
  });

  it('resetWallet while locked writes nothing and reports nothing', async () => {
    await vault.createVault('pw');
    vault.lock();
    const before = blobWrites();
    store.dispatch(walletsStub.actions.resetWallet());
    await flushMicrotasks();
    await sync.flush();
    expect(blobWrites()).toBe(before);
    expect(onError).not.toHaveBeenCalled();
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
