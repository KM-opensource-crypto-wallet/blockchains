export const selectAllCustomRpc = state => state.customRpc?.customRpcList || {};

export const selectRpcErrorChain = state =>
  state.customRpc?.rpcErrorChain || null;

// Returns the custom RPC URL for a given chain + wallet, or null if not set
export const selectCustomRpcUrlByChainAndWallet =
  (chain_name, walletClientId) => state => {
    const key = `${chain_name}_${walletClientId}`;
    return state.customRpc?.customRpcList?.[key]?.customRpcUrl || null;
  };
