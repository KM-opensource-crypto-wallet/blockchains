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
import {keyPairFromSeed, sign, sha256_sync} from '@ton/crypto';
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
    throw e;
  }
};

const getDomainFromUrl = url => {
  return (url || '').replace(/^[a-zA-Z]+:\/\//, '').split(/[/?#]/)[0];
};

// message = 0xffff || "ton-connect/sign-data/" || workchain || address_hash
//   || domain_len || domain || timestamp || type_prefix || payload_len || payload
const createTextBinaryHash = ({
  type,
  content,
  workChain,
  addressHash,
  domain,
  timestamp,
}) => {
  const wcBuffer = Buffer.alloc(4);
  wcBuffer.writeInt32BE(workChain);

  const domainBuffer = Buffer.from(domain, 'utf8');
  const domainLenBuffer = Buffer.alloc(4);
  domainLenBuffer.writeUInt32BE(domainBuffer.length);

  const tsBuffer = Buffer.alloc(8);
  tsBuffer.writeBigUInt64BE(BigInt(timestamp));

  const typePrefix = Buffer.from(type === 'text' ? 'txt' : 'bin');
  const payloadBuffer = Buffer.from(
    content,
    type === 'text' ? 'utf8' : 'base64',
  );
  const payloadLenBuffer = Buffer.alloc(4);
  payloadLenBuffer.writeUInt32BE(payloadBuffer.length);

  const message = Buffer.concat([
    Buffer.from([0xff, 0xff]),
    Buffer.from('ton-connect/sign-data/'),
    wcBuffer,
    addressHash,
    domainLenBuffer,
    domainBuffer,
    tsBuffer,
    typePrefix,
    payloadLenBuffer,
    payloadBuffer,
  ]);

  return sha256_sync(message);
};

export const TonWalletConnectSignData = async ({
  signTypeData,
  privateKey,
  domain,
}) => {
  try {
    const data = Array.isArray(signTypeData) ? signTypeData[0] : signTypeData;
    const keyPair = keyPairFromSeed(Buffer.from(privateKey, 'hex'));
    const wallet = WalletContractV4.create({
      publicKey: keyPair.publicKey,
      workchain: 0,
    });
    const timestamp = Math.floor(Date.now() / 1000);
    const parsedDomain = getDomainFromUrl(domain);
    let messageHash;
    if (data?.type === 'text' || data?.type === 'binary') {
      messageHash = createTextBinaryHash({
        type: data.type,
        content: data.type === 'text' ? data.text : data.bytes,
        workChain: wallet.address.workChain,
        addressHash: wallet.address.hash,
        domain: parsedDomain,
        timestamp,
      });
    } else {
      throw new Error('Unsupported ton_signData type');
    }
    const signature = sign(messageHash, keyPair.secretKey);
    return {
      signature: Buffer.from(signature).toString('base64'),
      address: wallet.address.toString(),
      timestamp,
      domain: parsedDomain,
      payload: data,
    };
  } catch (e) {
    console.error('Error in TonWalletConnectSignData', e);
    throw e;
  }
};

export const tonWalletConnectTransaction = async (
  method,
  payload,
  privateKey,
  signTypeData,
  domain,
) => {
  let tx = null;
  switch (method) {
    case TON_SEND_MESSAGE:
      tx = await TonWalletConnectSendMessage({payload, privateKey});
      break;
    case TON_SIGN_DATA:
      tx = await TonWalletConnectSignData({signTypeData, privateKey, domain});
      break;
    default:
      break;
  }
  return tx;
};
