import {
  approveClaimDepositRequest,
  claimOnchainDeposit,
  generateLightningInvoiceViaBitcoinAddress,
  generateLightningInvoiceViaBolt11,
  generateLightningSparkAddress,
  getLightningBalance,
  getLightningTransaction,
  getLightningTransactions,
  isLightningAddressValid,
  prepareLightning,
  refundClaimRequest,
  sendLightning,
  waitForLightningConfirmation,
} from 'myWallet/wallet-lightning.service';

export const BitcoinLightningChain = (_, phrase) => {
  return {
    getBalance: async () => {
      return await getLightningBalance(phrase);
    },
    isValidAddress: async ({address}) => {
      return await isLightningAddressValid(address, phrase);
    },
    generateInvoiceViaBolt11: async currentPhrase => {
      return await generateLightningInvoiceViaBolt11(phrase ?? currentPhrase);
    },
    generateSparkAddress: async currentPhrase => {
      return await generateLightningSparkAddress(phrase ?? currentPhrase);
    },
    getTransactions: async () => {
      return await getLightningTransactions(phrase);
    },
    getTransaction: async ({txHash}) => {
      return await getLightningTransaction(phrase, txHash);
    },
    generateInvoiceViaBitcoinAddress: async currentPhrase => {
      return await generateLightningInvoiceViaBitcoinAddress(
        phrase ?? currentPhrase,
      );
    },
    getEstimateFee: async ({toAddress, amount}) => {
      return await prepareLightning(phrase, toAddress, amount);
    },
    send: async ({}) => {
      return await sendLightning(phrase);
    },
    waitForConfirmation: async txData => {
      return await waitForLightningConfirmation(phrase, txData);
    },

    rejectClaimDeposit: async txData => {
      return await refundClaimRequest(phrase, txData);
    },
    approveClaimDeposit: async txData => {
      return await approveClaimDepositRequest(phrase, txData);
    },
    unClaimedOnChainDeposit: async () => {
      return await claimOnchainDeposit(phrase);
    },
  };
};
