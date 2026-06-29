/* eslint-disable no-undef */
import {ApiPromise, HttpProvider, WsProvider} from '@polkadot/api';
import {Keyring} from '@polkadot/keyring';
import {u8aToHex, stringToU8a, u8aConcat} from '@polkadot/util';
import {getRPCUrl} from 'dok-wallet-blockchain-networks/rpcUrls/rpcUrls';

export const POLKADOT_SIGN_TRANSACTION = 'polkadot_signTransaction';
export const POLKADOT_SIGN_MESSAGE = 'polkadot_signMessage';

const createPolkadotApi = async () => {
  const rpcUrl = getRPCUrl('polkadot');
  const isWs = rpcUrl?.startsWith('ws');
  const provider = isWs ? new WsProvider(rpcUrl) : new HttpProvider(rpcUrl);
  return ApiPromise.create({provider});
};

export const PolkadotWalletConnectSignTransaction = async ({
  signTypeData,
  privateKey,
}) => {
  let api;
  try {
    api = await createPolkadotApi();
    const keyring = new Keyring({ss58Format: 0});
    const keypair = keyring.addFromSeed(Buffer.from(privateKey, 'hex'));
    const transactionPayload = signTypeData?.transactionPayload ?? signTypeData;
    const payload = api.registry.createType(
      'ExtrinsicPayload',
      transactionPayload,
      {version: transactionPayload?.version ?? 4},
    );
    const {signature} = payload.sign(keypair);
    return {id: 1, signature};
  } catch (e) {
    console.error('Error in PolkadotWalletConnectSignTransaction', e);
    throw e;
  } finally {
    if (api) {
      await api.disconnect();
    }
  }
};

export const PolkadotWalletConnectSignMessage = async ({
  signTypeData,
  privateKey,
}) => {
  try {
    const keyring = new Keyring({ss58Format: 0});
    const keypair = keyring.addFromSeed(Buffer.from(privateKey, 'hex'));
    const message = signTypeData?.message ?? signTypeData;
    const wrappedMessage = u8aConcat(
      stringToU8a('<Bytes>'),
      stringToU8a(message),
      stringToU8a('</Bytes>'),
    );
    const signature = keypair.sign(wrappedMessage);
    return {signature: u8aToHex(signature)};
  } catch (e) {
    console.error('Error in PolkadotWalletConnectSignMessage', e);
    throw e;
  }
};

export const polkadotWalletConnectTransaction = async (
  method,
  payload,
  privateKey,
  signTypeData,
) => {
  let tx = null;
  switch (method) {
    case POLKADOT_SIGN_TRANSACTION:
      tx = await PolkadotWalletConnectSignTransaction({
        payload,
        signTypeData,
        privateKey,
      });
      break;
    case POLKADOT_SIGN_MESSAGE:
      tx = await PolkadotWalletConnectSignMessage({
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
