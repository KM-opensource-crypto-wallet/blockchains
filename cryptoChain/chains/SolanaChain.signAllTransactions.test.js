import {
  Keypair,
  PublicKey,
  SystemProgram,
  TransactionMessage,
  VersionedTransaction,
} from '@solana/web3.js';
import bs58 from 'bs58';
import nacl from 'tweetnacl';
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

// Deterministic signer so failures reproduce.
const signer = Keypair.fromSeed(Uint8Array.from({length: 32}, () => 7));
const privateKey = bs58.encode(signer.secretKey);
const recipient = new PublicKey('11111111111111111111111111111112');
const recentBlockhash = bs58.encode(Uint8Array.from({length: 32}, () => 9));

// Mirrors what a dApp sends for solana_signAllTransactions: one unsigned,
// base64-serialized VersionedTransaction per entry.
const buildUnsignedTxBase64 = lamports => {
  const message = new TransactionMessage({
    payerKey: signer.publicKey,
    recentBlockhash,
    instructions: [
      SystemProgram.transfer({
        fromPubkey: signer.publicKey,
        toPubkey: recipient,
        lamports,
      }),
    ],
  }).compileToV0Message();
  // eslint-disable-next-line no-undef
  return Buffer.from(new VersionedTransaction(message).serialize()).toString(
    'base64',
  );
};

const decode = base64 =>
  // eslint-disable-next-line no-undef
  VersionedTransaction.deserialize(Buffer.from(base64, 'base64'));

const hasValidSignature = tx =>
  nacl.sign.detached.verify(
    tx.message.serialize(),
    tx.signatures[0],
    signer.publicKey.toBytes(),
  );

describe('SolanaChain.signAllTransactions (solana_signAllTransactions)', () => {
  beforeEach(() => {
    jest.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => {
    console.error.mockRestore();
  });

  it('signs every transaction and returns them base64-encoded in the same order', async () => {
    const first = buildUnsignedTxBase64(1000);
    const second = buildUnsignedTxBase64(2000);

    const result = await SolanaChain().signAllTransactions({
      payload: {signTypeData: {transactions: [first, second]}},
      privateKey,
    });

    expect(result.transactions).toHaveLength(2);
    const [signedFirst, signedSecond] = result.transactions.map(decode);
    expect(hasValidSignature(signedFirst)).toBe(true);
    expect(hasValidSignature(signedSecond)).toBe(true);
    // Order preserved: message bytes match the unsigned inputs.
    expect(signedFirst.message.serialize()).toEqual(
      decode(first).message.serialize(),
    );
    expect(signedSecond.message.serialize()).toEqual(
      decode(second).message.serialize(),
    );
  });

  it('rejects when no transactions are provided', async () => {
    await expect(
      SolanaChain().signAllTransactions({
        payload: {signTypeData: {transactions: []}},
        privateKey,
      }),
    ).rejects.toThrow('No transactions to sign');
  });
});
