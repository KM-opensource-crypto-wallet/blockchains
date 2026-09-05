/**
 * SolanaChain.sendRawTransaction (solana_signAndSendTransaction): the wallet
 * must add its signature to the dApp's transaction, not rebuild the
 * transaction from its message, which would zero every signature slot and
 * drop a co-signer's signature before broadcast.
 *
 * Runner: node-env jest config (same as SolanaChain.signAllTransactions).
 */
import {Buffer} from 'buffer';
import {
  Connection,
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
  getPremiumRPCUrl: jest.fn(() => 'http://localhost'),
  getFreeRPCUrl: jest.fn(() => []),
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

// Our wallet, and a dApp-side co-signer that pays the fee.
const wallet = Keypair.fromSeed(Uint8Array.from({length: 32}, () => 7));
const coSigner = Keypair.fromSeed(Uint8Array.from({length: 32}, () => 3));
const privateKey = bs58.encode(wallet.secretKey);
const recipient = new PublicKey('11111111111111111111111111111112');
const recentBlockhash = bs58.encode(Uint8Array.from({length: 32}, () => 9));

// Two required signers: coSigner (fee payer, slot 0) and wallet (slot 1).
// The dApp signs its own slot first, as a partially signed multi-signer
// transaction would arrive over WalletConnect.
const buildPartiallySignedTxBase64 = () => {
  const message = new TransactionMessage({
    payerKey: coSigner.publicKey,
    recentBlockhash,
    instructions: [
      SystemProgram.transfer({
        fromPubkey: wallet.publicKey,
        toPubkey: recipient,
        lamports: 1000,
      }),
    ],
  }).compileToV0Message();
  const tx = new VersionedTransaction(message);
  tx.sign([coSigner]);
  return Buffer.from(tx.serialize()).toString('base64');
};

const verifies = (tx, index, publicKey) =>
  nacl.sign.detached.verify(
    tx.message.serialize(),
    tx.signatures[index],
    publicKey.toBytes(),
  );

describe('SolanaChain.sendRawTransaction (solana_signAndSendTransaction)', () => {
  let sendTransaction;
  beforeEach(() => {
    jest.spyOn(console, 'error').mockImplementation(() => {});
    jest.spyOn(console, 'log').mockImplementation(() => {});
    sendTransaction = jest
      .spyOn(Connection.prototype, 'sendTransaction')
      .mockResolvedValue('broadcast-signature');
  });
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('adds the wallet signature while keeping the co-signer signature already on the transaction', async () => {
    const transaction = buildPartiallySignedTxBase64();
    const {signature} = await SolanaChain().sendRawTransaction({
      payload: {signTypeData: {transaction}},
      privateKey,
    });
    expect(signature).toBe('broadcast-signature');

    expect(sendTransaction).toHaveBeenCalledTimes(1);
    const [sent, options] = sendTransaction.mock.calls[0];
    expect(sent).toBeInstanceOf(VersionedTransaction);
    expect(options).toMatchObject({skipPreflight: true});

    // Both required signatures are present and valid for the same message.
    expect(sent.message.header.numRequiredSignatures).toBe(2);
    expect(sent.message.staticAccountKeys[0].equals(coSigner.publicKey)).toBe(
      true,
    );
    expect(sent.message.staticAccountKeys[1].equals(wallet.publicKey)).toBe(
      true,
    );
    expect(verifies(sent, 0, coSigner.publicKey)).toBe(true);
    expect(verifies(sent, 1, wallet.publicKey)).toBe(true);
    // Rebuilding from `.message` would have left slot 0 all zeros.
    expect(sent.signatures[0].some(b => b !== 0)).toBe(true);
  });
});
