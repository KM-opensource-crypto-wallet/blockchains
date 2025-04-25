import {ethers, JsonRpcProvider} from 'ethers';
import {signTypedData} from '@metamask/eth-sig-util';
import {getFreeRPCUrl} from 'dok-wallet-blockchain-networks/rpcUrls/rpcUrls';
import {ErrorDecoder} from 'ethers-decode-error';
const errorDecoder = ErrorDecoder.create();

export const ETH_SEND_TRANSACTION = 'eth_sendTransaction';
export const ETH_SIGN_TRANSACTION = 'eth_signTransaction';
export const PERSONAL_SIGN = 'personal_sign';
export const ETH_SIGN = 'eth_sign';
export const ETH_SIGN_TYPED_DATA = 'eth_signTypedData';
export const ETH_SIGN_TYPED_DATA_V4 = 'eth_signTypedData_v4';

const transactionType = [ETH_SEND_TRANSACTION, ETH_SIGN_TRANSACTION];

export const isWalletConnectTransaction = method =>
  transactionType.includes(method);

export const etherWalletConnectTransaction = async (
  method,
  payload,
  privateKey,
  chain_name,
  signTypeData,
) => {
  let tx = null;
  switch (method) {
    case ETH_SEND_TRANSACTION:
      tx = await etherWalletConnectSendTransaction(
        payload,
        privateKey,
        chain_name,
      );
      break;
    case ETH_SIGN_TRANSACTION:
      tx = await etherWalletConnectSignTransaction(
        payload,
        privateKey,
        chain_name,
      );
      break;
    case ETH_SIGN_TYPED_DATA:
    case ETH_SIGN_TYPED_DATA_V4:
      tx = await etherWalletConnectSignTypeData(
        payload,
        privateKey,
        chain_name,
        signTypeData,
      );
      break;
    case ETH_SIGN:
    case PERSONAL_SIGN:
      tx = await etherWalletConnectPersonalEtherSign(
        signTypeData,
        privateKey,
        chain_name,
      );
      break;
    default:
      break;
  }
  return tx;
};

export const etherWalletConnectSendTransaction = async (
  payload,
  privateKey,
  chain_name,
) =>
  retryFunc(chain_name, privateKey, async walletSigner => {
    try {
      const transaction = await walletSigner.sendTransaction({
        from: payload.from,
        to: payload.to,
        data: payload.data,
        nonce: payload.nonce,
        value: payload.value,
        gasLimit: payload.gas,
        gasPrice: payload.gasPrice,
      });
      return transaction.hash;
    } catch (e) {
      const {reason} = await errorDecoder.decode(e);
      console.error('Error in send ether transaction', reason);
      return Promise.reject(reason);
    }
  });

export const etherWalletConnectSignTransaction = async (
  payload,
  privateKey,
  chain_name,
) =>
  retryFunc(chain_name, privateKey, async walletSigner => {
    try {
      return await walletSigner.signTransaction({
        from: payload.from,
        to: payload.to,
        data: payload.data,
        nonce: payload.nonce,
        value: payload.value,
        gasLimit: payload.gas,
        gasPrice: payload.gasPrice,
      });
    } catch (e) {
      const {reason} = await errorDecoder.decode(e);
      console.error('Error in sign ether transaction', reason);
      return Promise.reject(reason);
    }
  });

export const etherWalletConnectPersonalEtherSign = async (
  payload,
  privateKey,
  chain_name,
) =>
  retryFunc(chain_name, privateKey, async walletSigner => {
    try {
      return await walletSigner.signMessage(
        ethers.isHexString(payload) ? ethers.getBytes(payload) : payload,
      );
    } catch (e) {
      const {reason} = await errorDecoder.decode(e);
      console.error('Error in personal sign ether transaction', reason);
      return Promise.reject(reason);
    }
  });

export const etherWalletConnectSignTypeData = async (
  payload,
  privateKey,
  chain_name,
  signTypeData,
) => {
  try {
    // eslint-disable-next-line no-undef
    const buffer = Buffer.from(privateKey, 'hex');
    const parseData = JSON.parse(signTypeData);
    let version = 'v1';
    if (
      typeof parseData === 'object' &&
      (parseData.types || parseData.primaryType || parseData.domain)
    ) {
      version = 'v4';
    }
    return signTypedData({
      privateKey: buffer,
      data: parseData,
      version: version.toUpperCase(),
    });
  } catch (e) {
    const {reason} = await errorDecoder.decode(e);
    console.error('Error in send sign type data transaction', reason);
    return Promise.reject(reason);
  }
};

const retryFunc = async (chain_name, privateKey, cb) => {
  const allRpcUrls = getFreeRPCUrl(chain_name);
  for (let i = 0; i < allRpcUrls.length; i++) {
    try {
      const ethersProvider = new JsonRpcProvider(allRpcUrls[i]);
      const wallet = new ethers.Wallet(privateKey);
      const etherWallet = wallet.connect(ethersProvider);
      return await cb(etherWallet);
    } catch (e) {
      console.log(
        'Error for EVM rpc for wallet connect',
        allRpcUrls[i],
        'Errors:',
        e,
      );
      if (i === allRpcUrls.length - 1) {
        throw e;
      }
    }
  }
};
