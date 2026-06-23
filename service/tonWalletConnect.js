/* eslint-disable no-undef */
import {
  WalletContractV4,
  TonClient,
  beginCell,
  storeStateInit,
  loadStateInit,
  Cell,
  internal,
  SendMode,
} from '@ton/ton';
import {keyPairFromSeed, sign} from '@ton/crypto';
import {getRPCUrl} from 'dok-wallet-blockchain-networks/rpcUrls/rpcUrls';

export const TON_SEND_MESSAGE = 'ton_sendMessage';
export const TON_SIGN_DATA = 'ton_signData';

export const getTonSessionProperties = privateKey => {
  const keyPair = keyPairFromSeed(Buffer.from(privateKey, 'hex'));
  const wallet = WalletContractV4.create({
    publicKey: keyPair.publicKey,
    workchain: 0,
  });
  const ton_getPublicKey = Buffer.from(keyPair.publicKey).toString('hex');
  const stateInitCell = beginCell()
    .store(storeStateInit(wallet.init))
    .endCell();
  const ton_getStateInit = stateInitCell.toBoc().toString('base64');
  return {ton_getPublicKey, ton_getStateInit};
};

export const TonWalletConnectSendMessage = async ({payload, privateKey}) => {
  try {
    const tonClient = new TonClient({
      endpoint: getRPCUrl('ton'),
      apiKey: getRPCUrl('ton_api_key'),
    });
    const keyPair = keyPairFromSeed(Buffer.from(privateKey, 'hex'));
    const wallet = WalletContractV4.create({
      publicKey: keyPair.publicKey,
      workchain: 0,
    });
    const walletContract = tonClient.open(wallet);
    const seqno = await walletContract.getSeqno();
    const messages = (payload?.messages || []).map(msg => {
      const body = msg.payload ? Cell.fromBase64(msg.payload) : undefined;
      const init = msg.stateInit
        ? loadStateInit(Cell.fromBase64(msg.stateInit).beginParse())
        : undefined;
      return internal({
        to: msg.address,
        value: BigInt(msg.amount),
        body,
        init,
        bounce: false,
      });
    });
    const transfer = walletContract.createTransfer({
      sendMode: SendMode.PAY_GAS_SEPARATELY,
      secretKey: keyPair.secretKey,
      seqno,
      messages,
    });
    await walletContract.send(transfer);
    return {boc: transfer.toBoc().toString('base64')};
  } catch (e) {
    console.error('Error in TonWalletConnectSendMessage', e);
    return Promise.reject(e?.message);
  }
};

export const TonWalletConnectSignData = async ({signTypeData, privateKey}) => {
  try {
    const keyPair = keyPairFromSeed(Buffer.from(privateKey, 'hex'));
    let messageBytes;
    if (signTypeData?.type === 'text') {
      messageBytes = Buffer.from(signTypeData.text, 'utf8');
    } else if (signTypeData?.cell) {
      messageBytes = Cell.fromBase64(signTypeData.cell).hash();
    } else {
      throw new Error('Unsupported ton_signData type');
    }
    const signature = sign(messageBytes, keyPair.secretKey);
    return {
      signature: Buffer.from(signature).toString('base64'),
      publicKey: Buffer.from(keyPair.publicKey).toString('hex'),
    };
  } catch (e) {
    console.error('Error in TonWalletConnectSignData', e);
    return Promise.reject(e?.message);
  }
};

export const tonWalletConnectTransaction = async (
  method,
  payload,
  privateKey,
  signTypeData,
) => {
  let tx = null;
  switch (method) {
    case TON_SEND_MESSAGE:
      tx = await TonWalletConnectSendMessage({payload, privateKey});
      break;
    case TON_SIGN_DATA:
      tx = await TonWalletConnectSignData({signTypeData, privateKey});
      break;
    default:
      break;
  }
  return tx;
};
