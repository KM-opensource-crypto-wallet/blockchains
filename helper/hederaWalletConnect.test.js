/**
 * Human-readable summary of a HIP-820 request for the transaction modal.
 * Runner: node-env jest config (real Hedera SDK).
 */
import {
  AccountAllowanceApproveTransaction,
  AccountBalanceQuery,
  AccountDeleteTransaction,
  AccountUpdateTransaction,
  ContractExecuteTransaction,
  Hbar,
  PrivateKey,
  TokenAssociateTransaction,
  TransactionId,
  TransferTransaction,
} from '@hiero-ledger/sdk';
import {Buffer} from 'buffer';
import {
  describeHederaRequest,
  getHederaTakeoverReason,
  reviewHederaRequest,
} from 'dok-wallet-blockchain-networks/helper/hederaWalletConnect';

const b64 = bytes => Buffer.from(bytes).toString('base64');
const SIGNER = 'hedera:testnet:0.0.1234';

const transfer = () =>
  new TransferTransaction()
    .addHbarTransfer('0.0.1234', new Hbar(-2))
    .addHbarTransfer('0.0.3', new Hbar(2))
    .setTransactionMemo('coffee')
    .setMaxTransactionFee(new Hbar(1))
    .setTransactionId(TransactionId.generate('0.0.1234'));

describe('describeHederaRequest', () => {
  it('summarises a signAndExecute TransferTransaction: type, payer, memo, transfers', () => {
    const summary = describeHederaRequest('hedera_signAndExecuteTransaction', {
      signerAccountId: SIGNER,
      transactionList: b64(transfer().toBytes()),
    });

    expect(summary).toEqual({
      type: 'TransferTransaction',
      signer: '0.0.1234',
      payer: '0.0.1234',
      memo: 'coffee',
      maxFee: '1 ℏ',
      hbarTransfers: [
        {account: '0.0.1234', amount: '-2 ℏ'},
        {account: '0.0.3', amount: '2 ℏ'},
      ],
    });
  });

  it('summarises a pre-signed executeTransaction the same way', () => {
    const summary = describeHederaRequest('hedera_executeTransaction', {
      transactionList: b64(transfer().toBytes()),
    });
    expect(summary).toMatchObject({
      type: 'TransferTransaction',
      payer: '0.0.1234',
    });
    expect(summary.signer).toBeUndefined();
  });

  it('summarises a query by type and target account', () => {
    const summary = describeHederaRequest('hedera_signAndExecuteQuery', {
      signerAccountId: SIGNER,
      query: b64(new AccountBalanceQuery().setAccountId('0.0.9').toBytes()),
    });
    expect(summary).toEqual({
      type: 'AccountBalanceQuery',
      signer: '0.0.1234',
      accountId: '0.0.9',
    });
  });

  it('never throws: undecodable bytes fall back to the raw params', () => {
    const params = {signerAccountId: SIGNER, transactionList: 'bm9wZQ=='};
    expect(
      describeHederaRequest('hedera_signAndExecuteTransaction', params),
    ).toEqual({signer: '0.0.1234', raw: params});
    expect(describeHederaRequest('hedera_unknown', {a: 1})).toEqual({
      raw: {a: 1},
    });
  });
});

describe('reviewHederaRequest (hedera_signAndExecuteTransaction)', () => {
  const withId = tx => tx.setTransactionId(TransactionId.generate('0.0.1234'));
  const review = tx =>
    reviewHederaRequest('hedera_signAndExecuteTransaction', {
      signerAccountId: SIGNER,
      transactionList: b64(withId(tx).toBytes()),
    });
  const row = (r, label) => r.rows.find(x => x.label === label)?.value;
  const newKey = PrivateKey.fromStringECDSA('11'.repeat(32)).publicKey;

  it('blocks an AccountUpdate that sets a new key', () => {
    const tx = new AccountUpdateTransaction()
      .setAccountId('0.0.1234')
      .setKey(newKey);
    const r = review(tx);
    expect(r.blocked).toBe(true);
    expect(r.level).toBe('danger');
    expect(getHederaTakeoverReason(tx)).toMatch(/key that controls/);
  });

  it('does not block an AccountUpdate that only changes the memo', () => {
    const r = review(
      new AccountUpdateTransaction()
        .setAccountId('0.0.1234')
        .setAccountMemo('hi'),
    );
    expect(r.blocked).toBe(false);
  });

  it('marks an allowance approval as danger and lists it', () => {
    const r = review(
      new AccountAllowanceApproveTransaction().approveHbarAllowance(
        '0.0.1234',
        '0.0.99',
        new Hbar(5),
      ),
    );
    expect(r.level).toBe('danger');
    expect(r.blocked).toBe(false);
    expect(row(r, 'HBAR allowance')).toBe('0.0.99: 5 ℏ');
  });

  it('marks an account delete and a contract call as danger', () => {
    expect(
      review(
        new AccountDeleteTransaction()
          .setAccountId('0.0.1234')
          .setTransferAccountId('0.0.99'),
      ).level,
    ).toBe('danger');
    expect(
      review(
        new ContractExecuteTransaction().setContractId('0.0.5').setGas(100000),
      ).level,
    ).toBe('danger');
  });

  it('shows token transfers and leaves plain transfers without a warning', () => {
    const r = review(
      new TransferTransaction()
        .addHbarTransfer('0.0.1234', new Hbar(-1))
        .addHbarTransfer('0.0.3', new Hbar(1))
        .addTokenTransfer('0.0.777', '0.0.1234', -10)
        .addTokenTransfer('0.0.777', '0.0.3', 10),
    );
    expect(r.level).toBe('none');
    expect(row(r, 'Token 0.0.777')).toBe('0.0.1234: -10, 0.0.3: 10');
  });

  it('leaves token association without a warning', () => {
    expect(
      review(
        new TokenAssociateTransaction()
          .setAccountId('0.0.1234')
          .setTokenIds(['0.0.777']),
      ).level,
    ).toBe('none');
  });

  it('returns null for methods it does not review, danger for bad bytes', () => {
    expect(reviewHederaRequest('hedera_signAndExecuteQuery', {})).toBeNull();
    expect(
      reviewHederaRequest('hedera_signAndExecuteTransaction', {
        transactionList: 'AAAA',
      }).level,
    ).toBe('danger');
  });
});
