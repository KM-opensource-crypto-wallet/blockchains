/**
 * Solana WalletConnect transaction review (solana_signTransaction,
 * solana_signAndSendTransaction, solana_signAllTransactions).
 *
 * Runner: node-env jest config (same as the other Solana suites).
 */
import {
  AddressLookupTableAccount,
  Keypair,
  PublicKey,
  SystemProgram,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
} from '@solana/web3.js';
import {
  AuthorityType,
  createApproveInstruction,
  createSetAuthorityInstruction,
  createTransferCheckedInstruction,
  createTransferInstruction,
} from '@solana/spl-token';
import bs58 from 'bs58';
import {Buffer} from 'buffer';
import {
  getSolanaTakeoverReason,
  reviewSolanaRequest,
} from 'dok-wallet-blockchain-networks/helper/solanaTxReview';

const wallet = Keypair.fromSeed(Uint8Array.from({length: 32}, () => 7));
const other = Keypair.fromSeed(
  Uint8Array.from({length: 32}, () => 8),
).publicKey;
const tokenAccount = Keypair.fromSeed(
  Uint8Array.from({length: 32}, () => 9),
).publicKey;
const WALLET = wallet.publicKey.toBase58();
const blockhash = bs58.encode(Uint8Array.from({length: 32}, () => 5));

const txBase64 = (instructions, payer = wallet.publicKey) =>
  Buffer.from(
    new VersionedTransaction(
      new TransactionMessage({
        payerKey: payer,
        recentBlockhash: blockhash,
        instructions,
      }).compileToV0Message(),
    ).serialize(),
  ).toString('base64');
const review = instructions =>
  reviewSolanaRequest({transaction: txBase64(instructions)}, WALLET);
const row = (r, label) => r.rows.find(x => x.label === label)?.value;

describe('reviewSolanaRequest', () => {
  it('shows a SOL transfer and the decoded fee payer without a warning', () => {
    const r = review([
      SystemProgram.transfer({
        fromPubkey: wallet.publicKey,
        toPubkey: other,
        lamports: 1500000000,
      }),
    ]);
    expect(r.level).toBe('none');
    expect(r.blocked).toBe(false);
    expect(row(r, 'Fee payer')).toBe(WALLET);
    expect(row(r, 'Sends')).toBe(`1.5 SOL to ${other.toBase58()}`);
  });

  it('blocks assigning the wallet account to another program', () => {
    const tx = txBase64([
      SystemProgram.assign({accountPubkey: wallet.publicKey, programId: other}),
    ]);
    const r = reviewSolanaRequest({transaction: tx}, WALLET);
    expect(r.blocked).toBe(true);
    expect(r.level).toBe('danger');
    expect(getSolanaTakeoverReason(tx, WALLET)).toMatch(/assigns your wallet/);
  });

  it.each([AuthorityType.AccountOwner, AuthorityType.CloseAccount])(
    'blocks handing a token account authority (%s) to someone else',
    authorityType => {
      const r = review([
        createSetAuthorityInstruction(
          tokenAccount,
          wallet.publicKey,
          authorityType,
          other,
        ),
      ]);
      expect(r.blocked).toBe(true);
    },
  );

  it('does not block clearing the close authority (it falls back to the owner)', () => {
    const tx = txBase64([
      createSetAuthorityInstruction(
        tokenAccount,
        wallet.publicKey,
        AuthorityType.CloseAccount,
        null,
      ),
    ]);
    expect(reviewSolanaRequest({transaction: tx}, WALLET).blocked).toBe(false);
    expect(getSolanaTakeoverReason(tx, WALLET)).toBeNull();
  });

  it('only warns when revoking a mint authority (token launch)', () => {
    const r = review([
      createSetAuthorityInstruction(
        tokenAccount,
        wallet.publicKey,
        AuthorityType.MintTokens,
        null,
      ),
    ]);
    expect(r.blocked).toBe(false);
    expect(r.level).toBe('warn');
  });

  it('marks an unlimited token delegate as danger and a bounded one as warn', () => {
    const unlimited = review([
      createApproveInstruction(
        tokenAccount,
        other,
        wallet.publicKey,
        2n ** 64n - 1n,
      ),
    ]);
    expect(unlimited.level).toBe('danger');
    expect(unlimited.blocked).toBe(false);
    expect(row(unlimited, 'Delegate')).toBe(other.toBase58());
    expect(row(unlimited, 'Amount')).toBe('Unlimited');
    const bounded = review([
      createApproveInstruction(tokenAccount, other, wallet.publicKey, 10n),
    ]);
    expect(bounded.level).toBe('warn');
  });

  it('shows token transfers sent from the wallet', () => {
    const mint = Keypair.fromSeed(
      Uint8Array.from({length: 32}, () => 10),
    ).publicKey;
    const r = review([
      createTransferInstruction(tokenAccount, other, wallet.publicKey, 5n),
      createTransferCheckedInstruction(
        tokenAccount,
        mint,
        other,
        wallet.publicKey,
        1500000n,
        6,
      ),
    ]);
    expect(r.level).toBe('none');
    const sends = r.rows
      .filter(x => x.label === 'Sends tokens')
      .map(x => x.value);
    expect(sends).toEqual([
      `5 (smallest unit) to token account ${other.toBase58()}`,
      `1.5 of ${mint.toBase58()} to token account ${other.toBase58()}`,
    ]);
  });

  it('warns when a destination comes from an address lookup table', () => {
    const table = new AddressLookupTableAccount({
      key: Keypair.fromSeed(Uint8Array.from({length: 32}, () => 11)).publicKey,
      state: {
        deactivationSlot: 2n ** 64n - 1n,
        lastExtendedSlot: 0,
        lastExtendedSlotStartIndex: 0,
        addresses: [other],
      },
    });
    const tx = Buffer.from(
      new VersionedTransaction(
        new TransactionMessage({
          payerKey: wallet.publicKey,
          recentBlockhash: blockhash,
          instructions: [
            createTransferInstruction(
              tokenAccount,
              other,
              wallet.publicKey,
              5n,
            ),
          ],
        }).compileToV0Message([table]),
      ).serialize(),
    ).toString('base64');
    const r = reviewSolanaRequest({transaction: tx}, WALLET);
    expect(r.level).toBe('danger');
    expect(r.blocked).toBe(false);
    expect(row(r, 'Sends tokens')).toMatch(/lookup table/);
    expect(r.reasons.join(' ')).toMatch(/lookup table/);
  });

  it('reviews the field the signer uses for each method', () => {
    const approve = txBase64([
      createApproveInstruction(
        tokenAccount,
        other,
        wallet.publicKey,
        2n ** 64n - 1n,
      ),
    ]);
    const data = {transaction: approve, transactions: []};
    expect(
      reviewSolanaRequest(data, WALLET, 'solana_signAndSendTransaction').level,
    ).toBe('danger');
    expect(
      reviewSolanaRequest(data, WALLET, 'solana_signTransaction').level,
    ).toBe('danger');
    expect(
      reviewSolanaRequest(
        {transaction: undefined, transactions: [approve]},
        WALLET,
        'solana_signAllTransactions',
      ).level,
    ).toBe('danger');
  });

  it('marks instructions for programs it cannot check as danger, not blocked', () => {
    const r = review([
      new TransactionInstruction({
        programId: other,
        keys: [{pubkey: wallet.publicKey, isSigner: true, isWritable: true}],
        data: Buffer.from([1, 2, 3]),
      }),
    ]);
    expect(r.level).toBe('danger');
    expect(r.blocked).toBe(false);
    expect(row(r, 'Other programs')).toBe(other.toBase58());
  });

  it('reviews every transaction of signAllTransactions', () => {
    const ok = txBase64([
      SystemProgram.transfer({
        fromPubkey: wallet.publicKey,
        toPubkey: other,
        lamports: 1,
      }),
    ]);
    const bad = txBase64([
      SystemProgram.assign({accountPubkey: wallet.publicKey, programId: other}),
    ]);
    const r = reviewSolanaRequest({transactions: [ok, bad]}, WALLET);
    expect(r.blocked).toBe(true);
    expect(row(r, 'Transactions')).toBe('2');
  });

  it('flags an unreadable transaction as danger and returns no takeover', () => {
    expect(reviewSolanaRequest({transaction: 'AAAA'}, WALLET).level).toBe(
      'danger',
    );
    expect(getSolanaTakeoverReason('AAAA', WALLET)).toBeNull();
  });
});
