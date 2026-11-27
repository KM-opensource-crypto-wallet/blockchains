/*
 * Review of a non-EVM WalletConnect sign-message request (pure, never
 * throws): {digestSized, readable}, the shape of reviewEvmSignMessage, so the
 * review screen shows the same "unreadable code" warning and acknowledgement.
 * Decodes the bytes each chain actually signs: Solana base58, Polkadot hex or
 * text (without the <Bytes> wrapper), a Tezos Micheline string or raw hex
 * payload, and the Aptos message text.
 */
import bs58 from 'bs58';
import {getBytes, isHexString, toUtf8Bytes, toUtf8String} from 'ethers';
import {isPrintable} from 'dok-wallet-blockchain-networks/helper/evmSignReview';

const firstOf = data => (Array.isArray(data) ? data[0] : data);
const withHexPrefix = value =>
  value.startsWith('0x') || value.startsWith('0X') ? value : `0x${value}`;

const isReadableBytes = bytes => {
  try {
    return isPrintable(toUtf8String(bytes));
  } catch (e) {
    return false;
  }
};

const unwrapPolkadotBytes = text =>
  text.startsWith('<Bytes>') && text.endsWith('</Bytes>')
    ? text.slice('<Bytes>'.length, -'</Bytes>'.length)
    : text;

const readable = {
  solana_signMessage: message => isReadableBytes(bs58.decode(message)),
  polkadot_signMessage: data => {
    const message = data?.message ?? data;
    const bytes = isHexString(message)
      ? getBytes(message)
      : toUtf8Bytes(message);
    const text = toUtf8String(bytes);
    return isPrintable(unwrapPolkadotBytes(text));
  },
  tezos_sign: data => {
    const payload = firstOf(data)?.payload ?? firstOf(data);
    const bytes = getBytes(withHexPrefix(payload));
    // Micheline-packed string: 05 01 <4-byte length> <utf-8>.
    if (bytes[0] === 0x05 && bytes[1] === 0x01 && bytes.length >= 6) {
      const length =
        bytes[2] * 2 ** 24 + bytes[3] * 2 ** 16 + bytes[4] * 2 ** 8 + bytes[5];
      if (length === bytes.length - 6) {
        return isReadableBytes(bytes.slice(6));
      }
    }
    return isReadableBytes(bytes);
  },
  aptos_signMessage: data => {
    const message = typeof data === 'string' ? data : data?.message;
    return typeof message === 'string' && isPrintable(message);
  },
};

export const reviewNonEvmSignMessage = (method, signTypeData) => {
  const check = readable[method];
  if (!check) {
    return null;
  }
  let isReadable = false;
  try {
    isReadable = check(signTypeData) === true;
  } catch (e) {
    isReadable = false;
  }
  return {digestSized: false, readable: isReadable};
};
