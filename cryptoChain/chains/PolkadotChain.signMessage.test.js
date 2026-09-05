/**
 * polkadot_signMessage byte construction. Uses the real @polkadot/util,
 * @polkadot/keyring and @polkadot/util-crypto so the signed bytes are
 * observable; only network/config modules are stubbed.
 *
 * Runner: node-env jest config (image moduleNameMapper), like HederaChain.
 *
 * Assertions use ed25519Verify directly rather than signatureVerify, because
 * signatureVerify tries both the wrapped and unwrapped message and would hide
 * a double-wrap regression.
 */
import {Buffer} from 'buffer';
import {u8aToU8a, u8aWrapBytes, hexToU8a} from '@polkadot/util';
import {cryptoWaitReady, ed25519Verify} from '@polkadot/util-crypto';

jest.mock('@polkadot/api', () => ({
  ApiPromise: {create: jest.fn()},
  WsProvider: jest.fn(),
}));

jest.mock(
  'dok-wallet-blockchain-networks/rpcUrls/polkadotHttpProvider',
  () => ({PolkadotHttpProvider: jest.fn()}),
);

jest.mock('dok-wallet-blockchain-networks/helper', () => ({
  convertToSmallAmount: jest.fn(value => value),
  parseBalance: jest.fn(value => value),
  getExplorerTxUrl: jest.fn(),
}));

jest.mock('dok-wallet-blockchain-networks/service/PolkadotScan', () => ({
  PolkadotScan: {},
}));

jest.mock('dok-wallet-blockchain-networks/rpcUrls/rpcUrls', () => ({
  getPremiumRPCUrl: jest.fn(() => 'https://api.test/rpc/polkadot'),
  getFreeRPCUrl: jest.fn(() => []),
}));

const {PolkadotChain} = require('./PolkadotChain');
const {Keyring} = require('@polkadot/keyring');

// 32-byte ed25519 seed (Keyring default type is ed25519).
const privateKey = '11'.repeat(32);
// Spec example: hex of "<Bytes>hello world</Bytes>".
const WRAPPED_HEX = '0x3c42797465733e68656c6c6f20776f726c643c2f42797465733e';
const UNWRAPPED_HEX = '0x68656c6c6f'; // "hello"

let publicKey;
const verifies = (bytes, signatureHex) =>
  ed25519Verify(u8aToU8a(bytes), hexToU8a(signatureHex), publicKey);

beforeAll(async () => {
  await cryptoWaitReady();
  const keyring = new Keyring({ss58Format: 0});
  publicKey = keyring.addFromSeed(Buffer.from(privateKey, 'hex')).publicKey;
});

describe('polkadot_signMessage → signMessage', () => {
  it('signs pre-wrapped hex data exactly once (spec example)', async () => {
    const {signature} = await PolkadotChain().signMessage({
      signTypeData: {message: WRAPPED_HEX, type: 'bytes'},
      privateKey,
    });
    expect(signature).toMatch(/^0x[0-9a-f]{128}$/);

    // What a dApp verifies against: the decoded bytes, already wrapped.
    expect(verifies(hexToU8a(WRAPPED_HEX), signature)).toBe(true);
    // Must not be wrapped a second time...
    expect(
      verifies(
        Buffer.concat([
          Buffer.from('<Bytes>'),
          Buffer.from(hexToU8a(WRAPPED_HEX)),
          Buffer.from('</Bytes>'),
        ]),
        signature,
      ),
    ).toBe(false);
    // ...and must not sign the ASCII of the hex string (old behaviour).
    expect(verifies(u8aWrapBytes(Buffer.from(WRAPPED_HEX)), signature)).toBe(
      false,
    );
  });

  it('wraps unwrapped hex data in <Bytes> when type is omitted', async () => {
    const {signature} = await PolkadotChain().signMessage({
      signTypeData: {message: UNWRAPPED_HEX},
      privateKey,
    });
    expect(verifies(Buffer.from('<Bytes>hello</Bytes>'), signature)).toBe(true);
    expect(verifies(Buffer.from('hello'), signature)).toBe(false);
    expect(
      verifies(Buffer.from(`<Bytes>${UNWRAPPED_HEX}</Bytes>`), signature),
    ).toBe(false);
  });

  it("signs type 'payload' data raw, without a <Bytes> wrapper", async () => {
    const {signature} = await PolkadotChain().signMessage({
      signTypeData: {message: UNWRAPPED_HEX, type: 'payload'},
      privateKey,
    });
    expect(verifies(Buffer.from('hello'), signature)).toBe(true);
    expect(verifies(Buffer.from('<Bytes>hello</Bytes>'), signature)).toBe(
      false,
    );
  });

  it('still accepts a bare plain-text string and wraps it', async () => {
    const {signature} = await PolkadotChain().signMessage({
      signTypeData: 'hello',
      privateKey,
    });
    expect(verifies(Buffer.from('<Bytes>hello</Bytes>'), signature)).toBe(true);
  });

  it('rejects a non-string message', async () => {
    await expect(
      PolkadotChain().signMessage({
        signTypeData: {message: {text: 'x'}},
        privateKey,
      }),
    ).rejects.toThrow(/must be a string/);
    await expect(
      PolkadotChain().signMessage({signTypeData: {}, privateKey}),
    ).rejects.toThrow(/must be a string/);
  });
});
