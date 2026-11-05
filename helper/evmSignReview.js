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

// Invisible formatting characters that hide or reorder what the user reads:
// soft hyphen, Arabic letter mark, Mongolian vowel separator, zero-width
// space, LRM/RLM, bidi embeddings/overrides/isolates, word joiner and
// invisible operators, BOM and tag characters. ZWNJ/ZWJ (U+200C/U+200D) stay
// allowed: they only shape scripts and emoji sequences.
const isInvisibleFormat = code =>
  code === 0xad ||
  code === 0x61c ||
  code === 0x180e ||
  code === 0x200b ||
  code === 0x200e ||
  code === 0x200f ||
  (code >= 0x202a && code <= 0x202e) ||
  (code >= 0x2060 && code <= 0x2064) ||
  (code >= 0x2066 && code <= 0x206f) ||
  code === 0xfeff ||
  (code >= 0xe0000 && code <= 0xe007f);

// Tabs and line breaks are fine; other C0/C1 control characters and invisible
// formatting characters are not readable text.
const isPrintable = text => {
  for (const char of text) {
    const code = char.codePointAt(0);
    const isControl =
      (code < 0x20 && char !== '\n' && char !== '\r' && char !== '\t') ||
      (code >= 0x7f && code <= 0x9f);
    if (isControl || isInvisibleFormat(code)) {
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
