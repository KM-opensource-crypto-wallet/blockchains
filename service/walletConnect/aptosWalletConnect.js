/* eslint-disable no-undef */
import {IS_SANDBOX} from 'dok-wallet-blockchain-networks/config/config';
const {
  Account,
  Ed25519PrivateKey,
  Aptos,
  AptosConfig,
  Network,
  generateSignedTransaction,
} = require('@aptos-labs/ts-sdk');

export const APTOS_SIGN_MESSAGE = 'aptos_signMessage';
export const APTOS_SIGN_TRANSACTION = 'aptos_signTransaction';
export const APTOS_SIGN_AND_SUBMIT_TRANSACTION =
  'aptos_signAndSubmitTransaction';

let aptosProvider;
const getAptosProvider = () => {
  if (aptosProvider) {
    return aptosProvider;
  }
  const aptosConfig = new AptosConfig({
    network: IS_SANDBOX ? Network.TESTNET : Network.MAINNET,
  });
  aptosProvider = new Aptos(aptosConfig);
  return aptosProvider;
};

const getAccountFromPrivateKey = privateKey => {
  const pk = new Ed25519PrivateKey(privateKey);
  return Account.fromPrivateKey({privateKey: pk, legacy: true});
};

const buildTransactionFromPayload = async ({sender, payload}) => {
  const provider = getAptosProvider();
  return provider.transaction.build.simple({
    sender,
    data: {
      function: payload?.function,
      typeArguments: payload?.type_arguments ?? payload?.typeArguments ?? [],
      functionArguments: payload?.arguments ?? payload?.functionArguments,
    },
  });
};

export const AptosWalletConnectSignMessage = async ({
  signTypeData,
  privateKey,
}) => {
  try {
    const account = getAccountFromPrivateKey(privateKey);
    const message = signTypeData?.message ?? signTypeData;
    const signature = account.sign(message);
    return {
      signature: signature.toString(),
      fullMessage: message,
      address: account.accountAddress.toString(),
    };
  } catch (e) {
    console.error('Error in AptosWalletConnectSignMessage', e);
    throw e;
  }
};

export const AptosWalletConnectSignTransaction = async ({
  signTypeData,
  privateKey,
}) => {
  try {
    const account = getAccountFromPrivateKey(privateKey);
    const payload = signTypeData?.transaction ?? signTypeData;
    const transaction = await buildTransactionFromPayload({
      sender: account.accountAddress,
      payload,
    });
    const senderAuthenticator =
      account.signTransactionWithAuthenticator(transaction);
    const signedTransaction = generateSignedTransaction({
      transaction,
      senderAuthenticator,
    });
    return {
      signedTransaction: Buffer.from(signedTransaction).toString('base64'),
    };
  } catch (e) {
    console.error('Error in AptosWalletConnectSignTransaction', e);
    throw e;
  }
};

export const AptosWalletConnectSignAndSubmitTransaction = async ({
  signTypeData,
  privateKey,
}) => {
  try {
    const account = getAccountFromPrivateKey(privateKey);
    const provider = getAptosProvider();
    const payload = signTypeData?.transaction ?? signTypeData;
    const transaction = await buildTransactionFromPayload({
      sender: account.accountAddress,
      payload,
    });
    const committedTransaction = await provider.signAndSubmitTransaction({
      signer: account,
      transaction,
    });
    return {hash: committedTransaction?.hash};
  } catch (e) {
    console.error('Error in AptosWalletConnectSignAndSubmitTransaction', e);
    throw e;
  }
};

export const aptosWalletConnectTransaction = async (
  method,
  payload,
  privateKey,
  signTypeData,
) => {
  let tx = null;
  switch (method) {
    case APTOS_SIGN_MESSAGE:
      tx = await AptosWalletConnectSignMessage({
        payload,
        signTypeData,
        privateKey,
      });
      break;
    case APTOS_SIGN_TRANSACTION:
      tx = await AptosWalletConnectSignTransaction({
        payload,
        signTypeData,
        privateKey,
      });
      break;
    case APTOS_SIGN_AND_SUBMIT_TRANSACTION:
      tx = await AptosWalletConnectSignAndSubmitTransaction({
        payload,
        signTypeData,
        privateKey,
      });
      break;
    default:
      break;
  }
  return tx;
};
