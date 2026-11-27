/**
 * eth_signTypedData review: permit-style signatures show spender, token,
 * amount and expiry; unlimited ones, marketplace orders and a domain chain
 * other than the session's need an acknowledgement. Other typed data is
 * left as it was (no level).
 *
 *   npx jest dok-wallet-blockchain-networks/helper/evmTypedDataReview.test.js
 */
import {reviewEvmTypedData} from 'dok-wallet-blockchain-networks/helper/evmTypedDataReview';

const TOKEN = '0x1111111111111111111111111111111111111111';
const SPENDER = '0x2222222222222222222222222222222222222222';
const OWNER = '0x3333333333333333333333333333333333333333';
const PERMIT2 = '0x000000000022D473030F116dDEE9F6B43aC78BA3';
const MAX_UINT256 = (2n ** 256n - 1n).toString();
const MAX_UINT160 = (2n ** 160n - 1n).toString();
const DEADLINE = 1798761600; // 2027-01-01 00:00 UTC

const typed = (primaryType, message, domain = {}) =>
  JSON.stringify({
    types: {EIP712Domain: []},
    primaryType,
    domain: {chainId: 1, ...domain},
    message,
  });
const row = (review, label) => review.rows.find(r => r.label === label)?.value;

describe('reviewEvmTypedData', () => {
  it('leaves ordinary typed data (e.g. a login message) without a level', () => {
    const review = reviewEvmTypedData(
      typed('Login', {contents: 'Sign in'}, {name: 'Example'}),
      {chainId: 'eip155:1'},
    );
    expect(review.level).toBe('none');
    expect(review.reasons).toEqual([]);
  });

  it('flags a domain chain that differs from the session chain', () => {
    const review = reviewEvmTypedData(
      typed('Login', {contents: 'x'}, {chainId: 137}),
      {chainId: 'eip155:1'},
    );
    expect(review.level).toBe('danger');
    expect(review.reasons.join(' ')).toMatch(/chain 137/);
    expect(row(review, 'Signature chain')).toBe('137');
  });

  it.each([
    ['a hex string', '0x1'],
    ['a decimal string', '1'],
    ['a number', 1],
  ])('accepts a matching domain chain id given as %s', (_l, chainId) => {
    const review = reviewEvmTypedData(
      typed('Login', {contents: 'x'}, {chainId}),
      {chainId: 'eip155:1'},
    );
    expect(review.level).toBe('none');
  });

  it('marks an unlimited EIP-2612 permit as danger with its details', () => {
    const review = reviewEvmTypedData(
      typed(
        'Permit',
        {
          owner: OWNER,
          spender: SPENDER,
          value: MAX_UINT256,
          nonce: 0,
          deadline: DEADLINE,
        },
        {name: 'USD Coin', verifyingContract: TOKEN},
      ),
      {chainId: 'eip155:1'},
    );
    expect(review.level).toBe('danger');
    expect(review.kind).toBe('permit');
    expect(row(review, 'Spender')).toBe(SPENDER);
    expect(row(review, 'Token')).toBe(`USD Coin (${TOKEN})`);
    expect(row(review, 'Amount')).toBe('Unlimited');
    expect(row(review, 'Valid until')).toBe('2027-01-01 00:00 UTC');
  });

  it('marks a bounded EIP-2612 permit as a warning only', () => {
    const review = reviewEvmTypedData(
      typed(
        'Permit',
        {
          owner: OWNER,
          spender: SPENDER,
          value: '1000000',
          nonce: 0,
          deadline: DEADLINE,
        },
        {verifyingContract: TOKEN},
      ),
      {chainId: 'eip155:1'},
    );
    expect(review.level).toBe('warn');
    expect(row(review, 'Amount')).toBe('1000000');
  });

  it('marks a DAI-style permit with allowed=true as unlimited', () => {
    const review = reviewEvmTypedData(
      typed(
        'Permit',
        {
          holder: OWNER,
          spender: SPENDER,
          nonce: 0,
          expiry: DEADLINE,
          allowed: true,
        },
        {name: 'Dai Stablecoin', verifyingContract: TOKEN},
      ),
      {chainId: 'eip155:1'},
    );
    expect(review.level).toBe('danger');
    expect(row(review, 'Amount')).toBe('Unlimited');
  });

  it('reads a Permit2 PermitSingle (Uniswap) and flags an unlimited amount', () => {
    const review = reviewEvmTypedData(
      typed(
        'PermitSingle',
        {
          details: {
            token: TOKEN,
            amount: MAX_UINT160,
            expiration: DEADLINE,
            nonce: 0,
          },
          spender: SPENDER,
          sigDeadline: DEADLINE,
        },
        {name: 'Permit2', verifyingContract: PERMIT2},
      ),
      {chainId: 'eip155:1'},
    );
    expect(review.level).toBe('danger');
    expect(row(review, 'Spender')).toBe(SPENDER);
    expect(row(review, 'Token')).toBe(TOKEN);
    expect(row(review, 'Amount')).toBe('Unlimited');
  });

  it('reads a Permit2 PermitBatch, one row per token', () => {
    const review = reviewEvmTypedData(
      typed('PermitBatch', {
        details: [
          {token: TOKEN, amount: '5', expiration: DEADLINE, nonce: 0},
          {token: OWNER, amount: '7', expiration: DEADLINE, nonce: 0},
        ],
        spender: SPENDER,
        sigDeadline: DEADLINE,
      }),
      {chainId: 'eip155:1'},
    );
    expect(review.level).toBe('warn');
    expect(row(review, 'Token 1')).toBe(`${TOKEN}: 5`);
    expect(row(review, 'Token 2')).toBe(`${OWNER}: 7`);
  });

  it('reads a Permit2 PermitTransferFrom (one-time transfer)', () => {
    const review = reviewEvmTypedData(
      typed('PermitTransferFrom', {
        permitted: {token: TOKEN, amount: '42'},
        spender: SPENDER,
        nonce: 1,
        deadline: DEADLINE,
      }),
      {chainId: 'eip155:1'},
    );
    expect(review.level).toBe('warn');
    expect(row(review, 'Amount')).toBe('42');
  });

  it('marks a Seaport order as danger and lists what is paid to the signer', () => {
    const review = reviewEvmTypedData(
      typed(
        'OrderComponents',
        {
          offerer: OWNER,
          offer: [
            {
              itemType: 2,
              token: TOKEN,
              identifierOrCriteria: '7',
              startAmount: '1',
              endAmount: '1',
            },
          ],
          consideration: [
            {
              itemType: 0,
              token: '0x0000000000000000000000000000000000000000',
              identifierOrCriteria: '0',
              startAmount: '1',
              endAmount: '1',
              recipient: OWNER,
            },
            {
              itemType: 0,
              token: '0x0000000000000000000000000000000000000000',
              identifierOrCriteria: '0',
              startAmount: '9',
              endAmount: '9',
              recipient: SPENDER,
            },
          ],
        },
        {name: 'Seaport'},
      ),
      {chainId: 'eip155:1'},
    );
    expect(review.level).toBe('danger');
    expect(review.kind).toBe('order');
    expect(row(review, 'You give')).toBe('1 item(s)');
    expect(row(review, 'Paid to you')).toBe('1 (native coin, smallest unit)');
  });

  it('never throws on unreadable input', () => {
    expect(reviewEvmTypedData('{not json', {chainId: 'eip155:1'}).level).toBe(
      'none',
    );
    expect(reviewEvmTypedData(undefined).level).toBe('none');
  });

  it('never throws when a permit message is not an object', () => {
    for (const message of ['x', 7, true]) {
      expect(() =>
        reviewEvmTypedData(typed('Permit', message), {chainId: 'eip155:1'}),
      ).not.toThrow();
    }
  });
});
