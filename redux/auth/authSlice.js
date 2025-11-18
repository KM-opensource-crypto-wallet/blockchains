import {createAsyncThunk, createSlice} from '@reduxjs/toolkit';
import {resetWallet} from '../wallets/walletsSlice';
import {resetCurrentTransferData} from '../currentTransfer/currentTransferSlice';
import {resetBatchTransactions} from '../batchTransaction/batchTransactionSlice';
import {showToast} from 'utils/toast';

export const handleAttempts = createAsyncThunk(
  'auth/handleAttempts',
  async (payload, thunkAPI) => {
    try {
      const currentState = thunkAPI.getState();
      const {
        auth: {attempts, maxAttempt, isLocked},
      } = currentState;
      const threshold = maxAttempt - 1;
      const failureCount = attempts.length;
      const attemptsLeft = maxAttempt - failureCount;

      const navigation = payload?.navigation;
      const router = payload?.router;

      if (failureCount >= threshold) {
        if (attemptsLeft === 1) {
          thunkAPI.dispatch(setLastAttempt(true));
        } else if (attemptsLeft <= 0 && isLocked) {
          showToast({
            type: 'warningToast',
            title: 'Wallet Deleted',
            message: 'Too many failed login attempts',
          });
          thunkAPI.dispatch(resetAttempts());
          thunkAPI.dispatch(resetWallet());
          thunkAPI.dispatch(resetCurrentTransferData());
          thunkAPI.dispatch(resetBatchTransactions());
          thunkAPI.dispatch(logOutSuccess());
          if (navigation) {
            navigation?.reset({
              index: 0,
              routes: [{name: 'CarouselCards'}],
            });
          } else if (router) {
            router.replace('/');
          }
          thunkAPI.dispatch(loadingOff());
        }
      }
      showToast({
        type: 'warningToast',
        title: 'Invalid password',
        message: `${attemptsLeft} Attempts left`,
      });
      thunkAPI.dispatch(recordFailureAttempts());
      thunkAPI.dispatch(loadingOff());
    } catch (error) {
      console.error('Error While deleting the wallet: ', error);
      thunkAPI.dispatch(loadingOff());
    }
  },
);
const initialState = {
  isLogin: false,
  password: '',
  loading: false,
  error: null,
  fingerprintAuth: false,
  lastUpdateCheckTimestamp: null,
  attempts: [],
  maxAttempt: 5,
  isLocked: false,
  lastAttempt: false,
};

export const authSlice = createSlice({
  name: 'auth',
  initialState: initialState,
  reducers: {
    signUpSuccess: (state, action) => {
      state.password = action.payload;
      state.isLogin = true;
      state.loading = false;
    },
    logInSuccess: (state, action) => {
      state.password = action.payload;
      state.isLogin = true;
    },
    changePasswordSuccess: (state, action) => {
      state.password = action.payload;
      state.isLogin = true;
    },
    logOutSuccess: state => {
      state.isLogin = false;
      state.password = '';
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
      const maxAttempts = 5;
      const windowMs = 5 * 60 * 1000; // 5 minute
      const now = Date.now();

      // Keep only recent attempts
      state.attempts = state.attempts.filter(
        timestamp => now - timestamp < windowMs,
      );

      // Add new attempt
      state.attempts.push(now);

      // Lock if threshold reached
      state.isLocked = state.attempts.length >= maxAttempts;
    },
    resetAttempts: state => {
      state.attempts = [];
      state.isLocked = false;
    },
    setLastAttempt: (state, payload) => {
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
  fingerprintAuthSuccess,
  fingerprintAuthOut,
  loadingOn,
  loadingOff,
  setLastUpdateCheckTimestamp,
  recordFailureAttempts,
  resetAttempts,
  setLastAttempt,
} = authSlice.actions;
