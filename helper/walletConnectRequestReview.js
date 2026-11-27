/*
 * One entry point for the WalletConnect review screen: the risk review of a
 * request, or null for methods without one. Never throws.
 *   {level: 'none'|'warn'|'danger', reasons: string[],
 *    rows: {label, value}[], blocked: boolean}
 * `danger` needs the "I understand" acknowledgement; `blocked` cannot be
 * approved at all (the chain's signer refuses it too).
 */
import {reviewEvmTypedData} from 'dok-wallet-blockchain-networks/helper/evmTypedDataReview';
import {reviewPsbt} from 'dok-wallet-blockchain-networks/helper/psbtReview';
import {reviewTronTransaction} from 'dok-wallet-blockchain-networks/helper/tronTxReview';
import {reviewSolanaRequest} from 'dok-wallet-blockchain-networks/helper/solanaTxReview';
import {reviewStellarTransaction} from 'dok-wallet-blockchain-networks/helper/stellarTxReview';
import {reviewXrplRequest} from 'dok-wallet-blockchain-networks/helper/xrplTxReview';
import {reviewHederaRequest} from 'dok-wallet-blockchain-networks/helper/hederaWalletConnect';

const REVIEWERS = {
  eth_signTypedData: ({signTypeData, chainId}) =>
    reviewEvmTypedData(signTypeData, {chainId}),
  eth_signTypedData_v3: ({signTypeData, chainId}) =>
    reviewEvmTypedData(signTypeData, {chainId}),
  eth_signTypedData_v4: ({signTypeData, chainId}) =>
    reviewEvmTypedData(signTypeData, {chainId}),
  signPsbt: ({signTypeData, chainId, walletAddress}) =>
    reviewPsbt(signTypeData, {chainId, walletAddress}),
  tron_signTransaction: ({signTypeData}) => reviewTronTransaction(signTypeData),
  tron_sendTransaction: ({signTypeData}) => reviewTronTransaction(signTypeData),
  solana_signTransaction: ({signTypeData, walletAddress}) =>
    reviewSolanaRequest(signTypeData, walletAddress, 'solana_signTransaction'),
  solana_signAndSendTransaction: ({signTypeData, walletAddress}) =>
    reviewSolanaRequest(
      signTypeData,
      walletAddress,
      'solana_signAndSendTransaction',
    ),
  solana_signAllTransactions: ({signTypeData, walletAddress}) =>
    reviewSolanaRequest(
      signTypeData,
      walletAddress,
      'solana_signAllTransactions',
    ),
  stellar_signXDR: ({signTypeData}) => reviewStellarTransaction(signTypeData),
  stellar_signAndSubmitXDR: ({signTypeData}) =>
    reviewStellarTransaction(signTypeData),
  xrpl_signTransaction: ({signTypeData}) => reviewXrplRequest(signTypeData),
  xrpl_submitTransaction: ({signTypeData}) => reviewXrplRequest(signTypeData),
  hedera_signAndExecuteTransaction: ({method, signTypeData}) =>
    reviewHederaRequest(method, signTypeData),
};

export const reviewWalletConnectRequest = request => {
  const reviewer = REVIEWERS[request?.method];
  if (!reviewer) {
    return null;
  }
  try {
    const review = reviewer(request);
    return review ? {blocked: false, ...review} : null;
  } catch (e) {
    return {
      level: 'danger',
      reasons: ['This request could not be read.'],
      rows: [],
      blocked: false,
    };
  }
};
