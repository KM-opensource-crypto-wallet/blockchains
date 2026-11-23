/**
 * Best-effort decoding of EVM calldata for user-facing review screens
 * (WalletConnect wallet_sendCalls). Known token standards decode to a method
 * name and named arguments; anything else is flagged so the user reviews the
 * raw calldata before approving.
 */
import {ethers} from 'ethers';
import erc20Abi from 'dok-wallet-blockchain-networks/abis/erc20.json';
import erc721Abi from 'dok-wallet-blockchain-networks/abis/erc721.json';
import erc1155Abi from 'dok-wallet-blockchain-networks/abis/erc1155.json';
import batchAbi from 'dok-wallet-blockchain-networks/abis/contractABI.json';

export const UNDECODABLE_CALLDATA_WARNING =
  'This call could not be decoded. Review the full calldata below before approving.';

const KNOWN_INTERFACES = [
  {standard: 'ERC-20', abi: erc20Abi},
  {standard: 'ERC-721', abi: erc721Abi},
  {standard: 'ERC-1155', abi: erc1155Abi},
];
let interfaces;
let batchInterface;

const isEmptyCalldata = data =>
  data == null || data === '' || data === '0x' || data === '0x0';

const stringifyArg = value => {
  if (Array.isArray(value)) {
    return value.map(stringifyArg);
  }
  if (typeof value === 'bigint') {
    return value.toString();
  }
  return value;
};

/**
 * @param {string|undefined} data  hex calldata
 * @returns {{kind:'empty'}
 *   | {kind:'decoded', standard:string, method:string, signature:string, args:Record<string,any>}
 *   | {kind:'unknown', selector?:string, data:string}}
 */
export const decodeEvmCalldata = data => {
  if (isEmptyCalldata(data)) {
    return {kind: 'empty'};
  }
  if (typeof data !== 'string' || !ethers.isHexString(data)) {
    return {kind: 'unknown', data: String(data)};
  }
  const selector = data.length >= 10 ? data.slice(0, 10) : undefined;
  interfaces ??= KNOWN_INTERFACES.map(({standard, abi}) => ({
    standard,
    iface: new ethers.Interface(abi),
  }));
  for (const {standard, iface} of interfaces) {
    let parsed;
    try {
      parsed = iface.parseTransaction({data});
    } catch (e) {
      parsed = null;
    }
    if (parsed) {
      const args = {};
      parsed.fragment.inputs.forEach((input, index) => {
        args[input.name || `arg${index}`] = stringifyArg(parsed.args[index]);
      });
      return {
        kind: 'decoded',
        standard,
        method: parsed.name,
        signature: parsed.signature,
        args,
      };
    }
  }
  return {kind: 'unknown', selector, data};
};

// executeSponsored carries the calls in its batch struct, and the legacy 7-arg
// execute(feeToken, feeRecipient, feeAmount, calls, ...) at index 3.
const batchCallsOf = decoded => {
  const args = decoded?.args;
  if (decoded?.fragment?.name === 'executeSponsored') {
    return args?.[0]?.[0];
  }
  return args?.length === 7 ? args[3] : args?.[0];
};

/** Calls of a batch `execute` (in-app or sponsored, any version); [] for other data. */
export const decodeBatchExecuteCalls = data => {
  try {
    batchInterface ??= new ethers.Interface(batchAbi);
    const calls = batchCallsOf(batchInterface.parseTransaction({data}));
    return Array.isArray(calls)
      ? calls.map(call => ({
          to: call[0],
          value: call[1].toString(),
          data: call[2],
        }))
      : [];
  } catch (e) {
    return [];
  }
};

const ERROR_STRING_SELECTOR = '0x08c379a0';

// Revert data of a failed estimate, call or send, wherever ethers put it.
const getRevertData = error => {
  for (const value of [error?.data, error?.info?.error?.data, error?.error]) {
    const data = typeof value === 'string' ? value : value?.data;
    if (
      typeof data === 'string' &&
      ethers.isHexString(data) &&
      data.length >= 10
    ) {
      return data;
    }
  }
  return null;
};

// The Error(string) text a failed call in the batch reverted with, if any.
const getCallRevertReason = reason => {
  try {
    if (
      typeof reason === 'string' &&
      reason.startsWith(ERROR_STRING_SELECTOR)
    ) {
      return ethers.AbiCoder.defaultAbiCoder().decode(
        ['string'],
        ethers.dataSlice(reason, 4),
      )[0];
    }
  } catch (e) {}
  return null;
};

/**
 * A readable message for a revert of the batch contract (BatchExecutor), or
 * null for any other error. Messages start with "The" so the Transfer screen
 * shows them (currentTransferSlice.calculateEstimateFee).
 */
export const describeBatchExecuteError = error => {
  const data = getRevertData(error);
  if (!data) {
    return null;
  }
  let parsed;
  try {
    batchInterface ??= new ethers.Interface(batchAbi);
    parsed = batchInterface.parseError(data);
  } catch (e) {
    return null;
  }
  // An ethers Result throws when read past its length (EmptyBatch has no args).
  const [first, second] = parsed ? Array.from(parsed.args) : [];
  const call = `call ${Number(first) + 1}`;
  switch (parsed?.name) {
    case 'TooManyCalls':
      return `The batch has ${first} calls; at most ${second} can be sent together. Remove some and try again.`;
    case 'EmptyBatch':
      return 'The batch has no calls.';
    case 'InvalidTarget':
      return `The batch's ${call} goes to an address that cannot receive it.`;
    case 'CallFailed': {
      const reason = getCallRevertReason(second);
      return `The batch's ${call} would fail${reason ? `: ${reason}` : ''}.`;
    }
    case 'TokenCallReturnedFalse':
      return `The batch's ${call} was refused by the token contract.`;
    case 'Unauthorized':
    case 'NotDelegated':
      return 'The batch can only be sent by the account itself.';
    default:
      return null;
  }
};
