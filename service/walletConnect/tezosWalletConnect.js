import {InMemorySigner} from '@taquito/signer';
import {TezosToolkit} from '@taquito/taquito';
import {getRPCUrl} from 'dok-wallet-blockchain-networks/rpcUrls/rpcUrls';

export const TEZOS_GET_ACCOUNTS = 'tezos_getAccounts';
export const TEZOS_SIGN = 'tezos_sign';
export const TEZOS_SEND = 'tezos_send';

const firstOf = data => (Array.isArray(data) ? data[0] : data);

const buildTransferParams = op => ({
  to: op.destination,
  amount: Number(op.amount),
  mutez: true,
});

export const TezosWalletConnectGetAccounts = async ({privateKey}) => {
  try {
    const signer = await InMemorySigner.fromSecretKey(privateKey);
    const address = await signer.publicKeyHash();
    const pubkey = await signer.publicKey();
    return [{algo: 'ed25519', address, pubkey}];
  } catch (e) {
    console.error('Error in TezosWalletConnectGetAccounts', e);
    throw e;
  }
};

export const TezosWalletConnectSign = async ({signTypeData, privateKey}) => {
  try {
    const signer = await InMemorySigner.fromSecretKey(privateKey);
    const data = firstOf(signTypeData);
    const payload = data?.payload ?? data;
    const {prefixSig} = await signer.sign(payload);
    return {signature: prefixSig};
  } catch (e) {
    console.error('Error in TezosWalletConnectSign', e);
    throw e;
  }
};

export const TezosWalletConnectSend = async ({signTypeData, privateKey}) => {
  try {
    const signer = await InMemorySigner.fromSecretKey(privateKey);
    const tezosProvider = new TezosToolkit(getRPCUrl('tezos'));
    tezosProvider.setProvider({signer});
    const data = firstOf(signTypeData);
    const operations = data?.operations ?? [];
    const isAllTransactions =
      operations.length > 0 &&
      operations.every(op => op?.kind === 'transaction');
    if (!isAllTransactions) {
      throw new Error(
        'tezos_send only supports transaction (transfer) operations',
      );
    }
    let result;
    if (operations.length === 1) {
      result = await tezosProvider.contract.transfer(
        buildTransferParams(operations[0]),
      );
    } else {
      let batch = tezosProvider.contract.batch();
      operations.forEach(op => {
        batch = batch.withTransfer(buildTransferParams(op));
      });
      result = await batch.send();
    }
    return {operationHash: result?.hash};
  } catch (e) {
    console.error('Error in TezosWalletConnectSend', e);
    throw e;
  }
};

export const tezosWalletConnectTransaction = async (
  method,
  payload,
  privateKey,
  signTypeData,
) => {
  let tx = null;
  switch (method) {
    case TEZOS_GET_ACCOUNTS:
      tx = await TezosWalletConnectGetAccounts({privateKey});
      break;
    case TEZOS_SIGN:
      tx = await TezosWalletConnectSign({signTypeData, privateKey});
      break;
    case TEZOS_SEND:
      tx = await TezosWalletConnectSend({signTypeData, privateKey});
      break;
    default:
      break;
  }
  return tx;
};
