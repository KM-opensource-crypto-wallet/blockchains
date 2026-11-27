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

const LEVEL_RANK = {none: 0, warn: 1, danger: 2};

// On a decoded Transaction, as HederaChain signs it. Classes are matched with
// instanceof: release builds may minify constructor names.
export const getHederaTakeoverReason = transaction => {
  const {AccountUpdateTransaction} = require('@hiero-ledger/sdk');
  return transaction instanceof AccountUpdateTransaction &&
    transaction.key != null
    ? 'This request changes the key that controls a Hedera account.'
    : null;
};

const reviewTransaction = (sdk, tx, result, raise) => {
  const takeover = getHederaTakeoverReason(tx);
  if (takeover) {
    result.blocked = true;
    raise('danger', `${takeover} It cannot be signed.`);
    return;
  }
  if (tx instanceof sdk.AccountAllowanceApproveTransaction) {
    tx.hbarApprovals.forEach(a =>
      result.rows.push({
        label: 'HBAR allowance',
        value: `${a.spenderAccountId}: ${a.amount}`,
      }),
    );
    tx.tokenApprovals.forEach(a =>
      result.rows.push({
        label: `Token ${a.tokenId} allowance`,
        value: `${a.spenderAccountId}: ${a.amount}`,
      }),
    );
    tx.tokenNftApprovals.forEach(a =>
      result.rows.push({
        label: `NFT ${a.tokenId} allowance`,
        value: `${a.spenderAccountId}: ${
          a.allSerials ? 'all serials' : (a.serialNumbers || []).join(', ')
        }`,
      }),
    );
    raise(
      'danger',
      'This lets another account spend your HBAR, tokens or NFTs without asking again.',
    );
  } else if (tx instanceof sdk.AccountDeleteTransaction) {
    raise(
      'danger',
      `This deletes the account and sends its balance to ${tx.transferAccountId}.`,
    );
  } else if (tx instanceof sdk.ContractExecuteTransaction) {
    result.rows.push({label: 'Contract', value: String(tx.contractId)});
    if (tx.payableAmount) {
      result.rows.push({label: 'Also sends', value: String(tx.payableAmount)});
    }
    raise(
      'danger',
      'This calls a smart contract the wallet cannot check. Only continue if you trust this site.',
    );
  } else if (tx instanceof sdk.TransferTransaction) {
    for (const [tokenId, transfers] of tx.tokenTransfers) {
      result.rows.push({
        label: `Token ${tokenId}`,
        value: [...transfers]
          .map(([account, amount]) => ({account, amount}))
          .sort((a, b) => Number(a.amount) - Number(b.amount))
          .map(({account, amount}) => `${account}: ${amount}`)
          .join(', '),
      });
    }
    for (const [tokenId, transfers] of tx.nftTransfers) {
      result.rows.push({
        label: `NFT ${tokenId}`,
        value: transfers
          .map(t => `#${t.serial} ${t.sender} → ${t.recipient}`)
          .join(', '),
      });
    }
  }
};

// Risk review for the requests this wallet signs (hedera_signAndExecute-
// Transaction); null for the others. Never throws.
export const reviewHederaRequest = (method, params) => {
  if (method !== 'hedera_signAndExecuteTransaction') {
    return null;
  }
  const result = {level: 'none', reasons: [], rows: [], blocked: false};
  const raise = (level, reason) => {
    if (LEVEL_RANK[level] > LEVEL_RANK[result.level]) {
      result.level = level;
    }
    if (reason && !result.reasons.includes(reason)) {
      result.reasons.push(reason);
    }
  };
  try {
    const sdk = require('@hiero-ledger/sdk');
    const tx = sdk.Transaction.fromBytes(fromBase64(params.transactionList));
    reviewTransaction(sdk, tx, result, raise);
  } catch (e) {
    raise('danger', 'This Hedera transaction could not be read.');
  }
  return result;
};
