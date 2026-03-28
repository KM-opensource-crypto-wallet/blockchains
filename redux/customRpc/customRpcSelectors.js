export const selectAllCustomRpc = state => state.customRpc?.customRpcList || {};

export const selectRpcErrorChain = state =>
  state.customRpc?.rpcErrorChain || null;

export const getCustomRPCKey = (chain_name, walletClientId) =>
  `${chain_name}_${walletClientId}`;
// Returns the custom RPC URL for a given chain + wallet, or null if not set
export const selectCustomRpcUrlByChainAndWallet =
  (chain_name, walletClientId) => state => {
    const key = getCustomRPCKey(chain_name, walletClientId);
    return state.customRpc?.customRpcList?.[key]?.customRpcUrl || null;
  };

export const getCustomRPCWithData = (
  customRpcList,
  chain_name,
  walletClientId,
) => {
  const key = getCustomRPCKey(chain_name, walletClientId);
  return customRpcList?.[key]?.customRpcUrl || null;
};
