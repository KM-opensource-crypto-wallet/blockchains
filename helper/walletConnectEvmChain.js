/*
 * Wallet-side answers for the EVM chain-management methods dApps send over
 * WalletConnect without user interaction:
 *   - wallet_switchEthereumChain (EIP-3326): `null` when the session already
 *     covers the chain, error 4902 otherwise. The dApp's provider only forwards
 *     this to the wallet for chains it could not switch to locally.
 *   - wallet_addEthereumChain (EIP-3085): `null` only for chains this wallet
 *     serves; claiming success for an unknown chain would make the dApp issue
 *     requests the session can never satisfy.
 * Pure functions, unit tested in a node environment.
 */
import {config} from 'dok-wallet-blockchain-networks/config/config';

const EIP155 = 'eip155';
const INVALID_PARAMS_CODE = -32602;
// EIP-3326: "Unrecognized chain ID".
const UNRECOGNIZED_CHAIN_CODE = 4902;

/** `0x128` or `296` → `eip155:296`; null when the value is not a chain id. */
export const hexChainIdToCaip = value => {
  if (typeof value !== 'string' || !value.trim()) {
    return null;
  }
  const trimmed = value.trim();
  const isHex = /^0x[0-9a-fA-F]+$/.test(trimmed);
  const isDecimal = /^\d+$/.test(trimmed);
  if (!isHex && !isDecimal) {
    return null;
  }
  const chainId = Number.parseInt(trimmed, isHex ? 16 : 10);
  return Number.isSafeInteger(chainId) ? `${EIP155}:${chainId}` : null;
};

/** Approved eip155 chains of a session; derived from accounts when absent. */
export const getSessionEvmChains = session => {
  const namespace = session?.namespaces?.[EIP155];
  if (!namespace) {
    return [];
  }
  if (Array.isArray(namespace.chains) && namespace.chains.length) {
    return namespace.chains;
  }
  return [
    ...new Set(
      (namespace.accounts || []).map(account =>
        account.split(':').slice(0, 2).join(':'),
      ),
    ),
  ];
};

export const isWalletSupportedEvmChain = caipChainId =>
  config.WALLET_CONNECT_SUPPORTED_CHAIN[caipChainId]?.namespace === EIP155;

const invalidChainIdParam = () => ({
  error: {
    code: INVALID_PARAMS_CODE,
    message: 'Invalid params: chainId must be a hex chain id',
  },
});

export const answerSwitchEthereumChain = (session, params) => {
  const requested = params?.[0]?.chainId;
  const caipChainId = hexChainIdToCaip(requested);
  if (!caipChainId) {
    return invalidChainIdParam();
  }
  if (getSessionEvmChains(session).includes(caipChainId)) {
    return {result: null};
  }
  return {
    error: {
      code: UNRECOGNIZED_CHAIN_CODE,
      message: `Unrecognized chain ID "${requested}". Try adding the chain using wallet_addEthereumChain first.`,
    },
  };
};

export const answerAddEthereumChain = params => {
  const requested = params?.[0]?.chainId;
  const caipChainId = hexChainIdToCaip(requested);
  if (!caipChainId) {
    return invalidChainIdParam();
  }
  if (isWalletSupportedEvmChain(caipChainId)) {
    return {result: null};
  }
  return {
    error: {
      code: INVALID_PARAMS_CODE,
      message: `Chain ${requested} is not supported by this wallet`,
    },
  };
};
