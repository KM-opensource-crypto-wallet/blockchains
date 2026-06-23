import {createSlice} from '@reduxjs/toolkit';
import {computeNextAddresses} from 'dok-wallet-blockchain-networks/redux/sentAddressHistory/sentAddressHistoryHelpers';

// Max trusted addresses kept per group bucket (newest-first) to bound growth.
const MAX_ADDRESSES_PER_GROUP = 1000;

const initialState = {
  // Trusted recipient addresses the user has successfully sent funds to,
  // bucketed by group key. EVM-only for now: all EVM chains share the 'evm'
  // bucket (their addresses are case-insensitive, so we store them lowercased).
  addresses: {},
};

export const sentAddressHistorySlice = createSlice({
  name: 'sentAddressHistory',
  initialState,
  reducers: {
    recordSentAddress(state, {payload}) {
      state.addresses = computeNextAddresses(
        state.addresses,
        payload,
        MAX_ADDRESSES_PER_GROUP,
      );
    },
  },
});

export const {recordSentAddress} = sentAddressHistorySlice.actions;
