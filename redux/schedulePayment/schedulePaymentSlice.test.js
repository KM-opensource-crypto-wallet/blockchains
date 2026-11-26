import dayjs from 'dayjs';
import {combineReducers, configureStore} from '@reduxjs/toolkit';
import {
  walletsSlice,
  repairKnownBadContracts,
  resetWallet,
} from 'dok-wallet-blockchain-networks/redux/wallets/walletsSlice';
import {
  schedulePaymentSlice,
  addScheduledPayment,
  pruneExpiredScheduledPayments,
  submitScheduledPayment,
} from 'dok-wallet-blockchain-networks/redux/schedulePayment/schedulePaymentSlice';
import {resolveRecipientAddress} from 'dok-wallet-blockchain-networks/helper/recipientAddress';
import {
  getPaymentIdsWithDisplayedReminders,
  reconcileScheduledPaymentNotifications,
} from 'utils/scheduledPaymentNotifications';
import {REPEAT_TYPE, SCHEDULED_DATE_FORMAT} from 'utils/scheduleRecurrence';

// walletsSlice pulls in every chain implementation; keep them out (same
// mocks as walletSlice.test.js).
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

// The submit thunk awaits these; each is controlled per test.
jest.mock('dok-wallet-blockchain-networks/helper/recipientAddress', () => ({
  resolveRecipientAddress: jest.fn(),
}));
jest.mock('utils/scheduledPaymentNotifications', () => ({
  requestLocalNotificationPermission: jest.fn(() =>
    Promise.resolve({granted: true, blocked: false}),
  ),
  createScheduledPaymentNotification: jest.fn(() =>
    Promise.resolve({scheduled: true, blocked: false}),
  ),
  reconcileScheduledPaymentNotifications: jest.fn(() =>
    Promise.resolve({armedForInclude: 0, cancelled: 0}),
  ),
  getPaymentIdsWithDisplayedReminders: jest.fn(() =>
    Promise.resolve(new Set()),
  ),
}));

const WALLET = {
  clientId: 'c1',
  walletName: 'Main',
  phrase: 'x',
  coins: [],
};

const makeStore = (wallet = WALLET) =>
  configureStore({
    reducer: combineReducers({
      wallets: walletsSlice.reducer,
      schedulePayment: schedulePaymentSlice.reducer,
      customRpc: (state = {customRpcList: {}}) => state,
    }),
    preloadedState: {
      wallets: {allWallets: [wallet], currentWalletClientId: wallet.clientId},
    },
    middleware: getDefaultMiddleware =>
      getDefaultMiddleware({serializableCheck: false, immutableCheck: false}),
  });

const values = {
  toAddress: 'recipient',
  amount: '1',
  memo: '',
  scheduledDate: dayjs().add(1, 'day').format(SCHEDULED_DATE_FORMAT),
  repeatType: REPEAT_TYPE.NONE,
};

// A promise the test resolves by hand, to hold the thunk mid-flight.
const deferred = () => {
  let resolve;
  const promise = new Promise(r => {
    resolve = r;
  });
  return {promise, resolve};
};

describe('submitScheduledPayment', () => {
  beforeEach(() => {
    reconcileScheduledPaymentNotifications.mockClear();
  });

  it('persists the payment for the current wallet', async () => {
    resolveRecipientAddress.mockResolvedValue({resolvedAddress: 'recipient'});
    const store = makeStore();
    const result = await store.dispatch(submitScheduledPayment({values}));
    expect(result.type).toBe(submitScheduledPayment.fulfilled.type);
    const {schedulePayment} = store.getState();
    expect(schedulePayment.scheduledPayments.c1).toHaveLength(1);
    expect(schedulePayment.isSubmitting).toBe(false);
    expect(schedulePayment.pendingSubmitCount).toBe(0);
  });

  it('drops a submit that resetWallet overtook and cancels its reminder', async () => {
    const gate = deferred();
    resolveRecipientAddress.mockReturnValue(gate.promise);
    const store = makeStore();

    const pending = store.dispatch(submitScheduledPayment({values}));
    expect(store.getState().schedulePayment.isSubmitting).toBe(true);

    store.dispatch(resetWallet());
    expect(store.getState().schedulePayment).toMatchObject({
      scheduledPayments: {},
      isSubmitting: false,
      pendingSubmitCount: 0,
    });

    gate.resolve({resolvedAddress: 'recipient'});
    const result = await pending;
    expect(result.type).toBe(submitScheduledPayment.rejected.type);
    expect(result.payload).toEqual({type: 'walletGone'});
    expect(store.getState().schedulePayment).toMatchObject({
      scheduledPayments: {},
      isSubmitting: false,
      pendingSubmitCount: 0,
    });
    expect(reconcileScheduledPaymentNotifications).toHaveBeenCalledTimes(1);
  });

  it('stores the contract the coin has after a repair that ran mid-submit', async () => {
    const BAD = '0x1796F4516d6e70bfCC8CEF9d40251F590ff4810b';
    const USDT = '0xdAC17F958D2ee523a2206206994597C13D831ec7';
    const usdtWallet = {
      ...WALLET,
      selectedCoin: 'usdt',
      coins: [
        {
          _id: 'usdt',
          type: 'token',
          chain_name: 'ethereum',
          symbol: 'USDT',
          decimal: 6,
          contractAddress: BAD,
          address: '0xsender',
        },
      ],
    };
    const gate = deferred();
    resolveRecipientAddress.mockReturnValue(gate.promise);
    const store = makeStore(usdtWallet);

    const pending = store.dispatch(submitScheduledPayment({values}));
    // An unlock repairs the coin while the submit is still awaiting.
    store.dispatch(repairKnownBadContracts());
    gate.resolve({resolvedAddress: 'recipient'});
    const result = await pending;

    expect(result.type).toBe(submitScheduledPayment.fulfilled.type);
    const [payment] = store.getState().schedulePayment.scheduledPayments.c1;
    expect(payment.asset).toEqual({
      symbol: 'USDT',
      contractAddress: USDT,
      decimals: 6,
    });
  });
});

describe('pruneExpiredScheduledPayments', () => {
  // A one-time payment is "expired" from the instant its reminder fires, so
  // every one of these is the state the app is in the moment a reminder lands.
  const firedOneTime = {
    id: 'p-fired',
    chain: 'ethereum',
    asset: {symbol: 'ETH'},
    recipientAddress: 'recipient',
    amount: '1',
    scheduledAt: dayjs().subtract(5, 'minute').valueOf(),
    recurrence: {type: REPEAT_TYPE.NONE},
  };
  const upcomingOneTime = {
    ...firedOneTime,
    id: 'p-upcoming',
    scheduledAt: dayjs().add(1, 'day').valueOf(),
  };
  const staleOneTime = {
    ...firedOneTime,
    id: 'p-stale',
    scheduledAt: dayjs().subtract(31, 'day').valueOf(),
  };
  const runningSeries = {
    ...firedOneTime,
    id: 'p-series',
    scheduledAt: dayjs().subtract(1, 'day').valueOf(),
    recurrence: {type: REPEAT_TYPE.DAILY, interval: 1},
  };

  const storeWith = (...payments) => {
    const store = makeStore();
    payments.forEach(payment =>
      store.dispatch(
        addScheduledPayment({...payment, walletClientId: WALLET.clientId}),
      ),
    );
    return store;
  };

  const idsIn = store =>
    (store.getState().schedulePayment.scheduledPayments[WALLET.clientId] || [])
      .map(item => item.id)
      .sort();

  beforeEach(() => {
    reconcileScheduledPaymentNotifications.mockClear();
    getPaymentIdsWithDisplayedReminders.mockReset();
    getPaymentIdsWithDisplayedReminders.mockResolvedValue(new Set());
  });

  // The regression test for the reported bug: nothing in the tray, nothing in
  // keepIds, and the payment must still be there for the tap that follows.
  it('keeps a just-fired payment with an empty tray and no keepIds', async () => {
    const store = storeWith(firedOneTime, upcomingOneTime);
    await store.dispatch(pruneExpiredScheduledPayments());
    expect(idsIn(store)).toEqual(['p-fired', 'p-upcoming']);
    expect(reconcileScheduledPaymentNotifications).not.toHaveBeenCalled();
  });

  it('deletes a payment left untouched past the staleness cutoff', async () => {
    const store = storeWith(staleOneTime, firedOneTime, upcomingOneTime);
    await store.dispatch(pruneExpiredScheduledPayments());
    expect(idsIn(store)).toEqual(['p-fired', 'p-upcoming']);
    expect(reconcileScheduledPaymentNotifications).toHaveBeenCalledTimes(1);
  });

  it('keeps a stale payment whose reminder is somehow still displayed', async () => {
    getPaymentIdsWithDisplayedReminders.mockResolvedValue(new Set(['p-stale']));
    const store = storeWith(staleOneTime);
    await store.dispatch(pruneExpiredScheduledPayments());
    expect(idsIn(store)).toEqual(['p-stale']);
  });

  it('keeps a stale payment named in keepIds', async () => {
    const store = storeWith(staleOneTime);
    await store.dispatch(pruneExpiredScheduledPayments({keepIds: ['p-stale']}));
    expect(idsIn(store)).toEqual(['p-stale']);
  });

  // The tray is a secondary guard now, so losing it must not stop cleanup.
  it('still prunes stale payments when the tray cannot be read', async () => {
    getPaymentIdsWithDisplayedReminders.mockRejectedValue(
      new Error('no permission'),
    );
    const store = storeWith(staleOneTime, firedOneTime);
    await store.dispatch(pruneExpiredScheduledPayments());
    expect(idsIn(store)).toEqual(['p-fired']);
  });

  it('never touches an upcoming payment or a series mid-run', async () => {
    const store = storeWith(upcomingOneTime, runningSeries);
    await store.dispatch(pruneExpiredScheduledPayments());
    expect(idsIn(store)).toEqual(['p-series', 'p-upcoming']);
  });
});
