import {createSlice} from '@reduxjs/toolkit';
import {submitScheduledPayment} from 'dok-wallet-blockchain-networks/redux/schedulePayment/schedulePaymentSlice';

// In-flight UI state for saving a scheduled payment. Deliberately its own
// slice, blacklisted from redux-persist in src/redux/store.js: if it lived in
// the persisted `schedulePayment` slice, quitting the app mid-submit would
// rehydrate a pending submit with no thunk left to ever clear it, leaving
// the Save button disabled forever. Same pattern as walletsRefresh.
const initialState = {
  // Number of submitScheduledPayment thunks currently running. The screen
  // derives "is submitting" from this (see schedulePaymentSubmitSelectors).
  pendingSubmitCount: 0,
};

export const schedulePaymentSubmitSlice = createSlice({
  name: 'schedulePaymentSubmit',
  initialState,
  reducers: {},
  extraReducers: builder => {
    const settle = state => {
      state.pendingSubmitCount = Math.max(0, state.pendingSubmitCount - 1);
    };
    builder
      .addCase(submitScheduledPayment.pending, state => {
        state.pendingSubmitCount += 1;
      })
      .addCase(submitScheduledPayment.fulfilled, settle)
      .addCase(submitScheduledPayment.rejected, settle);
  },
});

export default schedulePaymentSubmitSlice.reducer;
