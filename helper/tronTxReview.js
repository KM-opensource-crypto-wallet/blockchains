/*
 * Review of a Tron WalletConnect transaction (pure, never throws). TronWeb's
 * trx.sign rejects a transaction whose raw_data does not match raw_data_hex and
 * txID, so the JSON read here is what gets signed. AccountPermissionUpdate
 * (hands the account to other keys) is refused; approvals are graded like EVM
 * approvals; contract calls and types the wallet cannot read are danger.
 */
import bs58 from 'bs58';
import {getBytes, sha256} from 'ethers';

const LEVEL_RANK = {none: 0, warn: 1, danger: 2};
const UNLIMITED = 2n ** 128n;
const TAKEOVER_TYPES = ['AccountPermissionUpdateContract'];
// Staking and resource management: they never move funds to another owner.
const RESOURCE_TYPES = [
  'FreezeBalanceContract',
  'UnfreezeBalanceContract',
  'FreezeBalanceV2Contract',
  'UnfreezeBalanceV2Contract',
  'WithdrawExpireUnfreezeContract',
  'CancelAllUnfreezeV2Contract',
  'DelegateResourceContract',
  'UnDelegateResourceContract',
  'VoteWitnessContract',
  'WithdrawBalanceContract',
];

const contractsOf = tx =>
  Array.isArray(tx?.raw_data?.contract) ? tx.raw_data.contract : null;

export const getTronTakeoverReason = tx => {
  const contracts = contractsOf(tx) || [];
  return contracts.some(c => TAKEOVER_TYPES.includes(c?.type))
    ? 'This request changes who controls your Tron account (AccountPermissionUpdate).'
    : null;
};

// 41-prefixed hex → base58check "T…" address; anything else as given.
const toTronAddress = value => {
  if (typeof value !== 'string' || !/^41[0-9a-fA-F]{40}$/.test(value)) {
    return String(value);
  }
  try {
    const payload = getBytes(`0x${value}`);
    const checksum = getBytes(sha256(sha256(payload))).slice(0, 4);
    return bs58.encode(Uint8Array.from([...payload, ...checksum]));
  } catch (e) {
    return value;
  }
};

const wordAt = (data, index) =>
  data.slice(8 + index * 64, 8 + (index + 1) * 64);
const addressWord = (data, index) =>
  toTronAddress(`41${wordAt(data, index).slice(24)}`);
const uintWord = (data, index) => {
  try {
    return BigInt(`0x${wordAt(data, index) || '0'}`);
  } catch (e) {
    return 0n;
  }
};

const formatTrx = sun => {
  const value = BigInt(sun || 0);
  const fraction = (value % 1000000n)
    .toString()
    .padStart(6, '0')
    .replace(/0+$/, '');
  return `${value / 1000000n}${fraction ? `.${fraction}` : ''} TRX`;
};

export const reviewTronTransaction = tx => {
  const result = {level: 'none', reasons: [], rows: [], blocked: false};
  const raise = (level, reason) => {
    if (LEVEL_RANK[level] > LEVEL_RANK[result.level]) {
      result.level = level;
    }
    if (reason && !result.reasons.includes(reason)) {
      result.reasons.push(reason);
    }
  };
  const contracts = contractsOf(tx);
  if (!contracts?.length) {
    raise('danger', 'This Tron transaction could not be read.');
    return result;
  }
  const takeover = getTronTakeoverReason(tx);
  if (takeover) {
    result.blocked = true;
    raise('danger', `${takeover} It cannot be signed.`);
  }
  try {
    contracts.forEach(contract => {
      const type = contract?.type;
      const value = contract?.parameter?.value || {};
      result.rows.push({label: 'Type', value: String(type)});
      if (TAKEOVER_TYPES.includes(type) || RESOURCE_TYPES.includes(type)) {
        return;
      }
      if (type === 'TransferContract') {
        result.rows.push(
          {label: 'To', value: toTronAddress(value.to_address)},
          {label: 'Amount', value: formatTrx(value.amount)},
        );
        return;
      }
      if (type === 'TransferAssetContract') {
        result.rows.push(
          {label: 'To', value: toTronAddress(value.to_address)},
          {
            label: 'Amount',
            value: `${value.amount} (token ${value.asset_name})`,
          },
        );
        return;
      }
      if (type !== 'TriggerSmartContract') {
        raise(
          'danger',
          `This Tron transaction type (${type}) is not checked by the wallet.`,
        );
        return;
      }
      const data = String(value.data || '')
        .replace(/^0x/i, '')
        .toLowerCase();
      const selector = data.slice(0, 8);
      result.rows.push({
        label: 'Contract',
        value: toTronAddress(value.contract_address),
      });
      if (BigInt(value.call_value || 0) > 0n) {
        result.rows.push({
          label: 'Also sends',
          value: formatTrx(value.call_value),
        });
      }
      // TRC-10 tokens attached to the call go to the contract as well.
      if (BigInt(value.call_token_value || 0) > 0n) {
        result.rows.push({
          label: 'Also sends TRC-10',
          value: `${value.call_token_value} of token ${value.token_id}`,
        });
        raise('warn', 'This call also sends TRC-10 tokens to the contract.');
      }
      if (selector === 'a9059cbb') {
        result.rows.push(
          {label: 'To', value: addressWord(data, 0)},
          {label: 'Amount', value: uintWord(data, 1).toString()},
        );
      } else if (selector === '095ea7b3') {
        const spender = addressWord(data, 0);
        const amount = uintWord(data, 1);
        result.rows.push(
          {label: 'Spender', value: spender},
          {
            label: 'Amount',
            value: amount >= UNLIMITED ? 'Unlimited' : amount.toString(),
          },
        );
        if (amount >= UNLIMITED) {
          raise(
            'danger',
            `Gives ${spender} unlimited access to this token. It can move your entire balance at any time.`,
          );
        } else if (amount > 0n) {
          raise(
            'warn',
            `Lets ${spender} spend this amount of the token on your behalf.`,
          );
        }
      } else {
        result.rows.push({label: 'Function selector', value: `0x${selector}`});
        raise(
          'danger',
          'This transaction calls a contract function the wallet cannot check. Only continue if you trust this site.',
        );
      }
    });
  } catch (e) {
    raise('danger', 'This Tron transaction could not be read.');
  }
  return result;
};
