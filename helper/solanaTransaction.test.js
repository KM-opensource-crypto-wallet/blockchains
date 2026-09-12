import {
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionMessage,
  VersionedTransaction,
} from '@solana/web3.js';
import bs58 from 'bs58';
import {getSolanaFeePayer} from 'dok-wallet-blockchain-networks/helper/solanaTransaction';

const payer = Keypair.fromSeed(Uint8Array.from({length: 32}, () => 5));
const recipient = new PublicKey('11111111111111111111111111111112');
const recentBlockhash = bs58.encode(Uint8Array.from({length: 32}, () => 9));
const transfer = SystemProgram.transfer({
  fromPubkey: payer.publicKey,
  toPubkey: recipient,
  lamports: 1000,
});
// eslint-disable-next-line no-undef
const toBase64 = bytes => Buffer.from(bytes).toString('base64');

describe('getSolanaFeePayer', () => {
  it('returns the fee payer of an unsigned v0 VersionedTransaction', () => {
    const message = new TransactionMessage({
      payerKey: payer.publicKey,
      recentBlockhash,
      instructions: [transfer],
    }).compileToV0Message();
    const base64 = toBase64(new VersionedTransaction(message).serialize());

    expect(getSolanaFeePayer(base64)).toBe(payer.publicKey.toBase58());
  });

  it('returns the fee payer of an unsigned legacy Transaction', () => {
    const tx = new Transaction({recentBlockhash, feePayer: payer.publicKey});
    tx.add(transfer);
    const base64 = toBase64(tx.serialize({requireAllSignatures: false}));

    expect(getSolanaFeePayer(base64)).toBe(payer.publicKey.toBase58());
  });

  it.each([
    ['garbage base64', 'bm90IGEgdHJhbnNhY3Rpb24='],
    ['empty string', ''],
    ['undefined', undefined],
    ['non-string', {transaction: 'x'}],
  ])('returns null for %s instead of throwing', (_label, input) => {
    expect(getSolanaFeePayer(input)).toBeNull();
  });
});
