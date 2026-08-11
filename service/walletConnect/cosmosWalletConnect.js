/* eslint-disable no-undef */
import {DirectSecp256k1Wallet} from '@cosmjs/proto-signing';
import {Secp256k1Wallet} from '@cosmjs/amino';
import {toBase64, fromBase64} from '@cosmjs/encoding';

export const COSMOS_SIGN_DIRECT = 'cosmos_signDirect';
export const COSMOS_SIGN_AMINO = 'cosmos_signAmino';
export const COSMOS_GET_ACCOUNTS = 'cosmos_getAccounts';

export const CosmosWalletConnectSignDirect = async ({
  signTypeData,
  privateKey,
}) => {
  try {
    const wallet = await DirectSecp256k1Wallet.fromKey(
      Buffer.from(privateKey, 'hex'),
    );
    const [account] = await wallet.getAccounts();
    const signerAddress = signTypeData?.signerAddress ?? account.address;
    const signDocInput = signTypeData?.signDoc ?? signTypeData;
    const signDoc = {
      bodyBytes: fromBase64(signDocInput?.bodyBytes),
      authInfoBytes: fromBase64(signDocInput?.authInfoBytes),
      chainId: signDocInput?.chainId,
      accountNumber: BigInt(signDocInput?.accountNumber),
    };
    const {signed, signature} = await wallet.signDirect(signerAddress, signDoc);
    return {
      signature,
      signed: {
        bodyBytes: toBase64(signed.bodyBytes),
        authInfoBytes: toBase64(signed.authInfoBytes),
        chainId: signed.chainId,
        accountNumber: signed.accountNumber.toString(),
      },
    };
  } catch (e) {
    console.error('Error in CosmosWalletConnectSignDirect', e);
    throw e;
  }
};

export const CosmosWalletConnectSignAmino = async ({
  signTypeData,
  privateKey,
}) => {
  try {
    const wallet = await Secp256k1Wallet.fromKey(
      Buffer.from(privateKey, 'hex'),
      'cosmos',
    );
    const [account] = await wallet.getAccounts();
    const signerAddress = signTypeData?.signerAddress ?? account.address;
    const signDoc = signTypeData?.signDoc ?? signTypeData;
    const {signed, signature} = await wallet.signAmino(signerAddress, signDoc);
    return {signature, signed};
  } catch (e) {
    console.error('Error in CosmosWalletConnectSignAmino', e);
    throw e;
  }
};

export const CosmosWalletConnectGetAccounts = async ({privateKey}) => {
  try {
    const wallet = await DirectSecp256k1Wallet.fromKey(
      Buffer.from(privateKey, 'hex'),
    );
    const [account] = await wallet.getAccounts();
    return [
      {
        algo: account.algo,
        address: account.address,
        pubkey: toBase64(account.pubkey),
      },
    ];
  } catch (e) {
    console.error('Error in CosmosWalletConnectGetAccounts', e);
    throw e;
  }
};

export const cosmosWalletConnectTransaction = async (
  method,
  payload,
  privateKey,
  signTypeData,
) => {
  let tx = null;
  switch (method) {
    case COSMOS_SIGN_DIRECT:
      tx = await CosmosWalletConnectSignDirect({
        payload,
        signTypeData,
        privateKey,
      });
      break;
    case COSMOS_SIGN_AMINO:
      tx = await CosmosWalletConnectSignAmino({
        payload,
        signTypeData,
        privateKey,
      });
      break;
    case COSMOS_GET_ACCOUNTS:
      tx = await CosmosWalletConnectGetAccounts({privateKey});
      break;
    default:
      break;
  }
  return tx;
};
