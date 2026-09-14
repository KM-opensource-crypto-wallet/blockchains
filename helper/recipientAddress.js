import {getChain} from 'dok-wallet-blockchain-networks/cryptoChain';
import {isNameSupportChain} from 'dok-wallet-blockchain-networks/helper';

/**
 * Resolve what the user typed in a "Send to" field into an address the chain
 * accepts: either a directly valid address, or (on name-support chains such as
 * ENS) a name that resolves to one.
 *
 * Shared by the SendFunds / SchedulePayment screens (immediate feedback) and
 * the submitScheduledPayment thunk (safety net, since a scheduled payment is
 * built later with no user in the loop).
 *
 * @returns {{isValid: boolean, validAddress: string|null, resolvedAddress: string|null}}
 *   `validAddress` is the address a name resolved to (null when the input was
 *   already an address or nothing resolved); `resolvedAddress` is what should
 *   actually be sent to, or null when the input is unusable.
 */
export const resolveRecipientAddress = async ({
  chain_name,
  phrase,
  customRPC,
  address,
}) => {
  const trimmed = typeof address === 'string' ? address.trim() : '';
  if (!trimmed) {
    return {isValid: false, validAddress: null, resolvedAddress: null};
  }
  const chain = getChain(chain_name, phrase, customRPC);
  const isValid = !!(await chain?.isValidAddress({address: trimmed}));
  let validAddress = null;
  if (!isValid && isNameSupportChain(chain_name)) {
    validAddress = (await chain?.isValidName?.({name: trimmed})) || null;
  }
  return {
    isValid,
    validAddress,
    resolvedAddress: isValid ? trimmed : validAddress,
  };
};
