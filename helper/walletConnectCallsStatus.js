/*
 * Wallet-side answer for wallet_getCallsStatus (EIP-5792), which dApps poll
 * after wallet_sendCalls until the batch settles. wallet_sendCalls returns the
 * hash of the single EIP-7702 execute() transaction that carries every call,
 * so that hash is the batch id: the status is that transaction's receipt and
 * the batch is always atomic. Nothing is stored wallet-side.
 * Pure functions, unit tested.
 */
import {toQuantity} from 'ethers';

// EIP-5792 status codes.
const PENDING = 100;
const CONFIRMED = 200;
const REVERTED = 500;
// EIP-5792: "Unknown bundle id".
const UNKNOWN_BUNDLE_ID_CODE = 5730;

export const isBatchCallsId = id =>
  typeof id === 'string' && /^0x[0-9a-fA-F]{64}$/.test(id);

export const unknownBundleIdError = () => ({
  error: {code: UNKNOWN_BUNDLE_ID_CODE, message: 'Unknown bundle id'},
});

// ethers v6 receipt (numbers / bigints) → EIP-5792 receipt (hex quantities,
// which viem parses with hexToBigInt).
const toCallsReceipt = receipt => ({
  logs: (receipt.logs || []).map(({address, data, topics}) => ({
    address,
    data,
    topics: [...topics],
  })),
  status: receipt.status === 1 ? '0x1' : '0x0',
  blockHash: receipt.blockHash,
  blockNumber: toQuantity(receipt.blockNumber),
  gasUsed: toQuantity(receipt.gasUsed),
  transactionHash: receipt.hash,
});

/** `receipt` is null while the transaction is not mined yet. */
export const buildCallsStatus = ({id, caipChainId, receipt}) => {
  const result = {
    version: '2.0.0',
    id,
    chainId: toQuantity(Number(caipChainId.split(':')[1])),
    atomic: true,
    status: PENDING,
  };
  if (!receipt) {
    return result;
  }
  return {
    ...result,
    status: receipt.status === 1 ? CONFIRMED : REVERTED,
    receipts: [toCallsReceipt(receipt)],
  };
};
