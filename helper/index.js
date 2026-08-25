import BigNumber from 'bignumber.js';
import {ethers, isHexString, parseUnits, toUtf8String} from 'ethers';
import dayjs from 'dayjs';
import duration from 'dayjs/plugin/duration';
import {APP_VERSION} from 'utils/common';
import {
  config,
  SCAN_URL,
  IS_SANDBOX,
  CHAIN_CONFIG,
} from 'dok-wallet-blockchain-networks/config/config';

import bs58 from 'bs58';
import {getRPCUrl} from 'dok-wallet-blockchain-networks/rpcUrls/rpcUrls';
import {rpcSessionAdapter} from 'dok-wallet-blockchain-networks/rpcUrls/rpcSession';
import axios from 'axios';
dayjs.extend(duration);

export const getTokenLogoUrl = contractAddress => {
  try {
    const checksumAddress = ethers.getAddress(contractAddress);
    return `https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/ethereum/assets/${checksumAddress}/logo.png`;
  } catch {
    return null;
  }
};

export function getCustomizePublicAddress(str) {
  if (!str) {
    return '';
  }
  if (str.length <= 23) {
    return str;
  }
  return `${str.substring(0, 10)}...${str.substring(
    str.length - 10,
    str.length,
  )}`;
}

export function capitalizeFirstLetter(str) {
  if (typeof str === 'string' && str) {
    return str[0].toUpperCase() + str.slice(1);
  }
  return '';
}

export function delay(localDuration) {
  return new Promise(resolve => {
    setTimeout(() => {
      resolve();
    }, localDuration);
  });
}

export function debounce(callback, timer) {
  let timeoutId;

  return (...args) => {
    const context = this;

    clearTimeout(timeoutId);
    timeoutId = setTimeout(() => {
      callback.apply(context, args);
    }, timer);
  };
}

export function parseCryptoQrCodeString(qrCodeString) {
  const parts = qrCodeString.split(':');
  if (parts.length !== 2) {
    return {address: qrCodeString};
  }

  const scheme = parts[0]?.toUpperCase();
  const addressPart = parts[1].split('?');

  if (addressPart.length < 1) {
    throw new Error('Invalid QR code string format');
  }

  const address = addressPart[0];
  const parameters = {};

  if (addressPart.length > 1) {
    const queryParams = addressPart[1].split('&');
    queryParams.forEach(queryParam => {
      const [key, value] = queryParam.split('=');
      parameters[key] = value;
    });
  }

  return {
    scheme,
    address,
    parameters,
  };
}

export function validateSupportedChain(chain_name) {
  if (ethereumChains[chain_name]) {
    return ethereumChains[chain_name];
  } else if (supportedChain.includes(chain_name)) {
    return chain_name;
  }
  return null;
}

export function generateUniqueKeyForChain(chainData) {
  return `${chainData?.chain_name?.toLowerCase()}_${chainData?.symbol?.toUpperCase()}`;
}
function formatUnits(value, decimals) {
  let digits = BigInt(value).toString();
  const sign = digits.startsWith('-') ? '-' : '';
  if (sign) {
    digits = digits.slice(1);
  }
  if (!decimals) {
    return sign + digits;
  }
  digits = digits.padStart(decimals + 1, '0');
  const whole = digits.slice(0, -decimals);
  const fraction = digits.slice(-decimals).replace(/0+$/, '') || '0';
  return `${sign}${whole}.${fraction}`;
}

export function parseBalance(tokenPrice, tokenDecimals) {
  try {
    if (!tokenPrice || !tokenDecimals) {
      return '0';
    }
    const bnTokenPrice = new BigNumber(tokenPrice).toFixed(0);
    return formatUnits(bnTokenPrice, Number(tokenDecimals));
  } catch (e) {
    console.error('Error in price', e);
    return '0';
  }
}

export function calculatePrice(tokenPrice, tokenDecimals, realPrice) {
  try {
    if (!tokenPrice || !tokenDecimals || !realPrice) {
      return '0';
    }
    const sanitizedPrice = new BigNumber(tokenPrice).toFixed(0);
    const parseBalString = formatUnits(sanitizedPrice, Number(tokenDecimals));
    const parseBal = new BigNumber(parseBalString);
    const currentPriceBigNumber = new BigNumber(realPrice);
    const finalPrice = parseBal.multipliedBy(currentPriceBigNumber);
    return finalPrice.toFixed(2);
  } catch (e) {
    console.error('Error in calculatePrice', e);
    return '0';
  }
}

export function convertToSmallAmount(tokenPrice, tokenDecimals) {
  try {
    if (!tokenPrice || !tokenDecimals) {
      return '0';
    }
    // Use toFixed to prevent scientific notation and ensure proper decimal handling
    const sanitizedPrice = new BigNumber(tokenPrice).toFixed(
      Number(tokenDecimals),
    );
    return parseUnits(sanitizedPrice, Number(tokenDecimals)).toString();
  } catch (e) {
    console.error('Error in convertToSmallAmount', e);
    return '0';
  }
}

export function isBalanceNotAvailable(balanceAmount, trAmount, otherTrAmount) {
  try {
    const balanceBN = new BigNumber(balanceAmount);
    let trAmountBN = new BigNumber(trAmount);
    if (otherTrAmount) {
      trAmountBN = trAmountBN.plus(new BigNumber(otherTrAmount));
    }
    return balanceBN.lt(trAmountBN);
  } catch (e) {
    return true;
  }
}

export function validateNumber(number) {
  const validNumber = Number(number);
  return isNaN(validNumber) || !Number.isFinite(validNumber)
    ? null
    : validNumber;
}

export function validateBigNumberStr(number) {
  try {
    const validNumber = new BigNumber(number);
    if (!validNumber.isFinite() || validNumber.isNaN()) {
      return '0';
    }
    // toFixed, never toString: BigNumber switches to scientific notation below
    // 1e-7 by default, and this feeds real send/stake amounts.
    return validNumber.toFixed();
  } catch (error) {
    return '0';
  }
}
export function validateNumberInInput(text, decimals = 18) {
  // Normalize locale-specific decimal separator (comma → dot)
  text = text.replace(',', '.');

  // Remove leading zeros unless it's something like "0." or just "0"
  while (text.charAt(0) === '0' && text.charAt(1) !== '.' && text.length > 1) {
    text = text.substring(1);
  }

  // Check if it's a valid number or empty string
  if (!isNaN(text) || text === '') {
    const parts = text.split('.');

    // If there's a decimal part, check its length
    if (parts.length === 2 && parts[1].length > decimals) {
      parts[1] = parts[1].slice(0, decimals); // Trim to 6 decimal places
      return parts.join('.');
    }

    return text;
  }

  return '0';
}

export function isValidStringWithValue(str) {
  return typeof str === 'string' && str;
}

export function convertStrToHex(str) {
  try {
    // eslint-disable-next-line no-undef
    const buffer = Buffer.from(str, 'utf-8');
    return buffer.toString('hex');
  } catch (e) {
    return '';
  }
}
export function convertHexToUtf8IfPossible(hex) {
  try {
    if (isHexString(hex)) {
      return toUtf8String(hex);
    }
    return hex;
  } catch (e) {
    return hex;
  }
}

export function addMinutes(minutes) {
  return new Date(new Date().getTime() + minutes * 60000);
}
export const isAfterCurrentDate = compareDate => {
  let date1 = new Date().getTime();
  let date2 = new Date(compareDate).getTime();
  return date2 < date1;
};

export const isValidBigInt = value => {
  try {
    return BigInt(value);
  } catch (e) {
    return null;
  }
};

const chainEntries = Object.entries(CHAIN_CONFIG);

const chainsWith = flag =>
  chainEntries
    .filter(([, chainConfig]) => chainConfig[flag])
    .map(([chain_name]) => chain_name);

const supportedChain = chainsWith('supported');
const BITCOIN_CHAINS = chainsWith('is_bitcoin');
const LITECOIN_CHAINS = chainsWith('is_litecoin');
const EVM_CHAINS = chainsWith('is_evm');
const ethereumChains = Object.fromEntries(
  EVM_CHAINS.map(chain_name => [chain_name, 'ethereum']),
);
const OPTIONS_GAS_FEES_CHAIN = chainsWith('gas_fee_options');
const EIP_1559_NOT_SUPPORTED = chainsWith('eip_1559_not_supported');
const UNCLAIM_DEPOSIT_SUPPORTED_CHAINS = chainsWith('unclaim_deposit');
const EIP_7702_SUPPORTED_CHAIN = chainsWith('eip_7702');
const DERIVE_ADDRESS_SUPPORT_CHAIN = [
  ...EVM_CHAINS,
  ...chainsWith('derive_address'),
];
const STAKING_CHAINS = chainEntries
  .filter(([, chainConfig]) => chainConfig.staking_keys)
  .flatMap(([chain_name, chainConfig]) =>
    chainConfig.staking_keys.map(symbol => `${chain_name}_${symbol}`),
  );
const VALIDATORS_SUPPORT_IN_CREATE_STAKING_SCREEN = chainsWith(
  'staking_validators_screen',
);
const SUPPORT_RESOURCE_TYPE_CREATE_STAKING_SCREEN =
  chainsWith('staking_resources');
const feesOptionsChains = chainsWith('fees_options');
const TRANSACTION_LIST_LIMIT_100 = chainsWith('tx_list_limit_100');
const EPOCH_TIME_SUPPORT_CHAIN = chainsWith('epoch_time');
const UNSTAKING_BUTTON_CHAIN = chainsWith('unstaking_button');
const VOTE_BUTTON_CHAIN = chainsWith('vote_button');
const MEMO_SUPPORT_CHAIN = chainsWith('memo_support');
const NAME_SUPPORT_IN_ADDRESS = chainsWith('address_name_support');
const TRANSACTION_LIST_NOT_SUPPORTED_CHAINS = chainsWith(
  'tx_list_not_supported',
);
const CUSTOM_ADDRESS_NOT_SUPPORTED_CHAINS = chainsWith(
  'custom_address_not_supported',
);
const PRIVATE_KEY_NOT_SUPPORTED_CHAINS = chainsWith(
  'private_key_not_supported',
);

export const isBitcoinChain = chain_name => BITCOIN_CHAINS.includes(chain_name);

export const isLitecoinChain = chain_name =>
  LITECOIN_CHAINS.includes(chain_name);

export const isEVMChain = chain_name => EVM_CHAINS.includes(chain_name);

// Chains whose DEX swaps need an on-chain token allowance before the swap:
// EVM (ERC20) and Tron (TRC20). Solana bundles the whole route into the
// signed transaction itself, so it never needs an approval step.
export const isSwapApprovalChain = chain_name =>
  isEVMChain(chain_name) || chain_name === 'tron';

// The single definition of "this exchange is a DEX swap" (provider returned
// executable calldata) vs a deposit-address provider (plain send). Keep every
// layer on this predicate instead of re-deriving it inline.
export const isDexSwap = swapData => Boolean(swapData);

// A DEX quote needs the allowance flow only when the provider named a
// spender AND the source is a token on an approval chain (ERC20/TRC20).
// Native-coin sources and Solana bundle everything into the signed tx.
export const swapNeedsApproval = ({swapData, asset}) =>
  Boolean(swapData?.spender) &&
  isSwapApprovalChain(asset?.chain_name) &&
  Boolean(asset?.contractAddress);

// Shared across chains so the UI can treat an expired quote uniformly:
// sendFunds matches on this exact message to toast and route the user back
// to the Exchange screen for a fresh quote.
export const SWAP_QUOTE_EXPIRED_ERROR =
  'Swap simulation failed — the quote may have expired or the provider route is currently failing. Please refresh the quote or try another provider.';

export const isSwapBlockingError = message =>
  message === SWAP_QUOTE_EXPIRED_ERROR;

export const isEip1559NotSupported = chain_name =>
  EIP_1559_NOT_SUPPORTED.includes(chain_name);

export const isUnclaimDepositSupportedChain = chain_name =>
  UNCLAIM_DEPOSIT_SUPPORTED_CHAINS.includes(chain_name);

export const isEip7702SupportedChain = chain_name =>
  EIP_7702_SUPPORTED_CHAIN.includes(chain_name);

export const isOptionGasFeesChain = chain_name =>
  OPTIONS_GAS_FEES_CHAIN.includes(chain_name);

export const isDeriveAddressSupportChain = chain_name =>
  DERIVE_ADDRESS_SUPPORT_CHAIN.includes(chain_name);

export const isStakingChain = chain_name => STAKING_CHAINS.includes(chain_name);

export const getStakignKey = (chain_name, symbol) =>
  `${chain_name}_${symbol}`.toLowerCase();

export const isValidatorSupportCreateStakingScreen = chain_name =>
  VALIDATORS_SUPPORT_IN_CREATE_STAKING_SCREEN.includes(chain_name);

export const isHaveResourceTypeInCreateStakingScreen = chain_name =>
  SUPPORT_RESOURCE_TYPE_CREATE_STAKING_SCREEN.includes(chain_name);

const layer2Chains = Object.keys(CHAIN_CONFIG).filter(
  chain_name => CHAIN_CONFIG[chain_name].gas_oracle,
);

export const isLayer2Chain = chain_name => layer2Chains.includes(chain_name);

export const isFeesOptionChain = chain_name =>
  feesOptionsChains.includes(chain_name);

export const isTransactionListLimit100 = chain_name =>
  TRANSACTION_LIST_LIMIT_100.includes(chain_name);

export const isSupportEpochTime = chain_name =>
  EPOCH_TIME_SUPPORT_CHAIN.includes(chain_name);

export const isShowUnstakingButton = chain_name =>
  UNSTAKING_BUTTON_CHAIN.includes(chain_name);

export const isShowVoteButton = chain_name =>
  VOTE_BUTTON_CHAIN.includes(chain_name);

export const isMemoSupportChain = chain_name =>
  MEMO_SUPPORT_CHAIN.includes(chain_name);

export const isNameSupportChain = chain_name =>
  NAME_SUPPORT_IN_ADDRESS.includes(chain_name);

export const isTransactionListNotSupported = (chain_name, type) =>
  TRANSACTION_LIST_NOT_SUPPORTED_CHAINS.includes(chain_name) ||
  (chain_name === 'solana' && type !== 'coin');

export const isCustomAddressNotSupportedChain = chain_name =>
  CUSTOM_ADDRESS_NOT_SUPPORTED_CHAINS.includes(chain_name);

export const isPendingTransactionSupportedChain = chain_name =>
  EVM_CHAINS.includes(chain_name);

export const isPrivateKeyNotSupportedChain = chain_name => {
  return PRIVATE_KEY_NOT_SUPPORTED_CHAINS.includes(chain_name);
};

export const isAddressOrPrivateKeyExists = coin => {
  const chain_name = coin?.chain_name;
  if (coin?.privateKey && coin?.address && !isBitcoinChain(chain_name)) {
    return true;
  } else if (coin?.privateKey && coin?.address && isBitcoinChain(chain_name)) {
    if (APP_VERSION !== coin.appVersion) {
      return false;
    }
    if (chain_name === 'bitcoin' || chain_name === 'bitcoin_taproot') {
      const prefix = IS_SANDBOX ? 'tb1' : 'bc1';
      return coin?.address?.startsWith(prefix);
    } else if (chain_name === 'bitcoin_legacy') {
      const prefix = IS_SANDBOX ? 'm' : '1';
      const anotherPrefix = IS_SANDBOX ? 'n' : '1';
      return (
        coin?.address?.startsWith(prefix) ||
        coin?.address?.startsWith(anotherPrefix)
      );
    } else if (chain_name === 'bitcoin_segwit') {
      const prefix = IS_SANDBOX ? '2' : '3';
      return coin?.address?.startsWith(prefix);
    }
    return false;
  } else if (coin?.privateKey && coin?.address && isLitecoinChain(chain_name)) {
    if (chain_name === 'litecoin') {
      const prefix = IS_SANDBOX ? 'tltc' : 'ltc';
      return coin?.address?.startsWith(prefix);
    }
    return false;
  } else if (coin?.address && chain_name === 'bitcoin_lightning') {
    return false;
  }
  return false;
};

export const checkValidChainForWalletImportWithPrivateKey = ({
  currentWallet,
  currentCoin,
}) => {
  const currentWalletChainName = currentWallet?.chain_name;
  const isImportWalletWithPrivateKey =
    currentWallet?.isImportWalletWithPrivateKey;
  if (!isImportWalletWithPrivateKey) {
    return true;
  }
  const coinChainName = currentCoin?.chain_name;
  if (isEVMChain(currentWalletChainName) && isEVMChain(coinChainName)) {
    return true;
  } else if (currentWalletChainName === coinChainName) {
    return true;
  }
  return false;
};

export const getNativeCoinByTokenCoin = (allCoins, tokenCoin) => {
  return tokenCoin?.type === 'token'
    ? allCoins.find(
        item =>
          item.symbol === tokenCoin?.chain_symbol &&
          item.chain_name === tokenCoin?.chain_name,
      )
    : null;
};

export const getLastIndexOfDerivations = str => {
  const parts = str.split('/');
  const lastPart = parts[parts.length - 2];
  return isNaN(lastPart) ? 0 : Number(lastPart);
};

export const multiplyBNWithFixed = (value, value2, fixed) => {
  if (!isNaN(Number(value)) && !isNaN(Number(value2))) {
    return new BigNumber(value)
      .multipliedBy(new BigNumber(value2))
      .toFixed(fixed);
  }
  return '0';
};

export const differentInCurrentTime = date => {
  const currentDate = dayjs();
  const endDate = dayjs(date);
  const diff = endDate.diff(currentDate);
  let res = dayjs.duration(diff);
  return `${
    res.days() > 0 ? `${res.days()} day(s)` : ''
  } ${res.hours()} hour(s)`;
};

export const isValidObject = data => {
  return typeof data === 'object' && !Array.isArray(data) && data !== null;
};

export function getCosmosRequiredFeeAmount(errorString) {
  const match = errorString.match(/required: (\d+)uatom/);
  return match ? match[1] : null;
}

export const GAS_CURRENCY = Object.fromEntries(
  chainEntries
    .filter(([, chainConfig]) => chainConfig.gas_currency)
    .map(([chain_name, chainConfig]) => [chain_name, chainConfig.gas_currency]),
);

export const PrivateKeyList = chainEntries
  .filter(([, chainConfig]) => chainConfig.private_key_list)
  .sort(([, a], [, b]) => a.private_key_list.order - b.private_key_list.order)
  .map(([value, chainConfig]) => ({
    label: chainConfig.private_key_list.label,
    value,
  }));

export const ModalAddTokenList = chainEntries
  .filter(([, chainConfig]) => chainConfig.add_token)
  .sort(([, a], [, b]) => a.add_token.order - b.add_token.order)
  .map(([value, chainConfig]) => {
    const {label, order, ...rest} = chainConfig.add_token;
    return {label, value, ...rest};
  });

export const CustomRPCList = chainEntries
  .filter(([, chainConfig]) => chainConfig.custom_rpc)
  .sort(([, a], [, b]) => a.custom_rpc.order - b.custom_rpc.order)
  .map(([value, chainConfig]) => ({
    label: chainConfig.custom_rpc.label,
    value,
  }));

export const MORALIS_CHAIN_TO_CHAIN = Object.fromEntries(
  chainEntries
    .filter(([, chainConfig]) => chainConfig.moralis)
    .map(([chain_name, chainConfig]) => [chainConfig.moralis.key, chain_name]),
);

export const allDerivePath = Object.fromEntries(
  chainEntries
    .filter(([, chainConfig]) => chainConfig.derivation_paths)
    .map(([chain_name, chainConfig]) => [
      chain_name,
      chainConfig.derivation_paths,
    ]),
);

const DERIVE_INDEX = Object.fromEntries(
  chainEntries
    .filter(([, chainConfig]) => chainConfig.derive_index)
    .map(([chain_name, chainConfig]) => [chain_name, chainConfig.derive_index]),
);

export const resourcesData = Object.fromEntries(
  chainEntries
    .filter(([, chainConfig]) => chainConfig.staking_resources)
    .map(([chain_name, chainConfig]) => [
      chain_name,
      chainConfig.staking_resources,
    ]),
);

// NFTs are fetched via Moralis, so the supported chains are exactly the ones
// with a moralis entry (the display keys the Moralis map uses)
export const NFT_SUPPORTED_CHAIN = chainEntries
  .filter(([, chainConfig]) => chainConfig.moralis)
  .map(([, chainConfig]) => chainConfig.moralis.key);

// Custom-derivation path templates and chain logos — both apps consume these
// (each app's 'assets' alias resolves the logo files to its own bundle).
export const DERIVATION_CONFIG = Object.fromEntries(
  chainEntries
    .filter(([, chainConfig]) => chainConfig.custom_derivation)
    .map(([chain_name, chainConfig]) => [
      chain_name,
      chainConfig.custom_derivation,
    ]),
);

export const chainLogoMap = Object.fromEntries(
  chainEntries
    .filter(([, chainConfig]) => chainConfig.logo)
    .map(([chain_name, chainConfig]) => [chain_name, chainConfig.logo]),
);
export const AUTO_LOCK = [
  {
    label: 'Immediate',
    value: 0,
  },
  {
    label: 'If away for 1 minute',
    value: 1,
  },
  {
    label: 'If away for 5 minutes',
    value: 5,
  },
  {
    label: 'If away for 1 hour',
    value: 60,
  },
  {
    label: 'If away for 5 hours',
    value: 300,
  },
];

export const getTimeOrDateAsPerToday = anotherDate => {
  const date = dayjs();
  const tempDate = dayjs(anotherDate);
  if (date.isSame(tempDate, 'date')) {
    return tempDate.format('HH:mm A');
  }
  return tempDate.format('DD/MM/YY');
};

export const getAddressDetailsUrl = (chain_name, type, address) => {
  const isEVM = isEVMChain(chain_name);
  if (isEVM) {
    if (chain_name === 'polygon') {
      const {
        getRPCUrl,
      } = require('dok-wallet-blockchain-networks/rpcUrls/rpcUrls');
      chain_name = getRPCUrl('polygon_blockscout')
        ? 'polygon_blockscout'
        : 'polygon_scan';
    }
    return `${SCAN_URL[chain_name].baseUrl}/address/${address}${
      type === 'token' ? '#tokentxns' : ''
    }`;
  } else if (chain_name === 'tron') {
    return `${config.TRON_SCAN_URL}/address/${address}/${
      type === 'token' ? 'transfers' : ''
    }`;
  } else if (chain_name === 'bitcoin') {
    return `${config.BITCOIN_SCAN_URL}/address/${address}`;
  } else if (chain_name === 'litecoin') {
    return `${config.LITECOIN_SCAN_URL}/address/${address}`;
  } else if (chain_name === 'solana') {
    return `${config.SOLANA_SCAN_URL}/address/${address}${
      IS_SANDBOX ? '?cluster=devnet' : ''
    }`;
  } else if (chain_name === 'stellar') {
    return `${config.STELLAR_SCAN_URL}/accounts/${address}`;
  } else if (chain_name === 'ripple') {
    return `${config.RIPPLE_SCAN_URL}/accounts/${address}`;
  } else if (chain_name === 'thorchain') {
    return `${config.THORCHAIN_SCAN_URL}/address/${address}`;
  } else if (chain_name === 'tezos') {
    return `${config.TEZOS_SCAN_URL}/${address}/operations/`;
  } else if (chain_name === 'cosmos') {
    return `${config.COSMOS_SCAN_URL}/cosmos/address/${address}`;
  } else if (chain_name === 'polkadot') {
    return `${config.POLKADOT_SCAN_URL}/account/${address}?tab=transfer`;
  } else if (chain_name === 'ton') {
    return `${config.TON_SCAN_URL}/address/${address}${
      type === 'token' ? '#tokentxns' : ''
    }`;
  } else if (chain_name === 'dogecoin') {
    return `${config.DOGECOIN_SCAN_URL}/address/${address}`;
  } else if (chain_name === 'bitcoin_cash') {
    return `${config.BITCOIN_CASH_SCAN_URL}/address/${address}`;
  } else if (chain_name === 'aptos') {
    return `${config.APTOS_SCAN_URL}/account/${address}?network=${
      IS_SANDBOX ? 'testnet' : 'mainnet'
    }`;
  } else if (chain_name === 'hedera') {
    return `${config.HEDERA_SCAN_URL}/account/${address}`;
  } else if (chain_name === 'cardano') {
    return `${config.CARDANO_SCAN_URL}/address/${address}`;
  } else if (chain_name === 'filecoin') {
    return `${config.FILECOIN_SCAN_URL}/address/${address}/#message_list`;
  }
  return null;
};

export function isContainsURL(inputString, messageAllowUrls) {
  const urlPattern =
    /[-a-zA-Z0-9@:%_+.~#?&//=]{2,256}\.[a-z]{2,4}\b(\/[-a-zA-Z0-9@:%_+.~#?&/=]*)?/gi;
  const array = inputString.match(urlPattern);
  if (!array) {
    return false;
  }
  return !array?.every(item =>
    messageAllowUrls.some(subItem => item?.toLowerCase()?.startsWith(subItem)),
  );
}

export const isValidDerivePath = path => {
  const maxDepth = 255; // TODO verify this!!
  const maxIndexValue = Math.pow(2, 31); // TODO verify this!!
  if (path[0] !== 'm') {
    return false;
  }
  if (path.length > 1) {
    if (path[1] !== '/') {
      return false;
    }
    const indexes = path.split('/');
    if (indexes.length > maxDepth) {
      return false;
    }
    for (let depth = 1; depth < indexes.length; depth++) {
      const index = indexes[depth];
      const invalidChars = index.replace(/^[0-9]+'?$/g, '');
      if (invalidChars.length > 0) {
        return false;
      }
      const indexValue = parseInt(index.replace("'", ''), 10);
      if (isNaN(depth)) {
        return false;
      }
      if (indexValue > maxIndexValue) {
        return false;
      }
    }
  }
  return true;
};

function binarySearch(arr, x) {
  let start = 0,
    end = arr.length - 1;

  // Iterate while start not meets end
  while (start <= end) {
    // Find the mid index
    let mid = Math.floor((start + end) / 2);

    // If element is present at mid, see if it's the start of the words with search character
    if (arr[mid].startsWith(x) && (mid === 0 || !arr[mid - 1].startsWith(x))) {
      return mid;
    }
    // Else look in left or right half accordingly
    else if (arr[mid].localeCompare(x) < 0) {
      start = mid + 1;
    } else {
      end = mid - 1;
    }
  }

  return -1;
}

export function fetchWordsStartingWith(arr, char) {
  const startIndex = binarySearch(arr, char);
  const results = [];
  if (startIndex !== -1) {
    for (let i = startIndex; i < arr.length && arr[i].startsWith(char); i++) {
      results.push(arr[i]);
    }
  }
  return results;
}

export const customObj = {
  label: 'Custom',
  value: 'custom',
};

export const calculateSliderValue = (balance, value) => {
  if (!balance || !value) {
    return 0;
  }
  const balanceBN = new BigNumber(balance);
  const valueBN = new BigNumber(value);
  const result = valueBN
    .dividedBy(balanceBN)
    .multipliedBy(new BigNumber(100))
    .toFixed(0);
  const finalNumber = validateNumber(result) || 0;
  return Math.min(finalNumber, 100);
};

export function moveItem(arr, from, to) {
  const fromNumber = validateNumber(from);
  const toNumber = validateNumber(to);

  if (!Array.isArray(arr)) {
    console.warn('in moveItem first argument must be array');
    return null;
  }
  if (fromNumber === null || fromNumber < 0 || fromNumber > arr.length - 1) {
    console.warn('from must be number and valid index in the arr');
    return null;
  }
  if (toNumber === null || toNumber < 0 || toNumber > arr.length - 1) {
    console.warn('to must be number and valid index in the arr');
    return null;
  }
  const tempArray = [...arr];
  const f = tempArray.splice(fromNumber, 1)[0];
  // insert stored item into position `to`
  tempArray.splice(toNumber, 0, f);
  return tempArray;
}

export const TABS_INFO = {
  REQUESTS: {
    title: 'What are ‘Requests’?',
    message:
      'When a new conversation is initiated by a peer Ethereum address, it appears in the ‘Requests’ tab. It stays there until you respond to the Ethereum address. Once you’ve replied, the conversation moves to the ‘Messages’ tab.\n' +
      'From the Chat screen, you also have the option to block unknown addresses.\nPlease stay alert for potential fraudsters and scam messages.',
  },
  MESSAGES: {
    title: 'What are ‘Messages’?',
    message:
      'When you initiate a new conversation or reply to an Ethereum address, these conversations are displayed in the ‘Messages’ tab. From the Chat screen, you also have the option to block unknown addresses.\n' +
      'From the Chat screen, you also have the option to block unknown addresses.\nPlease stay alert for potential fraudsters and scam messages.',
  },
};

export function formatExchangeArray(arr) {
  if (!Array.isArray(arr) || arr.length === 0) {
    return '';
  }
  if (arr.length === 1) {
    return arr[0];
  }
  return `${arr.slice(0, -1).join(', ')} and ${arr.slice(-1)}`;
}

export const createPendingTransactionKey = ({chain_name, symbol, address}) => {
  return `${chain_name}_${symbol}_${address}`;
};

export function deleteItemAtIndex(array, index) {
  // Check if the index is within the bounds of the array
  if (index >= 0 && index < array.length) {
    // Use splice to remove the item at the specified index and return it
    const deletedObject = array.splice(index, 1)[0];
    return {
      deletedObject, // The deleted item
      updatedArray: array, // The updated array
    };
  }
  // If the index is out of bounds, return null for deletedObject and the original array
  return {
    deletedObject: null,
    updatedArray: array,
  };
}

export const commonRetryFunc = async (
  providers,
  cb,
  defaultResponse,
  providersName,
  skipArrays,
) => {
  for (let i = 0; i < providers.length; i++) {
    if (Array.isArray(skipArrays) && skipArrays.includes(i)) {
      continue;
    }
    const providerName = providersName?.[i];

    try {
      const provider = providers[i];
      return await cb(provider);
    } catch (e) {
      console.log(`Error in provider:  ${providerName || ''} `, 'Errors:', e);
      if (i === providers.length - 1) {
        if (defaultResponse !== undefined) {
          return defaultResponse;
        } else {
          throw e;
        }
      }
    }
  }
};

export const getIndexFromDerivePath = (derivePath, chainname) => {
  const dIndex = DERIVE_INDEX[chainname] || 4;
  const parts1 = derivePath?.split('/'); // Split the string by '/'
  const number1 = parseInt(parts1?.[dIndex], 10); // Get the 4th part (index 3) and convert to integer
  if (Number.isNaN(number1)) {
    return 0;
  }
  return number1;
};

export function getLargestNumber(arr) {
  if (arr.length === 0) {
    return 0;
  }
  return Math.max(...arr);
}

const fingerPrintName = {
  'Touch ID': 'Touch ID',
  'Face ID': 'Face ID',
  Biometrics: 'Fingerprint',
};

export const getFingerprintName = name => {
  return fingerPrintName[name] || 'Fingerprint';
};

export function insertSorted(arr, newElement, key) {
  if (!arr || arr.length === 0) {
    return [newElement];
  }

  let left = 0,
    right = arr.length - 1;

  while (left <= right) {
    let mid = Math.floor((left + right) / 2);
    if (arr[mid][key].localeCompare(newElement[key]) < 0) {
      left = mid + 1;
    } else {
      right = mid - 1;
    }
  }
  arr.splice(left, 0, newElement);
  return arr;
}

export function isEqualArray(arr1, arr2) {
  if (arr1.length !== arr2.length) {
    return false;
  }
  const frequencyMap = {};
  for (const item of arr1) {
    frequencyMap[item] = (frequencyMap[item] || 0) + 1;
  }
  for (const item of arr2) {
    if (!frequencyMap[item]) {
      return false;
    }
    frequencyMap[item]--;
  }
  return Object.values(frequencyMap).every(count => count === 0);
}

export function decodeSolMessage(msg) {
  try {
    const buffer = bs58.decode(msg);
    // eslint-disable-next-line no-undef
    return Buffer.from(buffer).toString();
  } catch (e) {
    return msg;
  }
}

export function safelyJsonParse(data) {
  try {
    return JSON.parse(data);
  } catch (e) {
    return data;
  }
}
export function safelyJsonStringify(data) {
  try {
    return JSON.stringify(safelyJsonParse(data), null, 2);
  } catch (e) {
    return data;
  }
}

export function customFetchWithTimeout(url, options = {}) {
  const controller = new AbortController();
  const timeoutMs = 20000; // Timeout duration in milliseconds (5 seconds)
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  const updatedOptions = {...options, signal: controller.signal};

  return fetch(url, updatedOptions)
    .then(response => {
      clearTimeout(timeoutId);
      return response;
    })
    .catch(error => {
      clearTimeout(timeoutId);
      throw error;
    });
}

export async function fetchRequest(url, options) {
  try {
    const response = await axios.request({
      url,
      timeout: 20000, // Timeout duration in milliseconds (5 seconds)
      ...options,
    });
    return response.data;
  } catch (e) {
    // Surface the provider's own error message instead of a bare status code
    const body = e?.response?.data;
    const errorMessage =
      body?.error?.message ||
      body?.message ||
      body?.detail ||
      body?.title ||
      body?.error ||
      (typeof body === 'string' && body.trim().slice(0, 200));
    const detail = typeof candidate === 'string' ? errorMessage : null;
    if (detail) {
      e.message = `${detail} (status ${e.response.status})`;
    }
    throw e;
  }
}

export async function fetchRPCRequest(url, method, params) {
  const data = await fetchRequest(url, {
    method: 'post',
    data: {jsonrpc: '2.0', id: 1, method, params},
    adapter: rpcSessionAdapter,
  });
  if (data?.error) {
    throw new Error(data.error?.message || 'RPC error');
  }
  return data?.result;
}

export const isNewerVersion = (v1, v2) => {
  if (!v1 || !v2) {
    return false;
  }
  const a = v1.split('.').map(Number);
  const b = v2.split('.').map(Number);
  return a.some((part, i) => part !== (b[i] || 0))
    ? a.find((part, i) => part !== (b[i] || 0)) >
        (b[a.findIndex((part, i) => part !== (b[i] || 0))] || 0)
    : false;
};

export const createBalanceKey = coinInfo => {
  return `${coinInfo?.chain_name?.toLowerCase()}_${coinInfo?.symbol?.toLowerCase()}_${coinInfo?.address?.toLowerCase()}`;
};

export const isValidEVMTransactionHash = hash => {
  if (!hash) {
    return false;
  }
  return /^0x([A-Fa-f0-9]{64})$/.test(hash);
};

export async function sleep(timeMs) {
  return new Promise(resolve => {
    setTimeout(resolve, timeMs);
  });
}

// Chain-agnostic sanity check for a tx hash about to be reported to the
// backend exchange history. Non-EVM chains report base58/base64/plain-hex
// hashes of varying lengths, so only 0x-prefixed values get the strict EVM
// shape check; everything else just has to be a single clean token.
export const isPlausibleTxHash = hash => {
  if (typeof hash !== 'string') {
    return false;
  }
  if (/[\s,]/.test(hash) || hash.length < 10 || hash.length > 120) {
    return false;
  }
  if (hash.startsWith('0x')) {
    return isValidEVMTransactionHash(hash);
  }
  return true;
};

/**
 * Merges newAccounts into oldAccounts, deduplicating by address OR derivePath.
 * Old accounts (including custom ones) are always preserved.
 */
export const mergeUniqueAccounts = (oldAccounts, newAccounts) => {
  if (!Array.isArray(oldAccounts) || !oldAccounts.length) {
    return Array.isArray(newAccounts) ? newAccounts : [];
  }
  if (!Array.isArray(newAccounts) || !newAccounts.length) {
    return oldAccounts;
  }

  const newByAddress = new Map(newAccounts.map(n => [n.address, n]));
  const newByDerivePath = new Map(newAccounts.map(n => [n.derivePath, n]));

  const oldAddresses = new Set();
  const oldDerivePaths = new Set();

  const merged = oldAccounts.map(o => {
    oldAddresses.add(o.address);
    oldDerivePaths.add(o.derivePath);
    const match =
      newByAddress.get(o.address) ?? newByDerivePath.get(o.derivePath);
    return match ? {...o, ...match} : o;
  });

  const toAdd = newAccounts.filter(
    n => !oldAddresses.has(n.address) && !oldDerivePaths.has(n.derivePath),
  );

  return [...merged, ...toAdd];
};

export const getWalletTotalBalance = coins => {
  let total = 0;
  coins?.forEach(coin => {
    if (coin?.isInWallet) {
      const value = isNaN(Number(coin.totalBalanceCourse))
        ? 0
        : Number(coin.totalBalanceCourse);
      total += value;
    }
  });
  return total;
};

export const getTopTwoCoins = coins => {
  if (!coins || !Array.isArray(coins)) {
    return [];
  }
  const walletCoins = coins.filter(coin => coin?.isInWallet);
  const sorted = [...walletCoins].sort((a, b) => {
    const aValue = isNaN(Number(a.totalCourse)) ? 0 : Number(a.totalCourse);
    const bValue = isNaN(Number(b.totalCourse)) ? 0 : Number(b.totalCourse);
    return bValue - aValue;
  });
  return sorted.slice(0, 2);
};

export const getCoinsCount = coins => {
  if (!coins || !Array.isArray(coins)) {
    return 0;
  }
  return coins.filter(coin => coin?.isInWallet).length;
};

const BALANCE_UNITS = [
  {threshold: 1e12, suffix: 'T'},
  {threshold: 1e9, suffix: 'B'},
  {threshold: 1e6, suffix: 'M'},
  {threshold: 1e3, suffix: 'K'},
];

const balanceFormatter = new Intl.NumberFormat('en-US', {
  maximumFractionDigits: 2,
});

export const formatBalance = value => {
  const n = Number(value);
  if (!Number.isFinite(n)) {
    return '0.00';
  }
  for (let i = 0; i < BALANCE_UNITS.length; i++) {
    const {threshold, suffix} = BALANCE_UNITS[i];
    if (n >= threshold) {
      return `${Math.floor((n / threshold) * 100) / 100}${suffix}`;
    }
  }
  return balanceFormatter.format(n);
};

const getScanUrlName = chain_name => {
  if (chain_name === 'polygon') {
    return getRPCUrl('polygon_blockscout')
      ? 'polygon_blockscout'
      : 'polygon_scan';
  }
  return chain_name;
};

export const getExplorerTxUrl = (chain_name, txHash) => {
  const scanConfig = SCAN_URL[getScanUrlName(chain_name)];
  if (!scanConfig) {
    return '';
  }
  const {baseUrl, txPath, sandboxQueryParam} = scanConfig;
  const url = txPath
    ? `${baseUrl}/${txPath}/${txHash}`
    : `${baseUrl}/${txHash}`;
  return sandboxQueryParam && IS_SANDBOX ? `${url}?${sandboxQueryParam}` : url;
};

export const toDirection = (notifyOnReceive, notifyOnSend) => {
  if (notifyOnReceive && notifyOnSend) {
    return 'both';
  }
  if (notifyOnReceive) {
    return 'in';
  }
  return 'out';
};
