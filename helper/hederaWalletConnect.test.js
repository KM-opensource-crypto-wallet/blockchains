/**
 * Human-readable summary of a HIP-820 request for the transaction modal.
 * Runner: node-env jest config (real Hedera SDK).
 */
import {
  AccountBalanceQuery,
  Hbar,
  TransactionId,
  TransferTransaction,
} from '@hiero-ledger/sdk';
import {Buffer} from 'buffer';
import {describeHederaRequest} from 'dok-wallet-blockchain-networks/helper/hederaWalletConnect';

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
