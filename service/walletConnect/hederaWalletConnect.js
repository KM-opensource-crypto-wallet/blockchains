/* eslint-disable no-undef */
import {PrivateKey, Transaction, Client} from '@hashgraph/sdk';
import {IS_SANDBOX} from 'dok-wallet-blockchain-networks/config/config';

export const HEDERA_SIGN_MESSAGE = 'hedera_signMessage';
export const HEDERA_SIGN_TRANSACTION = 'hedera_signTransaction';
export const HEDERA_SIGN_AND_EXECUTE_TRANSACTION =
  'hedera_signAndExecuteTransaction';

const getHederaClient = () =>
  IS_SANDBOX ? Client.forTestnet() : Client.forMainnet();

const parseSignerAccountId = signerAccountId =>
  signerAccountId?.split(':')?.pop();

export const HederaWalletConnectSignMessage = async ({
  signTypeData,
  privateKey,
}) => {
  try {
    const key = PrivateKey.fromStringECDSA(privateKey);
    const message = signTypeData?.message ?? signTypeData;
    const messageBytes = Buffer.from(message, 'base64');
    const signatureBytes = key.sign(messageBytes);
    return {
      signatureMap: [
        {
          publicKey: key.publicKey.toStringDer(),
          signature: Buffer.from(signatureBytes).toString('base64'),
        },
      ],
    };
  } catch (e) {
    console.error('Error in HederaWalletConnectSignMessage', e);
    throw e;
  }
};

export const HederaWalletConnectSignTransaction = async ({
  signTypeData,
  privateKey,
}) => {
  try {
    const key = PrivateKey.fromStringECDSA(privateKey);
    const transactionList = signTypeData?.transactionList ?? signTypeData;
    const transaction = Transaction.fromBytes(
      Buffer.from(transactionList, 'base64'),
    );
    await transaction.sign(key);
    return {
      transactionList: Buffer.from(transaction.toBytes()).toString('base64'),
    };
  } catch (e) {
    console.error('Error in HederaWalletConnectSignTransaction', e);
    throw e;
  }
};

export const HederaWalletConnectSignAndExecuteTransaction = async ({
  signTypeData,
  privateKey,
}) => {
  let client;
  try {
    const key = PrivateKey.fromStringECDSA(privateKey);
    const transactionList = signTypeData?.transactionList ?? signTypeData;
    const signerAccountId = parseSignerAccountId(signTypeData?.signerAccountId);
    const transaction = Transaction.fromBytes(
      Buffer.from(transactionList, 'base64'),
    );
    client = getHederaClient().setOperator(signerAccountId, key);
    await transaction.sign(key);
    const response = await transaction.execute(client);
    const receipt = await response.getReceipt(client);
    return {
      transactionId: response.transactionId.toString(),
      nodeId: response.nodeId?.toString(),
      transactionHash: Buffer.from(response.transactionHash).toString('base64'),
      status: receipt.status.toString(),
    };
  } catch (e) {
    console.error('Error in HederaWalletConnectSignAndExecuteTransaction', e);
    throw e;
  } finally {
    if (client) {
      client.close();
    }
  }
};

export const hederaWalletConnectTransaction = async (
  method,
  payload,
  privateKey,
  signTypeData,
) => {
  let tx = null;
  switch (method) {
    case HEDERA_SIGN_MESSAGE:
      tx = await HederaWalletConnectSignMessage({
        payload,
        signTypeData,
        privateKey,
      });
      break;
    case HEDERA_SIGN_TRANSACTION:
      tx = await HederaWalletConnectSignTransaction({
        payload,
        signTypeData,
        privateKey,
      });
      break;
    case HEDERA_SIGN_AND_EXECUTE_TRANSACTION:
      tx = await HederaWalletConnectSignAndExecuteTransaction({
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
