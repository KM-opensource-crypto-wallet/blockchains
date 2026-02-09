import {
  approveClaimDepositRequest,
  claimOnchainDeposit,
  generateLightningInvoiceViaBitcoinAddress,
  generateLightningInvoiceViaBolt11,
  generateLightningSparkAddress,
  getLightningBalance,
  getLightningTransactions,
  isLightningAddressValid,
  prepareLightning,
  refundClaimRequest,
  sendLightning,
  waitForLightningConfirmation,
} from '../../../src/myWallet/wallet.lightning.service';

export const BitcoinLightningChain = (chain, phrase) => {
  async function rejectClaimRequest(txid, vout, destinationAddress) {
    return await refundClaimRequest(phrase, txid, vout, destinationAddress);
  }
  async function approveClaimedBtc(txid, vout) {
    return await approveClaimDepositRequest(phrase, txid, vout);
  }
  async function unClaimedOnChainDeposit() {
    const unClaimedDeposits = await claimOnchainDeposit(phrase);
    return unClaimedDeposits;
  }
  async function getBalance() {
    const balance = await getLightningBalance(phrase);
    return balance;
  }

  async function isValidAddress({address}) {
    return await isLightningAddressValid(address, phrase);
  }

  async function generateInvoiceViaBolt11(currentPhrase) {
    return await generateLightningInvoiceViaBolt11(phrase ?? currentPhrase);
  }

  async function generateSparkAddress(currentPhrase) {
    return await generateLightningSparkAddress(phrase ?? currentPhrase);
  }

  async function generateInvoiceViaBitcoinAddress(currentPhrase) {
    return await generateLightningInvoiceViaBitcoinAddress(
      phrase ?? currentPhrase,
    );
  }

  async function getEstimateFee({
    fromAddress,
    toAddress,
    amount,
    privateKey,
    chain_name,
    deriveAddresses,
    balance,
    extendedPrivateKey,
    feeMultiplier,
    estimateGas: virtualSize,
    feesType,
    selectedUTXOs,
  }) {
    return await prepareLightning(phrase, toAddress, amount);
  }

  async function send({
    to,
    from,
    amount,
    privateKey,
    transactionFee,
    chain_name,
    deriveAddresses,
    balance,
    extendedPrivateKey,
    selectedUTXOs,
  }) {
    return await sendLightning(phrase);
  }

  async function waitForConfirmation({transaction}) {
    const transactionID = transaction;
    console.log('transactionID:', transactionID);

    return await waitForLightningConfirmation(phrase);
  }

  async function getTransactions() {
    return await getLightningTransactions(phrase);
  }
  return {
    rejectClaimRequest,
    approveClaimedBtc,
    unClaimedOnChainDeposit,
    getBalance,
    isValidAddress,
    generateInvoiceViaBolt11,
    generateInvoiceViaBitcoinAddress,
    generateSparkAddress,
    getEstimateFee,
    send,
    waitForConfirmation,
    getTransactions,
  };
};
