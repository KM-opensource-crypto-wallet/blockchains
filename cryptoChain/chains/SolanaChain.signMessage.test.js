/**
 * solana_signMessage → SolanaChain.signMessage. Text is signed as-is; bytes
 * that are a transaction message for this wallet are refused, as Phantom and
 * Solflare do.
 *
 * Runner: node-env jest config (same as SolanaChain.signAllTransactions).
 */
import {
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionMessage,
} from '@solana/web3.js';
import bs58 from 'bs58';
import nacl from 'tweetnacl';
import {Buffer} from 'buffer';
import {SolanaChain} from 'dok-wallet-blockchain-networks/cryptoChain/chains/SolanaChain';

jest.mock('dok-wallet-blockchain-networks/config/config', () => ({
  IS_SANDBOX: true,
  config: {},
}));
jest.mock('dok-wallet-blockchain-networks/helper', () => ({
  convertToSmallAmount: jest.fn(),
  customFetchWithTimeout: jest.fn(),
  differentInCurrentTime: jest.fn(),
  getExplorerTxUrl: jest.fn(),
  isSwapBlockingError: jest.fn(),
  isValidStringWithValue: jest.fn(),
  parseBalance: jest.fn(v => v),
  SWAP_QUOTE_EXPIRED_ERROR: 'expired',
}));
jest.mock('dok-wallet-blockchain-networks/rpcUrls/rpcSession', () => ({
  withRpcSessionFetch: jest.fn(f => f),
}));
jest.mock('dok-wallet-blockchain-networks/rpcUrls/rpcUrls', () => ({
  getRPCUrl: jest.fn(() => 'http://localhost'),
  getFreeRPCUrl: jest.fn(() => 'http://localhost'),
}));
jest.mock('dok-wallet-blockchain-networks/service/solflare', () => ({
  getSolanaContract: jest.fn(),
}));
jest.mock('dok-wallet-blockchain-networks/service/dokApi', () => ({
  getStakingByChain: jest.fn(),
}));
jest.mock('dok-wallet-blockchain-networks/service/stakeWiz', () => ({
  StakeWiz: {},
}));
jest.mock('nanoid', () => ({nanoid: () => 'test-id'}));

const signer = Keypair.fromSeed(Uint8Array.from({length: 32}, () => 7));
const other = Keypair.fromSeed(Uint8Array.from({length: 32}, () => 8));
const privateKey = bs58.encode(signer.secretKey);
const recipient = new PublicKey('11111111111111111111111111111112');
const recentBlockhash = bs58.encode(Uint8Array.from({length: 32}, () => 9));

const transfer = (from, payer) =>
  new TransactionMessage({
    payerKey: payer,
    recentBlockhash,
    instructions: [
      SystemProgram.transfer({
        fromPubkey: from,
        toPubkey: recipient,
        lamports: 1000000000,
      }),
    ],
  });

const sign = message =>
  SolanaChain().signMessage({signTypeData: message, privateKey});

describe('SolanaChain.signMessage', () => {
  beforeEach(() => {
    jest.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => {
    console.error.mockRestore();
  });

  it('signs a plain-text message', async () => {
    const text = Buffer.from('Sign in to example.com\nNonce: 12345');
    const {signature} = await sign(bs58.encode(text));
    expect(
      nacl.sign.detached.verify(
        text,
        bs58.decode(signature),
        signer.publicKey.toBytes(),
      ),
    ).toBe(true);
  });

  it('refuses a legacy transaction message paid by this wallet', async () => {
    const bytes = transfer(signer.publicKey, signer.publicKey)
      .compileToLegacyMessage()
      .serialize();
    await expect(sign(bs58.encode(bytes))).rejects.toThrow(/transaction/i);
  });

  it('refuses a v0 transaction message paid by this wallet', async () => {
    const bytes = transfer(signer.publicKey, signer.publicKey)
      .compileToV0Message()
      .serialize();
    await expect(sign(bs58.encode(bytes))).rejects.toThrow(/transaction/i);
  });

  it('refuses a transaction message where this wallet is a second signer', async () => {
    const bytes = transfer(signer.publicKey, other.publicKey)
      .compileToLegacyMessage()
      .serialize();
    await expect(sign(bs58.encode(bytes))).rejects.toThrow(/transaction/i);
  });

  it('refuses the message bytes of a legacy Transaction', async () => {
    const tx = new Transaction({
      feePayer: signer.publicKey,
      recentBlockhash,
    }).add(
      SystemProgram.transfer({
        fromPubkey: signer.publicKey,
        toPubkey: recipient,
        lamports: 1,
      }),
    );
    await expect(sign(bs58.encode(tx.serializeMessage()))).rejects.toThrow(
      /transaction/i,
    );
  });
});
