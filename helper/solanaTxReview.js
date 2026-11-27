/*
 * Review of Solana WalletConnect transactions (pure, never throws). The bytes
 * are decoded exactly as SolanaChain signs them (base64 VersionedTransaction).
 * Refused: assigning the wallet account to another program, and handing the
 * owner or close authority of a token account the wallet controls to someone
 * else. Token delegations are graded like EVM approvals; instructions for
 * programs the wallet cannot read are danger. The fee payer always comes from
 * the transaction itself.
 */
import {PublicKey, VersionedTransaction} from '@solana/web3.js';
import {Buffer} from 'buffer';

const LEVEL_RANK = {none: 0, warn: 1, danger: 2};
const SYSTEM_PROGRAM = '11111111111111111111111111111111';
const TOKEN_PROGRAMS = [
  'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
  'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb',
];
const READ_ONLY_PROGRAMS = [
  'ComputeBudget111111111111111111111111111111',
  'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL',
  'MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr',
  'Memo1UhkJRfHyvLMcVucJwxXeuD728EqVDDwQDxFMNo',
];
const SYSTEM_ASSIGN = 1;
const SYSTEM_TRANSFER = 2;
const TOKEN_APPROVE = 4;
const TOKEN_SET_AUTHORITY = 6;
const TOKEN_APPROVE_CHECKED = 13;
// spl-token AuthorityType: AccountOwner = 2, CloseAccount = 3.
const TOKEN_ACCOUNT_AUTHORITIES = [2, 3];
const CLOSE_ACCOUNT_AUTHORITY = 3;
const U64_MAX = 2n ** 64n - 1n;

const decode = base64Tx => {
  try {
    return VersionedTransaction.deserialize(Buffer.from(base64Tx, 'base64'));
  } catch (e) {
    return null;
  }
};

const readU64 = (data, offset) => {
  let value = 0n;
  for (let i = 7; i >= 0; i--) {
    value = (value << 8n) + BigInt(data[offset + i] ?? 0);
  }
  return value;
};

const formatSol = lamports => {
  const fraction = (lamports % 1000000000n)
    .toString()
    .padStart(9, '0')
    .replace(/0+$/, '');
  return `${lamports / 1000000000n}${fraction ? `.${fraction}` : ''} SOL`;
};

// One instruction → {program, accounts, data}; accounts from address lookup
// tables cannot be resolved offline and come back as null.
const instructionsOf = tx => {
  const keys = tx.message.staticAccountKeys.map(key => key.toBase58());
  return tx.message.compiledInstructions.map(ix => ({
    program: keys[ix.programIdIndex] ?? null,
    accounts: ix.accountKeyIndexes.map(index => keys[index] ?? null),
    data: ix.data,
  }));
};

const takeoverOf = (ix, wallet) => {
  if (
    ix.program === SYSTEM_PROGRAM &&
    ix.data.length >= 4 &&
    ix.data[0] === SYSTEM_ASSIGN &&
    ix.data[1] === 0 &&
    ix.data[2] === 0 &&
    ix.data[3] === 0 &&
    ix.accounts[0] === wallet
  ) {
    return 'This request assigns your wallet account to another program, which would take control of it.';
  }
  if (
    TOKEN_PROGRAMS.includes(ix.program) &&
    ix.data[0] === TOKEN_SET_AUTHORITY &&
    ix.accounts[1] === wallet &&
    TOKEN_ACCOUNT_AUTHORITIES.includes(ix.data[1])
  ) {
    const newAuthority =
      ix.data[2] === 1 ? new PublicKey(ix.data.slice(3, 35)).toBase58() : null;
    // Clearing the close authority hands it back to the account owner.
    const clearsCloseAuthority =
      ix.data[1] === CLOSE_ACCOUNT_AUTHORITY && newAuthority === null;
    if (newAuthority !== wallet && !clearsCloseAuthority) {
      return 'This request hands control of one of your token accounts to another address.';
    }
  }
  return null;
};

export const getSolanaTakeoverReason = (base64Tx, walletAddress) => {
  const tx = decode(base64Tx);
  if (!tx) {
    return null;
  }
  for (const ix of instructionsOf(tx)) {
    const reason = takeoverOf(ix, walletAddress);
    if (reason) {
      return reason;
    }
  }
  return null;
};

const reviewOne = (base64Tx, wallet, result, raise, prefix) => {
  const tx = decode(base64Tx);
  if (!tx) {
    raise('danger', 'This Solana transaction could not be read.');
    return;
  }
  const label = name => `${prefix}${name}`;
  result.rows.push({
    label: label('Fee payer'),
    value: tx.message.staticAccountKeys[0]?.toBase58() ?? '—',
  });
  const unknownPrograms = [];
  instructionsOf(tx).forEach(ix => {
    const takeover = takeoverOf(ix, wallet);
    if (takeover) {
      result.blocked = true;
      raise('danger', `${takeover} It cannot be signed.`);
      return;
    }
    if (ix.program === SYSTEM_PROGRAM) {
      if (ix.data[0] === SYSTEM_TRANSFER && ix.accounts[0] === wallet) {
        result.rows.push({
          label: label('Sends'),
          value: `${formatSol(readU64(ix.data, 4))} to ${
            ix.accounts[1] ?? '—'
          }`,
        });
      }
      return;
    }
    if (TOKEN_PROGRAMS.includes(ix.program)) {
      const op = ix.data[0];
      if (op === TOKEN_APPROVE || op === TOKEN_APPROVE_CHECKED) {
        const delegate = ix.accounts[op === TOKEN_APPROVE ? 1 : 2];
        const owner = ix.accounts[op === TOKEN_APPROVE ? 2 : 3];
        if (owner !== wallet) {
          return;
        }
        const amount = readU64(ix.data, 1);
        result.rows.push(
          {label: label('Delegate'), value: String(delegate)},
          {
            label: label('Amount'),
            value: amount === U64_MAX ? 'Unlimited' : amount.toString(),
          },
        );
        if (amount === U64_MAX) {
          raise(
            'danger',
            `Gives ${delegate} unlimited access to one of your token accounts.`,
          );
        } else if (amount > 0n) {
          raise(
            'warn',
            `Lets ${delegate} spend this amount from one of your token accounts.`,
          );
        }
      } else if (op === TOKEN_SET_AUTHORITY && ix.accounts[1] === wallet) {
        raise(
          'warn',
          'Changes an authority you hold on a token mint or account.',
        );
      }
      return;
    }
    if (READ_ONLY_PROGRAMS.includes(ix.program)) {
      return;
    }
    const program = ix.program ?? 'unknown';
    if (!unknownPrograms.includes(program)) {
      unknownPrograms.push(program);
    }
  });
  if (unknownPrograms.length) {
    result.rows.push({
      label: label('Other programs'),
      value: unknownPrograms.join(', '),
    });
    raise(
      'danger',
      'This transaction calls programs the wallet cannot check. Only continue if you trust this site.',
    );
  }
};

export const reviewSolanaRequest = (signTypeData, walletAddress) => {
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
    const transactions = Array.isArray(signTypeData?.transactions)
      ? signTypeData.transactions
      : [signTypeData?.transaction];
    if (transactions.length > 1) {
      result.rows.push({
        label: 'Transactions',
        value: `${transactions.length}`,
      });
    }
    transactions.forEach((tx, i) =>
      reviewOne(
        tx,
        walletAddress,
        result,
        raise,
        transactions.length > 1 ? `#${i + 1} ` : '',
      ),
    );
  } catch (e) {
    raise('danger', 'This Solana transaction could not be read.');
  }
  return result;
};
