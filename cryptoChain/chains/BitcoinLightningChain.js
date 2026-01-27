import { 
  generateLightningInvoiceViaBitcoinAddress, 
  generateLightningInvoiceViaBolt11, 
  generateLightningSparkAddress, 
  getLightningBalance, 
  getLightningTransactions, 
  isLightningAddressValid, 
  prepareLightning, 
  sendLightning, 
  waitForLightningConfirmation 
} from '../../../src/myWallet/wallet.lightning.service';

export const BitcoinLightningChain = (chain, phrase) => {

  async function getBalance() {
    return await getLightningBalance(phrase)
  }

  async function isValidAddress({ address }) {
    return await isLightningAddressValid(address, phrase)
  }

  async function generateInvoiceViaBolt11(currentPhhrase) {
    return await generateLightningInvoiceViaBolt11(phrase ?? currentPhhrase)
  }

  async function generateSparkAddress(currentPhhrase) {
    return await generateLightningSparkAddress(phrase ?? currentPhhrase);
  }

  async function generateInvoiceViaBitcoinAddress(currentPhhrase) {
    return await generateLightningInvoiceViaBitcoinAddress(phrase ?? currentPhhrase);
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
    return await prepareLightning(phrase, toAddress, amount)
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
    return await sendLightning(phrase)
  }

  async function waitForConfirmation({ transaction }) {
    const transactionID = transaction;
    console.log('transactionID:', transactionID);

    return await waitForLightningConfirmation(phrase)
  }

  async function getTransactions() {
    return await getLightningTransactions(phrase);
  }
  return {
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
