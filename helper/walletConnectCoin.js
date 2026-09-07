/*
 * Pure helpers for executing an approved WalletConnect session_request
 * (redux/wallets/walletsSlice.js `walletConnect` thunk). Kept free of
 * react-native imports so they can be unit tested in a node environment.
 */

const WALLET_CONNECT_GENERIC_ERROR_CODE = 5000;

/**
 * The wallet coin a session_request runs against: the native coin of the
 * session chain, preferring the one whose address matches the session account.
 * The address match is a tie-breaker only (Hedera sessions carry `0.0.N` while
 * the coin stores the EVM address), and there is deliberately no fallback to
 * another chain's coin.
 */
export const resolveWalletConnectCoin = ({
  walletCoins = [],
  chain_name,
  walletAddress,
}) => {
  if (!chain_name) {
    return null;
  }
  const nativeCoins = walletCoins.filter(
    coin => coin?.chain_name === chain_name && coin?.type === 'coin',
  );
  const address = walletAddress?.toLowerCase();
  return (
    nativeCoins.find(
      coin => address && coin?.address?.toLowerCase() === address,
    ) ||
    nativeCoins[0] ||
    null
  );
};

/**
 * A chain may serve two CAIP-2 namespaces (Hedera: `hedera:*` natively and
 * `eip155:*` through its JSON-RPC relay). `chain.evm` is the executor for the
 * eip155 methods; everything else runs on the chain itself.
 */
export const getWalletConnectExecutor = (chain, chainId) =>
  typeof chainId === 'string' && chainId.startsWith('eip155:') && chain?.evm
    ? chain.evm
    : chain;

/**
 * JSON-RPC error for a failed request. Chains attach `jsonRpcError` when the
 * protocol defines a specific error (HIP-820 code 9000 with the node status);
 * anything else is the generic user-facing failure.
 */
export const toWalletConnectError = (
  error,
  fallbackMessage = 'Transaction error',
) => {
  const specific = error?.jsonRpcError;
  if (specific?.code) {
    return {
      code: specific.code,
      message: specific.message || error?.message || fallbackMessage,
      ...(specific.data !== undefined && {data: specific.data}),
    };
  }
  return {
    code: WALLET_CONNECT_GENERIC_ERROR_CODE,
    message: error?.message || fallbackMessage,
  };
};
