/**
 * Tron WalletConnect transaction review. TronWeb's trx.sign checks raw_data
 * against raw_data_hex and txID, so the JSON read here is what gets signed.
 *
 *   npx jest dok-wallet-blockchain-networks/helper/tronTxReview.test.js
 */
import {
  getTronTakeoverReason,
  reviewTronTransaction,
} from 'dok-wallet-blockchain-networks/helper/tronTxReview';

const OWNER_HEX = '41' + '11'.repeat(20);
const OTHER_HEX = '41' + '22'.repeat(20);
const CONTRACT_HEX = '41' + '33'.repeat(20);
const word = hex => hex.padStart(64, '0');
const tx = (type, value) => ({
  txID: 'ab'.repeat(32),
  raw_data: {contract: [{type, parameter: {value}}]},
  raw_data_hex: '00',
});
const trigger = data =>
  tx('TriggerSmartContract', {
    owner_address: OWNER_HEX,
    contract_address: CONTRACT_HEX,
    data,
  });
const row = (review, label) => review.rows.find(r => r.label === label)?.value;

describe('reviewTronTransaction TRC-10 attached to a contract call', () => {
  it('shows the TRC-10 amount and token a call also sends', () => {
    const review = reviewTronTransaction(
      tx('TriggerSmartContract', {
        owner_address: OWNER_HEX,
        contract_address: CONTRACT_HEX,
        data: 'a9059cbb' + word('22'.repeat(20)) + word('64'),
        call_token_value: 1000000,
        token_id: 1000001,
      }),
    );
    expect(row(review, 'Also sends TRC-10')).toBe('1000000 of token 1000001');
    expect(review.level).toBe('warn');
  });
});

describe('reviewTronTransaction', () => {
  it('blocks AccountPermissionUpdate', () => {
    const t = tx('AccountPermissionUpdateContract', {owner_address: OWNER_HEX});
    const review = reviewTronTransaction(t);
    expect(review.blocked).toBe(true);
    expect(review.level).toBe('danger');
    expect(getTronTakeoverReason(t)).toMatch(/controls your Tron account/);
  });

  it('shows a TRX transfer without a warning', () => {
    const review = reviewTronTransaction(
      tx('TransferContract', {
        owner_address: OWNER_HEX,
        to_address: OTHER_HEX,
        amount: 1500000,
      }),
    );
    expect(review.level).toBe('none');
    expect(row(review, 'Amount')).toBe('1.5 TRX');
    expect(row(review, 'To')).toMatch(/^T[1-9A-HJ-NP-Za-km-z]{33}$/);
  });

  it('marks an unlimited TRC-20 approve as danger', () => {
    const review = reviewTronTransaction(
      trigger('095ea7b3' + word('22'.repeat(20)) + 'f'.repeat(64)),
    );
    expect(review.level).toBe('danger');
    expect(review.blocked).toBe(false);
    expect(row(review, 'Amount')).toBe('Unlimited');
  });

  it('marks a bounded TRC-20 approve as a warning', () => {
    const review = reviewTronTransaction(
      trigger('095ea7b3' + word('22'.repeat(20)) + word('64')),
    );
    expect(review.level).toBe('warn');
    expect(row(review, 'Amount')).toBe('100');
  });

  it('shows a TRC-20 transfer without a warning', () => {
    const review = reviewTronTransaction(
      trigger('a9059cbb' + word('22'.repeat(20)) + word('3e8')),
    );
    expect(review.level).toBe('none');
    expect(row(review, 'Amount')).toBe('1000');
  });

  it('marks a contract call it cannot decode as danger, not blocked', () => {
    const review = reviewTronTransaction(trigger('12345678' + word('1')));
    expect(review.level).toBe('danger');
    expect(review.blocked).toBe(false);
    expect(row(review, 'Function selector')).toBe('0x12345678');
  });

  it('leaves staking and resource transactions without a warning', () => {
    const review = reviewTronTransaction(
      tx('FreezeBalanceV2Contract', {owner_address: OWNER_HEX}),
    );
    expect(review.level).toBe('none');
  });

  it('marks an unknown transaction type as danger and unreadable input too', () => {
    expect(reviewTronTransaction(tx('ExchangeCreateContract', {})).level).toBe(
      'danger',
    );
    expect(reviewTronTransaction(undefined).level).toBe('danger');
    expect(getTronTakeoverReason(undefined)).toBeNull();
  });
});
