import BigNumber from 'bignumber.js';
import {convertToSmallAmount, parseBalance} from './index';

// Recompute an approval's displayed fee from a user-chosen gas price.
//
// The staking, exchange and permit2 approval flows all let the user override the
// gas price from the same bottom sheet, and none of the estimation thunks forward
// that override to the chain — this local recompute is the only thing that makes a
// custom gwei visible. Shared so all three behave identically; previously only
// staking had it, and the exchange flows dispatched the staking reducer by
// mistake, writing into the wrong slice and never updating their own fee.
//
// `allowanceData` is mutated in place, so callers pass an immer draft. A missing
// gasPrice or allowanceData is a no-op.
export function applyApproveGasPrice(
  allowanceData,
  {gasPrice, convertedChainName},
) {
  if (!gasPrice || !allowanceData) {
    return;
  }
  const isEVM = convertedChainName === 'ethereum';
  const gasPriceBN = new BigNumber(
    isEVM
      ? convertToSmallAmount(gasPrice?.toString(), 9)?.toString()
      : gasPrice?.toString(),
  );
  const estimateGasBN = new BigNumber(allowanceData?.estimateGas || 0);
  const l1FeesBn = new BigNumber(allowanceData?.l1Fees || 0);
  let transactionFeeBN = gasPriceBN.multipliedBy(estimateGasBN).plus(l1FeesBn);
  // The reset path sends two txs (reset-to-0 + approve) and the estimation
  // doubles the fee to match. Keep the local recompute consistent with it.
  if (allowanceData?.needsReset) {
    transactionFeeBN = transactionFeeBN.multipliedBy(2);
  }
  allowanceData.gasFee = gasPriceBN.toString();
  allowanceData.transactionFee = parseBalance(
    transactionFeeBN?.toString(),
    isEVM ? 18 : 8,
  );
  // Keep the EIP-1559 tip consistent with the new max fee: the priority fee must
  // stay below maxFeePerGas (gasPrice), otherwise the tx is rejected. Clamp to
  // gasPrice - 1 when the (stale) tip now exceeds the custom max fee.
  if (isEVM && allowanceData?.maxPriorityFeePerGas != null) {
    const priorityFeeBN = new BigNumber(
      allowanceData.maxPriorityFeePerGas.toString(),
    );
    allowanceData.maxPriorityFeePerGas = priorityFeeBN.gte(gasPriceBN)
      ? BigNumber.max(gasPriceBN.minus(1), 0).toFixed(0)
      : priorityFeeBN.toFixed(0);
  }
}
