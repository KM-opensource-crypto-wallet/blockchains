/**
 * Stellar WalletConnect transaction review (stellar_signXDR,
 * stellar_signAndSubmitXDR).
 *
 *   npx jest dok-wallet-blockchain-networks/helper/stellarTxReview.test.js
 */
import {Buffer} from 'buffer';
import {
  Account,
  Asset,
  Keypair,
  Networks,
  Operation,
  TransactionBuilder,
} from '@stellar/stellar-sdk';
import {
  getStellarTakeoverReason,
  reviewStellarTransaction,
} from 'dok-wallet-blockchain-networks/helper/stellarTxReview';

const wallet = Keypair.fromRawEd25519Seed(Buffer.alloc(32, 7));
const other = Keypair.fromRawEd25519Seed(Buffer.alloc(32, 8)).publicKey();

const build = (...operations) => {
  const builder = new TransactionBuilder(new Account(wallet.publicKey(), '1'), {
    fee: '100',
    networkPassphrase: Networks.TESTNET,
  });
  operations.forEach(op => builder.addOperation(op));
  return builder.setTimeout(0).build();
};
const xdrOf = (...operations) => build(...operations).toXDR();
const row = (r, label) => r.rows.find(x => x.label === label)?.value;

describe('reviewStellarTransaction', () => {
  it('shows a payment without a warning', () => {
    const r = reviewStellarTransaction(
      xdrOf(
        Operation.payment({
          destination: other,
          asset: Asset.native(),
          amount: '1.5',
        }),
      ),
    );
    expect(r.level).toBe('none');
    expect(row(r, 'Sends')).toBe(`1.5000000 XLM to ${other}`);
  });

  it.each([
    ['adds a signer', {signer: {ed25519PublicKey: other, weight: 1}}],
    ['sets the master weight', {masterWeight: 0}],
    ['changes a threshold', {highThreshold: 10}],
  ])('blocks setOptions that %s', (_l, options) => {
    const xdr = xdrOf(Operation.setOptions(options));
    const r = reviewStellarTransaction(xdr);
    expect(r.blocked).toBe(true);
    expect(r.level).toBe('danger');
    expect(
      getStellarTakeoverReason(
        TransactionBuilder.fromXDR(xdr, Networks.TESTNET),
      ),
    ).toMatch(/who can sign/);
  });

  it('leaves setOptions that only sets a home domain alone', () => {
    const r = reviewStellarTransaction(
      xdrOf(Operation.setOptions({homeDomain: 'example.com'})),
    );
    expect(r.blocked).toBe(false);
    expect(r.level).toBe('none');
  });

  it('marks removing a signer as danger but does not refuse it', () => {
    const transaction = build(
      Operation.setOptions({signer: {ed25519PublicKey: other, weight: 0}}),
    );
    const r = reviewStellarTransaction(transaction.toXDR());
    expect(r.level).toBe('danger');
    expect(r.blocked).toBe(false);
    expect(r.reasons.join(' ')).toMatch(/removes a signer/);
    // The signer's refusal stays limited to adding signers or changing
    // weights and thresholds.
    expect(getStellarTakeoverReason(transaction)).toBeNull();
  });

  it('marks an account merge as danger without blocking it', () => {
    const r = reviewStellarTransaction(
      xdrOf(Operation.accountMerge({destination: other})),
    );
    expect(r.level).toBe('danger');
    expect(r.blocked).toBe(false);
    expect(r.reasons.join(' ')).toMatch(other);
  });

  it('leaves DEX and trustline operations without a warning', () => {
    const r = reviewStellarTransaction(
      xdrOf(
        Operation.changeTrust({asset: new Asset('USDC', other)}),
        Operation.manageSellOffer({
          selling: Asset.native(),
          buying: new Asset('USDC', other),
          amount: '1',
          price: '1',
        }),
      ),
    );
    expect(r.level).toBe('none');
    expect(row(r, 'Operations')).toBe('changeTrust, manageSellOffer');
  });

  it('flags unreadable XDR as danger', () => {
    expect(reviewStellarTransaction('not-xdr').level).toBe('danger');
  });
});
