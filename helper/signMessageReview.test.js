/**
 * Readability of non-EVM WalletConnect sign-message requests, so the review
 * screen can show the same "unreadable code" warning + acknowledgement as
 * for personal_sign.
 *
 *   npx jest dok-wallet-blockchain-networks/helper/signMessageReview.test.js
 */
import {Buffer} from 'buffer';
import bs58 from 'bs58';
import {reviewNonEvmSignMessage} from 'dok-wallet-blockchain-networks/helper/signMessageReview';

const hex = text => Buffer.from(text).toString('hex');
const micheline = text =>
  '0501' + Buffer.from(text).length.toString(16).padStart(8, '0') + hex(text);
const BINARY = Buffer.from([0x01, 0x00, 0xff, 0x13, 0x80, 0x02]);

describe('reviewNonEvmSignMessage', () => {
  it('returns null for methods it does not review', () => {
    expect(reviewNonEvmSignMessage('tron_signMessage', 'hi')).toBeNull();
    expect(reviewNonEvmSignMessage('solana_signTransaction', {})).toBeNull();
  });

  it.each([
    ['solana_signMessage', bs58.encode(Buffer.from('Sign in to example.com'))],
    ['polkadot_signMessage', {message: '0x' + hex('<Bytes>hello</Bytes>')}],
    ['polkadot_signMessage', {message: 'plain text'}],
    ['tezos_sign', {payload: micheline('Tezos Signed Message: hi')}],
    ['tezos_sign', [{payload: hex('hello')}]],
    ['aptos_signMessage', {message: 'Welcome to the dApp', nonce: '1'}],
    ['aptos_signMessage', 'Welcome'],
  ])('reads %s text as readable', (method, signTypeData) => {
    expect(reviewNonEvmSignMessage(method, signTypeData)).toEqual({
      digestSized: false,
      readable: true,
    });
  });

  it.each([
    ['solana_signMessage', bs58.encode(BINARY)],
    ['solana_signMessage', 'not-base58-0OIl'],
    ['polkadot_signMessage', {message: '0x' + BINARY.toString('hex')}],
    ['tezos_sign', {payload: BINARY.toString('hex')}],
    ['tezos_sign', {payload: undefined}],
    ['aptos_signMessage', {message: 'a‮b', nonce: '1'}],
    ['aptos_signMessage', {message: {x: 1}}],
  ])('flags %s binary or hidden content as unreadable', (method, data) => {
    expect(reviewNonEvmSignMessage(method, data)).toEqual({
      digestSized: false,
      readable: false,
    });
  });
});
