import {createSlice} from '@reduxjs/toolkit';

const initialState = {
  customRpcList: {},
  rpcErrorChain: null,
};

export const customRpcSlice = createSlice({
  name: 'customRpc',
  initialState,
  reducers: {
    addCustomRpc(state, {payload}) {
      const {chain_name, chain_display_name, customRpcUrl, wallets} = payload;
      (wallets || []).forEach(walletClientId => {
        const key = `${chain_name}_${walletClientId}`;
        state.customRpcList[key] = {
          chain_name,
          chain_display_name,
          customRpcUrl,
          walletClientId,
        };
      });
    },
    updateCustomRpc(state, {payload}) {
      const {chain_name, chain_display_name, customRpcUrl, wallets} = payload;
      // Remove all old entries for this chain
      Object.keys(state.customRpcList).forEach(k => {
        if (state.customRpcList[k]?.chain_name === chain_name) {
          delete state.customRpcList[k];
        }
      });
      // Add new entries per wallet
      (wallets || []).forEach(walletClientId => {
        const key = `${chain_name}_${walletClientId}`;
        state.customRpcList[key] = {
          chain_name,
          chain_display_name,
          customRpcUrl,
          walletClientId,
        };
      });
    },
    deleteCustomRpc(state, {payload}) {
      if (payload.walletClientId) {
        delete state.customRpcList[
          `${payload.chain_name}_${payload.walletClientId}`
        ];
      } else {
        Object.keys(state.customRpcList).forEach(k => {
          if (state.customRpcList[k]?.chain_name === payload.chain_name) {
            delete state.customRpcList[k];
          }
        });
      }
    },
    setRpcError(state, {payload}) {
      state.rpcErrorChain = payload;
    },
    clearRpcError(state) {
      state.rpcErrorChain = null;
    },
  },
});

export const {
  addCustomRpc,
  updateCustomRpc,
  deleteCustomRpc,
  setRpcError,
  clearRpcError,
} = customRpcSlice.actions;
