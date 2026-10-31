/*
 * Review of a WalletConnect personal_sign / eth_sign message (pure, never
 * throws). EVMChain.personalSign signs the EIP-191 prefixed bytes of the
 * message: a hex string as raw bytes, anything else as UTF-8. A message of
 * exactly 32 bytes has the shape of a hash, which the user cannot read and
 * which a contract may accept as approval of something else.
 */
import {getBytes, isHexString, toUtf8Bytes, toUtf8String} from 'ethers';

export const EVM_MESSAGE_SIGN_METHODS = ['personal_sign', 'eth_sign'];

const DIGEST_LENGTH = 32;

export const getPersonalSignBytes = message =>
  isHexString(message) ? getBytes(message) : toUtf8Bytes(String(message));

// Tabs and line breaks are fine; other C0/C1 control characters are not text.
const isPrintable = text => {
  for (const char of text) {
    const code = char.codePointAt(0);
    const isControl =
      (code < 0x20 && char !== '\n' && char !== '\r' && char !== '\t') ||
      (code >= 0x7f && code <= 0x9f);
    if (isControl) {
      return false;
    }
  }
  return true;
};

// {digestSized, readable}: digestSized when exactly 32 bytes are signed,
// readable when those bytes are printable UTF-8 text.
export const reviewEvmSignMessage = message => {
  let bytes;
  try {
    bytes = getPersonalSignBytes(message);
  } catch (e) {
    return {digestSized: false, readable: false};
  }
  let readable = false;
  try {
    readable = isPrintable(toUtf8String(bytes));
  } catch (e) {
    readable = false;
  }
  return {digestSized: bytes.length === DIGEST_LENGTH, readable};
};
