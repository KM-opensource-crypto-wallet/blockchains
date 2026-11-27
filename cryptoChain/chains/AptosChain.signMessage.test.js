/**
 * aptos_signMessage → AptosChain.signMessage. Per AIP-62 (what Petra does)
 * the wallet signs the UTF-8 text "APTOS\n[address: …\n][application: …\n]
 * [chainId: …\n]message: …\nnonce: …" and returns it as `fullMessage`, which
 * the dApp verifies against.
 *
 * Runner: node-env jest config (image moduleNameMapper).
 */
import {Buffer} from 'buffer';
import {Account, Ed25519PrivateKey, Ed25519Signature} from '@aptos-labs/ts-sdk';
import {AptosChain} from 'dok-wallet-blockchain-networks/cryptoChain/chains/AptosChain';

jest.mock('dok-wallet-blockchain-networks/helper', () => ({
  convertToSmallAmount: jest.fn(),
  fetchRequest: jest.fn(),
  getExplorerTxUrl: jest.fn(),
  parseBalance: jest.fn(v => v),
  validateNumber: jest.fn(),
}));
jest.mock('dok-wallet-blockchain-networks/config/config', () => ({
  IS_SANDBOX: false,
}));
jest.mock('dok-wallet-blockchain-networks/rpcUrls/rpcUrls', () => ({
  getRPCUrl: jest.fn(() => 'http://localhost'),
}));

const privateKey = '0x' + '07'.repeat(32);
const account = Account.fromPrivateKey({
  privateKey: new Ed25519PrivateKey(privateKey),
  legacy: true,
});
const address = account.accountAddress.toString();

const verifies = (bytes, signature) =>
  account.publicKey.verifySignature({
    message: bytes,
    signature: new Ed25519Signature(signature),
  });

const sign = (signTypeData, extra = {}) =>
  AptosChain().signMessage({
    signTypeData,
    privateKey,
    chainId: 'aptos:1',
    domain: 'https://dapp.example/swap?x=1',
    ...extra,
  });

describe('AptosChain.signMessage', () => {
  beforeEach(() => {
    jest.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => {
    console.error.mockRestore();
  });

  it('signs the APTOS full message for {message, nonce}', async () => {
    const result = await sign({message: 'hello', nonce: '42'});
    expect(result.fullMessage).toBe('APTOS\nmessage: hello\nnonce: 42');
    expect(result).toMatchObject({
      address,
      message: 'hello',
      nonce: '42',
      prefix: 'APTOS',
    });
    expect(
      verifies(Buffer.from(result.fullMessage, 'utf8'), result.signature),
    ).toBe(true);
  });

  it('adds address, application origin and chain id when asked', async () => {
    const result = await sign({
      message: 'hello',
      nonce: '42',
      address: true,
      application: true,
      chainId: true,
    });
    expect(result.fullMessage).toBe(
      `APTOS\naddress: ${address}\napplication: https://dapp.example\nchainId: 1\nmessage: hello\nnonce: 42`,
    );
    expect(result).toMatchObject({
      application: 'https://dapp.example',
      chainId: 1,
    });
    expect(
      verifies(Buffer.from(result.fullMessage, 'utf8'), result.signature),
    ).toBe(true);
  });

  it('never signs the raw bytes it is given', async () => {
    const rawBytes =
      '0xb5e97db07fa0bd0e5598aa3643a9bc6f6693bddc1a9fec9e674a461eaa00b193' +
      'ab'.repeat(40);
    const result = await sign(rawBytes);
    expect(result.fullMessage.startsWith('APTOS\nmessage: 0xb5e97db0')).toBe(
      true,
    );
    expect(
      verifies(Buffer.from(rawBytes.slice(2), 'hex'), result.signature),
    ).toBe(false);
  });

  it('rejects a request without a text message', async () => {
    await expect(
      Promise.resolve().then(() => sign({message: {x: 1}, nonce: '1'})),
    ).rejects.toThrow(/message must be a string/);
  });
});
