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
const TOKEN_TRANSFER = 3;
const TOKEN_APPROVE = 4;
const TOKEN_SET_AUTHORITY = 6;
const TOKEN_TRANSFER_CHECKED = 12;
const TOKEN_APPROVE_CHECKED = 13;
// spl-token AuthorityType: AccountOwner = 2, CloseAccount = 3.
const TOKEN_ACCOUNT_AUTHORITIES = [2, 3];
const CLOSE_ACCOUNT_AUTHORITY = 3;
const U64_MAX = 2n ** 64n - 1n;

// Accounts loaded from an address lookup table cannot be resolved offline.
const LOOKUP_TABLE_ADDRESS = 'an address from a lookup table (not shown)';
const LOOKUP_TABLE_REASON =
  'This transaction uses addresses from an address lookup table that the wallet cannot show. Only continue if you trust this site.';

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

const formatUnits = (amount, decimals) => {
  const base = 10n ** BigInt(decimals);
  const fraction = (amount % base)
    .toString()
    .padStart(decimals, '0')
    .replace(/0+$/, '');
  return `${amount / base}${fraction ? `.${fraction}` : ''}`;
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
  const shown = (...addresses) => {
    if (addresses.some(address => address == null)) {
      raise('danger', LOOKUP_TABLE_REASON);
    }
    return addresses.map(address => address ?? LOOKUP_TABLE_ADDRESS);
  };
  instructionsOf(tx).forEach(ix => {
    const takeover = takeoverOf(ix, wallet);
    if (takeover) {
      result.blocked = true;
      raise('danger', `${takeover} It cannot be signed.`);
      return;
    }
    if (ix.program === SYSTEM_PROGRAM) {
      if (ix.data[0] === SYSTEM_TRANSFER && ix.accounts[0] === wallet) {
        const [destination] = shown(ix.accounts[1]);
        result.rows.push({
          label: label('Sends'),
          value: `${formatSol(readU64(ix.data, 4))} to ${destination}`,
        });
      }
      return;
    }
    if (TOKEN_PROGRAMS.includes(ix.program)) {
      const op = ix.data[0];
      if (op === TOKEN_TRANSFER || op === TOKEN_TRANSFER_CHECKED) {
        // Transfer: source, destination, owner. TransferChecked: source,
        // mint, destination, owner (+ decimals in the data).
        const checked = op === TOKEN_TRANSFER_CHECKED;
        if (ix.accounts[checked ? 3 : 2] === wallet) {
          const amount = readU64(ix.data, 1);
          const [destination, mint] = shown(
            ix.accounts[checked ? 2 : 1],
            ...(checked ? [ix.accounts[1]] : []),
          );
          result.rows.push({
            label: label('Sends tokens'),
            value: checked
              ? `${formatUnits(
                  amount,
                  ix.data[9] ?? 0,
                )} of ${mint} to token account ${destination}`
              : `${amount} (smallest unit) to token account ${destination}`,
          });
        }
        return;
      }
      if (op === TOKEN_APPROVE || op === TOKEN_APPROVE_CHECKED) {
        const delegate = ix.accounts[op === TOKEN_APPROVE ? 1 : 2];
        const owner = ix.accounts[op === TOKEN_APPROVE ? 2 : 3];
        if (owner !== wallet) {
          return;
        }
        const amount = readU64(ix.data, 1);
        result.rows.push(
          {label: label('Delegate'), value: shown(delegate)[0]},
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

// `method` picks the field the signer uses: SolanaChain signs `transactions`
// for solana_signAllTransactions and `transaction` for the other methods.
export const reviewSolanaRequest = (signTypeData, walletAddress, method) => {
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
    const all =
      method === undefined
        ? Array.isArray(signTypeData?.transactions)
        : method === 'solana_signAllTransactions';
    let transactions = [signTypeData?.transaction];
    if (all) {
      transactions = Array.isArray(signTypeData?.transactions)
        ? signTypeData.transactions
        : [undefined];
    }
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
