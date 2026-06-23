/* eslint-disable no-undef */
import {Client} from 'xrpl';
import {sign, deriveAddress} from 'ripple-keypairs';
import {encodeForSigning} from 'ripple-binary-codec';
import {getRPCUrl} from 'dok-wallet-blockchain-networks/rpcUrls/rpcUrls';
import {ec as EC, eddsa as EDDSA} from 'elliptic';

export const XRPL_SIGN_TRANSACTION = 'xrpl_signTransaction';
export const XRPL_SUBMIT_TRANSACTION = 'xrpl_submitTransaction';
export const XRPL_SIGN_MESSAGE = 'xrpl_signMessage';

function extractTxJson(data) {
  if (!data) {
    return {};
  }
  if (Array.isArray(data)) {
    return extractTxJson(data[0]);
  }
  if (data.tx_json) {
    return data.tx_json;
  }
  if (data.transaction) {
    return data.transaction;
  }
  return data;
}

function hexToBytes(hex) {
  const bytes = [];
  for (let i = 0; i < hex.length; i += 2) {
    bytes.push(parseInt(hex.slice(i, i + 2), 16));
  }
  return bytes;
}

function bytesToHex(bytes) {
  return Array.from(bytes)
    .map(b => b.toString(16).padStart(2, '0'))
    .join('')
    .toUpperCase();
}

function derivePublicKey(privateKey) {
  const keyUpper = privateKey.toUpperCase();
  if (keyUpper.startsWith('ED')) {
    const ed = new EDDSA('ed25519');
    return (
      'ED' +
      bytesToHex(ed.keyFromSecret(hexToBytes(keyUpper.slice(2))).pubBytes())
    );
  }
  const secp = new EC('secp256k1');
  const rawPrivKey = keyUpper.startsWith('00') ? keyUpper.slice(2) : keyUpper;
  return bytesToHex(
    secp.keyFromPrivate(rawPrivKey, 'hex').getPublic().encodeCompressed(),
  );
}

export const rippleWalletConnectTransaction = async (
  method,
  _payload,
  privateKey,
  signTypeData,
) => {
  let tx = null;
  switch (method) {
    case XRPL_SIGN_TRANSACTION:
      tx = await RippleWalletConnectSign({
        transaction: signTypeData,
        privateKey,
      });
      break;
    case XRPL_SUBMIT_TRANSACTION:
      tx = await RippleWalletConnectSignAndSubmitTransaction({
        transaction: signTypeData,
        privateKey,
      });
      break;
    case XRPL_SIGN_MESSAGE:
      tx = await RippleWalletConnectSignMessage({
        message: signTypeData,
        privateKey,
      });
      break;
    default:
      break;
  }
  return tx;
};

export const RippleWalletConnectSign = async ({transaction, privateKey}) => {
  const rippleProvider = new Client(getRPCUrl('ripple'));
  try {
    await rippleProvider.connect();
    const publicKey = derivePublicKey(privateKey);
    const txJson = extractTxJson(transaction);
    const tx = {
      ...txJson,
      Account: txJson.Account ?? deriveAddress(publicKey),
    };
    const prepared = await rippleProvider.autofill(tx);
    prepared.SigningPubKey = publicKey;
    const encoded = encodeForSigning(prepared);
    prepared.TxnSignature = sign(encoded, privateKey);
    return prepared;
  } catch (e) {
    console.error('Error in RippleWalletConnectSign', e);
    return Promise.reject(e?.message);
  } finally {
    await rippleProvider.disconnect();
  }
};

export const RippleWalletConnectSignAndSubmitTransaction = async ({
  transaction,
  privateKey,
}) => {
  const rippleProvider = new Client(getRPCUrl('ripple'));
  try {
    await rippleProvider.connect();
    const publicKey = derivePublicKey(privateKey);
    const txJson = extractTxJson(transaction);
    const tx = {
      ...txJson,
      Account: txJson.Account ?? deriveAddress(publicKey),
    };
    const prepared = await rippleProvider.autofill(tx);
    prepared.SigningPubKey = publicKey;
    const encoded = encodeForSigning(prepared);
    prepared.TxnSignature = sign(encoded, privateKey);
    const result = await rippleProvider.submitAndWait(prepared);
    return {hash: result?.result?.hash ?? result?.hash};
  } catch (e) {
    console.error('Error in RippleWalletConnectSignAndSubmitTransaction', e);
    return Promise.reject(e?.message);
  } finally {
    await rippleProvider.disconnect();
  }
};

export const RippleWalletConnectSignMessage = async ({message, privateKey}) => {
  try {
    const messageHex = Buffer.from(message, 'utf8')
      .toString('hex')
      .toUpperCase();
    const signature = sign(messageHex, privateKey);
    return signature;
  } catch (e) {
    console.error('Error in RippleWalletConnectSignMessage', e);
    return Promise.reject(e?.message);
  }
};
