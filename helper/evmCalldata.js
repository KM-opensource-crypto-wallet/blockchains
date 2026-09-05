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

export const UNDECODABLE_CALLDATA_WARNING =
  'This call could not be decoded. Review the full calldata below before approving.';

const KNOWN_INTERFACES = [
  {standard: 'ERC-20', abi: erc20Abi},
  {standard: 'ERC-721', abi: erc721Abi},
  {standard: 'ERC-1155', abi: erc1155Abi},
];
let interfaces;

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
