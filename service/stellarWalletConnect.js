import * as StellarSdk from '@stellar/stellar-sdk';
import {config} from 'dok-wallet-blockchain-networks/config/config';
import {getRPCUrl} from 'dok-wallet-blockchain-networks/rpcUrls/rpcUrls';

export const STELLAR_SIGN_XDR = 'stellar_signXDR';
export const STELLAR_SIGN_AND_SUBMIT_XDR = 'stellar_signAndSubmitXDR';

export const stellarWalletConnectTransaction = async (
  method,
  payload,
  privateKey,
  signTypeData,
) => {
  let tx = null;
  switch (method) {
    case STELLAR_SIGN_XDR:
      tx = await StellarWalletConnectSign({xdr: signTypeData, privateKey});
      break;
    case STELLAR_SIGN_AND_SUBMIT_XDR:
      tx = await StellarWalletConnectSignAndSendTransaction({
        payload: signTypeData,
        privateKey,
      });
      break;
    default:
      break;
  }
  return tx;
};

export const StellarWalletConnectSign = async ({xdr, privateKey}) => {
  try {
    const keypair = StellarSdk.Keypair.fromSecret(privateKey);
    const transaction = StellarSdk.TransactionBuilder.fromXDR(
      xdr,
      config.STELLAR_NETWORK,
    );
    transaction.sign(keypair);
    return transaction.toEnvelope().toXDR('base64');
  } catch (e) {
    console.error('Error in stellar signXDR', e);
    return Promise.reject(e?.message);
  }
};

export const StellarWalletConnectSignAndSendTransaction = async ({
  payload,
  privateKey,
}) => {
  try {
    const keypair = StellarSdk.Keypair.fromSecret(privateKey);
    const transaction = StellarSdk.TransactionBuilder.fromXDR(
      payload,
      config.STELLAR_NETWORK,
    );
    transaction.sign(keypair);
    const stellarProvider = new StellarSdk.Horizon.Server(getRPCUrl('stellar'));
    const result = await stellarProvider.submitTransaction(transaction);
    return {hash: result?.hash};
  } catch (e) {
    console.error(
      'Error in StellarWalletConnectSignAndSendTransaction',
      e?.response?.data ?? e,
    );
    return Promise.reject(
      e?.response?.data?.extras?.result_codes ?? e?.message,
    );
  }
};
