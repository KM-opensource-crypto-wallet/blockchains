import {createSlice} from '@reduxjs/toolkit';

const initialState = {
  isLogin: false,
  password: '',
  loading: false,
  error: null,
  fingerprintAuth: false,
  lastUpdateCheckTimestamp: null,
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
} = authSlice.actions;
