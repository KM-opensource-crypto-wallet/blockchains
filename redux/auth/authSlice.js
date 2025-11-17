import {createSlice} from '@reduxjs/toolkit';

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
      const windowMs = 1 * 60 * 1000; // 1 minute
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
} = authSlice.actions;
