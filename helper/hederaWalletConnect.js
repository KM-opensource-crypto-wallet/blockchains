/*
 * Human-readable summary of a HIP-820 WalletConnect request for the
 * transaction modal. Requests arrive as base64 protobuf, which is meaningless
 * to the user; this decodes what can be shown (transaction type, payer, memo,
 * fee cap, HBAR transfers) and never throws — undecodable input is returned as
 * the raw params. The SDK is required lazily so the modal bundle does not
 * load it for other chains.
 */

const signerOf = params => params?.signerAccountId?.split(':')?.pop();

// eslint-disable-next-line no-undef
const fromBase64 = value => Buffer.from(value, 'base64');

// Senders (negative) first, then recipients, so the list reads top-down.
const sortTransfers = transfers =>
  transfers.sort((a, b) => a.sortKey - b.sortKey).map(({sortKey, ...t}) => t);

const describeTransactionBytes = ({Transaction}, bytes) => {
  const tx = Transaction.fromBytes(bytes);
  const summary = {
    type: tx.constructor.name,
    payer: tx.transactionId?.accountId?.toString(),
    memo: tx.transactionMemo || '',
  };
  const maxFee = tx.maxTransactionFee?.toString();
  if (maxFee) {
    summary.maxFee = maxFee;
  }
  const hbarTransfers = tx.hbarTransfers;
  if (hbarTransfers && typeof hbarTransfers.keys === 'function') {
    const transfers = [...hbarTransfers.keys()].map(account => {
      const amount = hbarTransfers.get(account);
      return {
        account: account.toString(),
        amount: amount.toString(),
        sortKey: Number(amount.toTinybars().toString()),
      };
    });
    if (transfers.length) {
      summary.hbarTransfers = sortTransfers(transfers);
    }
  }
  return summary;
};

const describeQueryBytes = ({Query}, bytes) => {
  const query = Query.fromBytes(bytes);
  const summary = {type: query.constructor.name};
  const accountId = query.accountId?.toString();
  if (accountId) {
    summary.accountId = accountId;
  }
  return summary;
};

const DESCRIBERS = {
  hedera_signAndExecuteTransaction: (sdk, params) =>
    describeTransactionBytes(sdk, fromBase64(params.transactionList)),
  hedera_executeTransaction: (sdk, params) =>
    describeTransactionBytes(sdk, fromBase64(params.transactionList)),
  hedera_signAndExecuteQuery: (sdk, params) =>
    describeQueryBytes(sdk, fromBase64(params.query)),
};

export const describeHederaRequest = (method, params) => {
  const signer = signerOf(params);
  const withSigner = summary => (signer ? {signer, ...summary} : summary);
  const describe = DESCRIBERS[method];
  if (!describe) {
    return withSigner({raw: params});
  }
  try {
    const {Transaction, Query} = require('@hiero-ledger/sdk');
    return withSigner(describe({Transaction, Query}, params));
  } catch (e) {
    return withSigner({raw: params});
  }
};
