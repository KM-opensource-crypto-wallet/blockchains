import {hexlify, keccak256, toUtf8Bytes} from 'ethers';
import {
  getPersonalSignBytes,
  reviewEvmSignMessage,
} from 'dok-wallet-blockchain-networks/helper/evmSignReview';

const hexOf = text => hexlify(toUtf8Bytes(text));

describe('getPersonalSignBytes', () => {
  it('signs hex strings as raw bytes and anything else as UTF-8', () => {
    expect(getPersonalSignBytes('0x00ff')).toEqual(new Uint8Array([0, 255]));
    expect(getPersonalSignBytes('hi')).toEqual(toUtf8Bytes('hi'));
  });
});

describe('reviewEvmSignMessage', () => {
  it('flags a 32-byte hex hash as digest-sized and unreadable', () => {
    expect(reviewEvmSignMessage(keccak256(toUtf8Bytes('anything')))).toEqual({
      digestSized: true,
      readable: false,
    });
  });

  it('treats a hex-encoded sign-in message as readable text', () => {
    expect(
      reviewEvmSignMessage(hexOf('Sign in to example.com\nNonce: 4242')),
    ).toEqual({digestSized: false, readable: true});
  });

  it('measures plain text by its UTF-8 bytes', () => {
    const text = 'a'.repeat(32);
    expect(reviewEvmSignMessage(text)).toEqual({
      digestSized: true,
      readable: true,
    });
  });

  it('treats control characters other than whitespace as unreadable', () => {
    expect(reviewEvmSignMessage('0x0102').readable).toBe(false);
    expect(reviewEvmSignMessage('0x09410a42').readable).toBe(true);
  });

  it('treats invisible formatting and bidi characters as unreadable', () => {
    [
      'Sign in​to example.com', // zero-width space
      'Approve ‮txt.exe', // right-to-left override
      'Pay ⁦100⁩ USDC', // bidi isolate
      'Sign in‏to example.com', // right-to-left mark
      '﻿Sign in', // BOM
      'Sign­in', // soft hyphen
      'Sign in \u{E0041}', // tag character
    ].forEach(text => {
      expect(reviewEvmSignMessage(text).readable).toBe(false);
      expect(reviewEvmSignMessage(hexOf(text)).readable).toBe(false);
    });
  });

  it('keeps non-ASCII text, emoji ZWJ sequences and ZWNJ readable', () => {
    [
      'Connexion à example.com',
      '登录 example.com',
      'Hi 👨‍👩‍👧',
      'می‌خواهم',
    ].forEach(text => {
      expect(reviewEvmSignMessage(text).readable).toBe(true);
    });
  });

  it('never throws on malformed hex', () => {
    expect(reviewEvmSignMessage('0xabc')).toEqual({
      digestSized: false,
      readable: false,
    });
  });
});
