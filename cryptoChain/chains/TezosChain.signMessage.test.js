/**
 * tezos_sign → TezosChain.signMessage. The first payload byte is the
 * watermark: 0x03 is an operation, 0x01/0x02/0x11-0x13 are block and
 * consensus messages; those are refused. 0x05 (Micheline, what sign-in
 * messages use) and raw bytes are signed.
 *
 * Runner: node-env jest config (image moduleNameMapper).
 */
import {Buffer} from 'buffer';
import {b58Encode, PrefixV2, verifySignature} from '@taquito/utils';
import {InMemorySigner} from '@taquito/signer';
import {TezosChain} from 'dok-wallet-blockchain-networks/cryptoChain/chains/TezosChain';

jest.mock('dok-wallet-blockchain-networks/service/tzkt', () => ({Tzkt: {}}));
jest.mock('dok-wallet-blockchain-networks/rpcUrls/rpcUrls', () => ({
  getRPCUrl: jest.fn(() => 'http://localhost'),
}));
jest.mock('dok-wallet-blockchain-networks/helper', () => ({
  fetchRequest: jest.fn(),
  getExplorerTxUrl: jest.fn(),
  parseBalance: jest.fn(v => v),
}));

const privateKey = b58Encode(new Uint8Array(32).fill(7), PrefixV2.Ed25519Seed);
const hex = text => Buffer.from(text).toString('hex');
// Micheline-packed string: 05 01 <4-byte length> <utf-8>.
const micheline = text =>
  '0501' + Buffer.from(text).length.toString(16).padStart(8, '0') + hex(text);

const sign = payload =>
  TezosChain().signMessage({
    signTypeData: {account: 'tz1…', payload},
    privateKey,
  });

describe('TezosChain.signMessage', () => {
  let publicKey;
  beforeAll(async () => {
    publicKey = await (
      await InMemorySigner.fromSecretKey(privateKey)
    ).publicKey();
  });
  beforeEach(() => {
    jest.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => {
    console.error.mockRestore();
  });

  it('signs a Micheline (05) sign-in message', async () => {
    const payload = micheline('Tezos Signed Message: example.com 2026-11-27');
    const {signature} = await sign(payload);
    expect(verifySignature(payload, publicKey, signature)).toBe(true);
  });

  it('signs raw text bytes', async () => {
    const payload = hex('hello');
    const {signature} = await sign(payload);
    expect(verifySignature(payload, publicKey, signature)).toBe(true);
  });

  it.each(['03', '01', '02', '11', '12', '13'])(
    'refuses a payload starting with watermark %s',
    async watermark => {
      await expect(sign(watermark + 'ab'.repeat(40))).rejects.toThrow(
        /not a message/i,
      );
    },
  );

  it('refuses an operation payload given with a 0x prefix or in an array', async () => {
    await expect(sign('0x03' + 'ab'.repeat(40))).rejects.toThrow(
      /not a message/i,
    );
    await expect(
      TezosChain().signMessage({
        signTypeData: [{payload: '03' + 'ab'.repeat(40)}],
        privateKey,
      }),
    ).rejects.toThrow(/not a message/i);
  });
});
