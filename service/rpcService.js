import axios from 'axios';
import BigNumber from 'bignumber.js';
import {CHAIN_ID} from 'dok-wallet-blockchain-networks/config/config';
import {isEVMChain} from 'dok-wallet-blockchain-networks/helper';

const SUPPORTED_EVM_CHAIN_IDS = new Set(Object.values(CHAIN_ID));

export const API_REQUEST = axios.create({
  headers: {
    'Content-Type': 'application/json',
  },
  timeout: 5000,
});

export async function validateRpcUrl(url, expectedChainName) {
  try {
    const resp = await API_REQUEST.post(url, {
      jsonrpc: '2.0',
      method: 'eth_chainId',
      params: [],
      id: 1,
    });
    const chainIdHex = resp?.data?.result;
    if (chainIdHex) {
      const chainId = new BigNumber(chainIdHex).toNumber();
      const expectedChainId = CHAIN_ID?.[expectedChainName];
      if (!expectedChainId) {
        return {isValid: false, error: 'Unsupported chain'};
      }
      if (!SUPPORTED_EVM_CHAIN_IDS.has(chainId)) {
        return {isValid: false, error: 'Chain ID is not supported'};
      }
      if (chainId !== expectedChainId) {
        return {
          isValid: false,
          error: `RPC URL chain mismatch. Expected ${expectedChainId}, got ${chainId}`,
        };
      }
      return {isValid: true, chainId};
    }
    return {isValid: false, error: 'Invalid response from RPC URL'};
  } catch (e) {
    return {
      isValid: false,
      error: e?.message || 'Failed to connect to RPC URL',
    };
  }
}
