import dayjs from 'dayjs';
import {combineReducers, configureStore} from '@reduxjs/toolkit';
import {
  walletsSlice,
  resetWallet,
} from 'dok-wallet-blockchain-networks/redux/wallets/walletsSlice';
import {
  schedulePaymentSlice,
  submitScheduledPayment,
} from 'dok-wallet-blockchain-networks/redux/schedulePayment/schedulePaymentSlice';
import {resolveRecipientAddress} from 'dok-wallet-blockchain-networks/helper/recipientAddress';
import {reconcileScheduledPaymentNotifications} from 'utils/scheduledPaymentNotifications';
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
}));

const WALLET = {
  clientId: 'c1',
  walletName: 'Main',
  phrase: 'x',
  coins: [],
};

const makeStore = () =>
  configureStore({
    reducer: combineReducers({
      wallets: walletsSlice.reducer,
      schedulePayment: schedulePaymentSlice.reducer,
      customRpc: (state = {customRpcList: {}}) => state,
    }),
    preloadedState: {
      wallets: {allWallets: [WALLET], currentWalletClientId: WALLET.clientId},
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
});
