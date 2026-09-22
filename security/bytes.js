// Byte helpers shared by the vault core and both platform crypto adapters.
// Everything crosses the adapter boundary as Uint8Array; strings are only
// ever base64 (envelopes) or utf8 (plaintext), and the conversions live here so
// neither adapter grows its own slightly different copy.
import {Buffer} from 'buffer';

export const toUint8 = value => {
  if (value instanceof Uint8Array) {
    // Buffer is a Uint8Array subclass; normalise to a plain view so WebCrypto
    // and quick-crypto both accept it without re-wrapping.
    return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  }
  if (value instanceof ArrayBuffer) {
    return new Uint8Array(value);
  }
  if (ArrayBuffer.isView(value)) {
    return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  }
  throw new TypeError('Expected bytes (Uint8Array | ArrayBuffer)');
};

export const utf8Encode = text => toUint8(Buffer.from(String(text), 'utf8'));

export const utf8Decode = bytes => Buffer.from(toUint8(bytes)).toString('utf8');

export const base64Encode = bytes =>
  Buffer.from(toUint8(bytes)).toString('base64');

export const base64Decode = text => {
  if (typeof text !== 'string') {
    throw new TypeError('Expected base64 string');
  }
  return toUint8(Buffer.from(text, 'base64'));
};

export const concatBytes = (...parts) => {
  const views = parts.map(toUint8);
  const total = views.reduce((n, v) => n + v.byteLength, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const view of views) {
    out.set(view, offset);
    offset += view.byteLength;
  }
  return out;
};

// Constant-time equality for short secrets (tags, hashes). Length mismatch
// returns false immediately; lengths are not secret here.
export const bytesEqual = (a, b) => {
  const x = toUint8(a);
  const y = toUint8(b);
  if (x.byteLength !== y.byteLength) {
    return false;
  }
  let diff = 0;
  for (let i = 0; i < x.byteLength; i++) {
    diff |= x[i] ^ y[i];
  }
  return diff === 0;
};

// Best-effort zeroisation of key material once it leaves scope. JS engines may
// keep copies, so this reduces exposure rather than guaranteeing erasure.
export const zeroBytes = bytes => {
  if (bytes && typeof bytes.fill === 'function') {
    bytes.fill(0);
  }
};
