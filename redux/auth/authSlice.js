import {createAsyncThunk, createSlice} from '@reduxjs/toolkit';
import {resetWallet} from '../wallets/walletsSlice';
import {resetCurrentTransferData} from '../currentTransfer/currentTransferSlice';
import {resetBatchTransactions} from '../batchTransaction/batchTransactionSlice';
import {syncScheduledPaymentNotifications} from '../schedulePayment/schedulePaymentSlice';
import {showToast} from 'utils/toast';

export const ATTEMPT_WINDOW_MS = 30 * 60 * 1000;

// A failure counts while it is inside the window. One stamped after `now`
// (the device clock was set back) never counts: it would otherwise stay
// "recent" until the clock caught up and could trigger the wipe.
export const isRecentAttempt = (timestamp, now) =>
  timestamp <= now && now - timestamp < ATTEMPT_WINDOW_MS;

export const handleAttempts = createAsyncThunk(
  'auth/handleAttempts',
  async (payload, thunkAPI) => {
    try {
      const currentState = thunkAPI.getState();
      const {
        auth: {attempts, maxAttempt},
      } = currentState;
      const threshold = maxAttempt - 1;
      // Only failures inside the 30-minute window count (the same window
      // recordFailureAttempts keeps). Counting stale ones let a single typo,
      // days after earlier failures, wipe every wallet.
      const now = Date.now();
      const failureCount = attempts.filter(timestamp =>
        isRecentAttempt(timestamp, now),
      ).length;
      const attemptsLeft = threshold - failureCount;

      const navigation = payload?.navigation;
      const router = payload?.router;

      if (attemptsLeft <= 0) {
        showToast({
          type: 'warningToast',
          title: 'Wallet Deleted',
          message: 'Too many failed login attempts',
        });
        thunkAPI.dispatch(resetAttempts());
        thunkAPI.dispatch(resetWallet());
        // resetWallet wiped every scheduled payment; cancel every pending
        // reminder that pointed at them.
        await thunkAPI.dispatch(syncScheduledPaymentNotifications());
        thunkAPI.dispatch(resetCurrentTransferData());
        thunkAPI.dispatch(resetBatchTransactions());
        thunkAPI.dispatch(logOutSuccess());
        if (navigation) {
          console.log('navigation reset');
          navigation?.reset({
            index: 0,
            routes: [{name: 'CarouselCards'}],
          });
        } else if (router) {
          router.replace('/');
        }
        thunkAPI.dispatch(loadingOff());
        return {successful_deleted: true};
      } else {
        if (attemptsLeft === 1) {
          thunkAPI.dispatch(setLastAttempt(true));
        }
        thunkAPI.dispatch(recordFailureAttempts());
        showToast({
          type: 'warningToast',
          title: 'Invalid password',
          message: `${attemptsLeft} Attempts left`,
        });
      }
      thunkAPI.dispatch(loadingOff());
    } catch (error) {
      console.error('Error While deleting the wallet: ', error);
      thunkAPI.dispatch(loadingOff());
    }
  },
);
const initialState = {
  isLogin: false,
  // Whether onboarding created an account. Routing reads this; the password
  // itself is never stored anywhere — "correct password" means the vault key
  // unwrapped (security/vault.js).
  hasAccount: false,
  // Set by the app after the vault unlocks (never persisted; see
  // AUTH_PERSIST_BLACKLIST). Gates work that needs key material (WalletConnect
  // init, signing) until the user has unlocked in this session.
  isVaultUnlocked: false,
  loading: false,
  error: null,
  fingerprintAuth: false,
  lastUpdateCheckTimestamp: null,
  attempts: [],
  maxAttempt: 5,
  lastAttempt: false,
};

export const authSlice = createSlice({
  name: 'auth',
  initialState: initialState,
  reducers: {
    signUpSuccess: state => {
      state.hasAccount = true;
      state.isLogin = true;
      state.loading = false;
    },
    logInSuccess: state => {
      // Self-heal for accounts persisted before `hasAccount` existed.
      state.hasAccount = true;
      state.isLogin = true;
      // Any successful login (password or biometric) clears failed attempts.
      state.attempts = [];
      state.lastAttempt = false;
    },
    changePasswordSuccess: state => {
      state.hasAccount = true;
      state.isLogin = true;
    },
    logOutSuccess: state => {
      state.isLogin = false;
      state.hasAccount = false;
      state.isVaultUnlocked = false;
    },
    vaultUnlocked: state => {
      state.isVaultUnlocked = true;
    },
    vaultLocked: state => {
      state.isVaultUnlocked = false;
    },
    fingerprintAuthSuccess: (state, action) => {
      state.fingerprintAuth = action.payload;
    },
    fingerprintAuthOut: state => {
      state.fingerprintAuth = false;
    },
    loadingOn: state => {
      state.loading = true;
    },
    loadingOff: state => {
      state.loading = false;
    },
    setLastUpdateCheckTimestamp(state, {payload}) {
      state.lastUpdateCheckTimestamp = payload;
    },
    recordFailureAttempts: state => {
      const now = Date.now();

      // Keep only recent attempts
      state.attempts = state.attempts.filter(timestamp =>
        isRecentAttempt(timestamp, now),
      );

      // Add new attempt
      state.attempts.push(now);

      // Lock if threshold reached
    },
    resetAttempts: state => {
      state.attempts = [];
      state.lastAttempt = false;
    },
    setLastAttempt: (state, {payload}) => {
      state.lastAttempt = payload;
    },
  },
  extraReducers: builder => {
    builder
      // when handleAttempts is triggered
      .addCase(handleAttempts.pending, state => {
        state.loading = true;
        state.error = null;
      })

      // when all logic inside handleAttempts finishes
      .addCase(handleAttempts.fulfilled, (state, action) => {
        state.loading = false;
      })

      // if thunk throws an error
      .addCase(handleAttempts.rejected, (state, action) => {
        state.loading = false;
        state.error = action.error?.message || 'Failed to handle attempts';
      });
  },
});

export const {
  signUpSuccess,
  logInSuccess,
  changePasswordSuccess,
  logOutSuccess,
  vaultUnlocked,
  vaultLocked,
  fingerprintAuthSuccess,
  fingerprintAuthOut,
  loadingOn,
  loadingOff,
  setLastUpdateCheckTimestamp,
  recordFailureAttempts,
  resetAttempts,
  setLastAttempt,
} = authSlice.actions;
