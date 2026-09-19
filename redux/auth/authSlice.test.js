import {
  authSlice,
  changePasswordSuccess,
  logInSuccess,
  logOutSuccess,
  signUpSuccess,
  vaultLocked,
  vaultUnlocked,
} from 'dok-wallet-blockchain-networks/redux/auth/authSlice';
import {
  getHasAccount,
  getIsVaultUnlocked,
} from 'dok-wallet-blockchain-networks/redux/auth/authSelectors';

// authSlice imports walletsSlice for resetWallet, which drags in every chain
// implementation; keep those off the table exactly as walletSlice.test.js does.
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
// authSlice → schedulePaymentSlice → notifee (native). Only the names the
// slice imports are needed; none run in these reducer-level tests.
jest.mock('utils/scheduledPaymentNotifications', () => ({
  SCHEDULED_PAYMENT_NOTIFICATION_TYPE: 'scheduledPayment',
  MAX_PENDING_TRIGGER_NOTIFICATIONS: 50,
  requestLocalNotificationPermission: jest.fn(),
  collectPaymentsForReminders: jest.fn(() => []),
  getReminderSlotUsage: jest.fn(() => ({})),
  getPaymentIdsWithDisplayedReminders: jest.fn(async () => []),
  cancelDisplayedRemindersForPayment: jest.fn(),
  reconcileScheduledPaymentNotifications: jest.fn(),
  createScheduledPaymentNotification: jest.fn(),
}));

const reduce = (state, action) => authSlice.reducer(state, action);
const initial = authSlice.getInitialState();

describe('authSlice hasAccount', () => {
  it('starts with no account', () => {
    expect(initial.hasAccount).toBe(false);
    expect(getHasAccount({auth: initial})).toBe(false);
  });

  it('signUpSuccess sets hasAccount and never stores a password', () => {
    const state = reduce(initial, signUpSuccess('pw'));
    expect(state.hasAccount).toBe(true);
    expect(state.isLogin).toBe(true);
    expect('password' in state).toBe(false);
    expect(getHasAccount({auth: state})).toBe(true);
  });

  it('logIn/changePassword also mark hasAccount (self-heal for old state)', () => {
    expect(reduce(initial, logInSuccess('pw')).hasAccount).toBe(true);
    expect(reduce(initial, changePasswordSuccess('pw')).hasAccount).toBe(true);
  });

  it('logOutSuccess clears hasAccount', () => {
    const state = reduce(reduce(initial, signUpSuccess()), logOutSuccess());
    expect(state.hasAccount).toBe(false);
    expect(state.isLogin).toBe(false);
    expect(getHasAccount({auth: state})).toBe(false);
  });

  it('getHasAccount ignores a stray legacy password field', () => {
    // A stale `password` can only come from an un-migrated blob; the migrator
    // is what turns it into hasAccount. It must never make routing decisions.
    expect(getHasAccount({auth: {...initial, password: 'pw'}})).toBe(false);
  });

  it('tracks the in-session vault unlock flag and clears it on logout', () => {
    expect(getIsVaultUnlocked({auth: initial})).toBe(false);
    const unlocked = reduce(initial, vaultUnlocked());
    expect(getIsVaultUnlocked({auth: unlocked})).toBe(true);
    expect(getIsVaultUnlocked({auth: reduce(unlocked, vaultLocked())})).toBe(
      false,
    );
    expect(getIsVaultUnlocked({auth: reduce(unlocked, logOutSuccess())})).toBe(
      false,
    );
  });
});
