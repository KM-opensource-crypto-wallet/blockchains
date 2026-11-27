/**
 * XRPL WalletConnect transaction review (xrpl_signTransaction,
 * xrpl_submitTransaction). The tx JSON is extracted exactly as RippleChain
 * extracts it before signing.
 *
 *   npx jest dok-wallet-blockchain-networks/helper/xrplTxReview.test.js
 */
import {
  extractXrplTxJson,
  getXrplTakeoverReason,
  reviewXrplRequest,
} from 'dok-wallet-blockchain-networks/helper/xrplTxReview';

const ACCOUNT = 'rPT1Sjq2YGrBMTttX4GZHjKu9dyfzbpAYe';
const OTHER = 'rUn84CUYbNjRoTQ6mSW7BVJPSVJNLb1QLo';
const request = tx => ({transaction: {tx_json: {Account: ACCOUNT, ...tx}}});
const row = (r, label) => r.rows.find(x => x.label === label)?.value;

describe('extractXrplTxJson', () => {
  it('reads tx_json, transaction, arrays and plain objects', () => {
    expect(extractXrplTxJson({tx_json: {a: 1}})).toEqual({a: 1});
    expect(extractXrplTxJson({transaction: {b: 2}})).toEqual({b: 2});
    expect(extractXrplTxJson([{tx_json: {c: 3}}])).toEqual({c: 3});
    expect(extractXrplTxJson({d: 4})).toEqual({d: 4});
    expect(extractXrplTxJson(undefined)).toEqual({});
  });
});

describe('reviewXrplRequest', () => {
  it('shows an XRP payment without a warning', () => {
    const r = reviewXrplRequest(
      request({
        TransactionType: 'Payment',
        Destination: OTHER,
        Amount: '1500000',
        DestinationTag: 7,
      }),
    );
    expect(r.level).toBe('none');
    expect(row(r, 'Sends')).toBe(`1.5 XRP to ${OTHER}`);
    expect(row(r, 'Destination tag')).toBe('7');
  });

  it('shows an issued-currency payment', () => {
    const r = reviewXrplRequest(
      request({
        TransactionType: 'Payment',
        Destination: OTHER,
        Amount: {currency: 'USD', value: '10', issuer: OTHER},
      }),
    );
    expect(row(r, 'Sends')).toBe(`10 USD to ${OTHER}`);
  });

  it.each([
    ['SetRegularKey', {RegularKey: OTHER}],
    [
      'SignerListSet',
      {
        SignerQuorum: 1,
        SignerEntries: [{SignerEntry: {Account: OTHER, SignerWeight: 1}}],
      },
    ],
  ])('blocks %s that adds a key', (type, fields) => {
    const r = reviewXrplRequest(request({TransactionType: type, ...fields}));
    expect(r.blocked).toBe(true);
    expect(r.level).toBe('danger');
    expect(getXrplTakeoverReason({TransactionType: type, ...fields})).toMatch(
      /sign for your XRP account/,
    );
  });

  it.each([
    [
      'SetRegularKey without a key (removal)',
      {TransactionType: 'SetRegularKey'},
    ],
    [
      'SignerListSet that deletes the list',
      {TransactionType: 'SignerListSet', SignerQuorum: 0},
    ],
  ])('does not block %s', (_l, tx) => {
    expect(reviewXrplRequest(request(tx)).blocked).toBe(false);
  });

  it('marks AccountDelete as danger without blocking it', () => {
    const r = reviewXrplRequest(
      request({TransactionType: 'AccountDelete', Destination: OTHER}),
    );
    expect(r.level).toBe('danger');
    expect(r.blocked).toBe(false);
  });

  it('leaves TrustSet and offers without a warning', () => {
    expect(
      reviewXrplRequest(request({TransactionType: 'TrustSet'})).level,
    ).toBe('none');
    expect(
      reviewXrplRequest(request({TransactionType: 'OfferCreate'})).level,
    ).toBe('none');
  });

  it('shows what a DEX offer gives and gets', () => {
    const r = reviewXrplRequest(
      request({
        TransactionType: 'OfferCreate',
        TakerGets: '1000000',
        TakerPays: {currency: 'USD', issuer: OTHER, value: '0.5'},
      }),
    );
    expect(r.level).toBe('none');
    expect(row(r, 'You give')).toBe('1 XRP');
    expect(row(r, 'You get')).toBe('0.5 USD');
  });

  it('shows a trust line limit and its issuer', () => {
    const r = reviewXrplRequest(
      request({
        TransactionType: 'TrustSet',
        LimitAmount: {currency: 'USD', issuer: OTHER, value: '100'},
      }),
    );
    expect(r.level).toBe('none');
    expect(row(r, 'Trust line')).toBe(`100 USD, issuer ${OTHER}`);
  });

  it('marks NFT offers as danger and shows the offer', () => {
    const create = reviewXrplRequest(
      request({
        TransactionType: 'NFTokenCreateOffer',
        NFTokenID: 'ABC',
        Amount: '0',
        Destination: OTHER,
        Flags: 1,
      }),
    );
    expect(create.level).toBe('danger');
    expect(create.blocked).toBe(false);
    expect(row(create, 'NFT')).toBe('ABC');
    expect(row(create, 'Sell for')).toBe('0 XRP');
    expect(row(create, 'Only to')).toBe(OTHER);

    const accept = reviewXrplRequest(
      request({TransactionType: 'NFTokenAcceptOffer', NFTokenSellOffer: 'F1'}),
    );
    expect(accept.level).toBe('danger');
    expect(accept.blocked).toBe(false);
  });

  it('marks a transaction type the wallet does not check as danger', () => {
    const r = reviewXrplRequest(
      request({TransactionType: 'PaymentChannelCreate', Amount: '1000000'}),
    );
    expect(r.level).toBe('danger');
    expect(r.blocked).toBe(false);
    expect(r.reasons.join(' ')).toMatch(/PaymentChannelCreate.*not checked/);
  });

  it('flags a request without a transaction type as danger', () => {
    expect(reviewXrplRequest({}).level).toBe('danger');
  });
});
