import BigNumber from 'bignumber.js';
import {formatUnits, isHexString, parseUnits, toUtf8String} from 'ethers';
import dayjs from 'dayjs';
import duration from 'dayjs/plugin/duration';
import {APP_VERSION} from 'utils/common';
import {
  config,
  SCAN_URL,
  IS_SANDBOX,
} from 'dok-wallet-blockchain-networks/config/config';
import bs58 from 'bs58';
dayjs.extend(duration);

export function getCustomizePublicAddress(str) {
  return `${str?.substring(0, 8) || ''}...${
    str?.substring(str.length - 7, str.length) || ''
  }`;
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

const ethereumChains = {
  ethereum: 'ethereum',
  binance_smart_chain: 'ethereum',
  polygon: 'ethereum',
  base: 'ethereum',
  arbitrum: 'ethereum',
  optimism: 'ethereum',
  optimism_binance_smart_chain: 'ethereum',
  avalanche: 'ethereum',
  fantom: 'ethereum',
  gnosis: 'ethereum',
  viction: 'ethereum',
  linea: 'ethereum',
  zksync: 'ethereum',
  ethereum_classic: 'ethereum',
  ethereum_pow: 'ethereum',
  kava: 'ethereum',
  ink: 'ethereum',
};

const supportedChain = [
  'bitcoin',
  'ethereum',
  'tron',
  'solana',
  'litecoin',
  'bitcoin_legacy',
  'bitcoin_segwit',
  'stellar',
  'ripple',
  'thorchain',
  'tezos',
  'cosmos',
  'polkadot',
  'ton',
  'dogecoin',
  'aptos',
  'hedera',
  'bitcoin_cash',
  'cardano',
  'filecoin',
  // 'bitcoin_taproot'
];

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

export function parseBalance(tokenPrice, tokenDecimals) {
  try {
    if (!tokenPrice || !tokenDecimals) {
      return '0';
    }
    const price = BigInt(tokenPrice?.toString());
    return formatUnits(price, Number(tokenDecimals));
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
    const price = BigInt(tokenPrice);
    const parseBalString = formatUnits(price, Number(tokenDecimals));
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
    return parseUnits(tokenPrice, Number(tokenDecimals)).toString();
  } catch (e) {
    console.error('Error in calculatePrice', e);
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
  return isNaN(validNumber) ? null : validNumber;
}

export function validateBigNumberStr(number) {
  try {
    const validNumber = new BigNumber(number);
    if (!validNumber.isFinite() || validNumber.isNaN()) {
      return '0';
    }
    return validNumber.toString();
  } catch (error) {
    return '0';
  }
}
export function validateNumberInInput(text) {
  while (text.charAt(0) === '0' && text.charAt(1) !== '.' && text.length > 1) {
    text = text.substring(1);
  }

  // Check if the text is a valid floating point number or empty string
  if (!isNaN(text) || text === '') {
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

const BITCOIN_CHAINS = [
  'bitcoin',
  'bitcoin_segwit',
  'bitcoin_legacy',
  // 'bitcoin_taproot',
];

export const isBitcoinChain = chain_name => BITCOIN_CHAINS.includes(chain_name);

const LITECOIN_CHAINS = ['litecoin'];

export const isLitecoinChain = chain_name =>
  LITECOIN_CHAINS.includes(chain_name);

const EVM_CHAINS = [
  'ethereum',
  'binance_smart_chain',
  'polygon',
  'base',
  'arbitrum',
  'optimism',
  'optimism_binance_smart_chain',
  'avalanche',
  'fantom',
  'gnosis',
  'viction',
  'linea',
  'zksync',
  'ethereum_classic',
  'ethereum_pow',
  'kava',
  'ink',
];

export const isEVMChain = chain_name => EVM_CHAINS.includes(chain_name);

const OPTIONS_GAS_FEES_CHAIN = [
  'ethereum',
  'binance_smart_chain',
  'fantom',
  'avalanche',
  'gnosis',
  'linea',
];

const EIP_1559_NOT_SUPPORTED = ['binance_smart_chain', 'kava'];

export const isEip1559NotSupported = chain_name =>
  EIP_1559_NOT_SUPPORTED.includes(chain_name);

export const isOptionGasFeesChain = chain_name =>
  OPTIONS_GAS_FEES_CHAIN.includes(chain_name);

const DERIVE_ADDRESS_SUPPORT_CHAIN = [...EVM_CHAINS, 'tron', 'solana'];
export const isDeriveAddressSupportChain = chain_name =>
  DERIVE_ADDRESS_SUPPORT_CHAIN.includes(chain_name);

const STAKING_CHAINS = ['solana', 'tron'];

export const isStakingChain = chain_name => STAKING_CHAINS.includes(chain_name);

const VALIDATORS_SUPPORT_IN_CREATE_STAKING_SCREEN = ['solana'];

export const isValidatorSupportCreateStakingScreen = chain_name =>
  VALIDATORS_SUPPORT_IN_CREATE_STAKING_SCREEN.includes(chain_name);

const SUPPORT_RESOURCE_TYPE_CREATE_STAKING_SCREEN = ['tron'];

export const isHaveResourceTypeInCreateStakingScreen = chain_name =>
  SUPPORT_RESOURCE_TYPE_CREATE_STAKING_SCREEN.includes(chain_name);

const tronResourcesData = [
  {
    label: 'BANDWIDTH',
    value: 'BANDWIDTH',
  },
  {
    label: 'ENERGY',
    value: 'ENERGY',
  },
];

export const resourcesData = {
  tron: tronResourcesData,
};

const layer2Chains = [
  // 'arbitrum',
  'base',
  'optimism',
  'optimism_binance_smart_chain',
  'ink',
];

export const isLayer2Chain = chain_name => layer2Chains.includes(chain_name);

const feesOptionsChains = [
  'ethereum',
  'bitcoin',
  'bitcoin_segwit',
  'bitcoin_legacy',
  'litecoin',
  'dogecoin',
  'bitcoin_cash',
];

export const isFeesOptionChain = chain_name =>
  feesOptionsChains.includes(chain_name);

const EPOCH_TIME_SUPPORT_CHAIN = ['solana'];

export const isSupportEpochTime = chain_name =>
  EPOCH_TIME_SUPPORT_CHAIN.includes(chain_name);

const UNSTAKING_BUTTON_CHAIN = ['tron'];

export const isShowUnstakingButton = chain_name =>
  UNSTAKING_BUTTON_CHAIN.includes(chain_name);

const VOTE_BUTTON_CHAIN = ['tron'];

export const isShowVoteButton = chain_name =>
  VOTE_BUTTON_CHAIN.includes(chain_name);

const MEMO_SUPPORT_CHAIN = [
  'cosmos',
  'ton',
  'ripple',
  'solana',
  'stellar',
  'hedera',
  'thorchain',
];

export const isMemoSupportChain = chain_name =>
  MEMO_SUPPORT_CHAIN.includes(chain_name);

const NAME_SUPPORT_IN_ADDRESS = ['ethereum', 'binance_smart_chain'];

export const isNameSupportChain = chain_name =>
  NAME_SUPPORT_IN_ADDRESS.includes(chain_name);

const TRANSACTION_LIST_NOT_SUPPORTED_CHAINS = ['aptos', 'kava'];

export const isTransactionListNotSupported = (chain_name, type) =>
  TRANSACTION_LIST_NOT_SUPPORTED_CHAINS.includes(chain_name) ||
  (chain_name === 'solana' && type !== 'coin');

const CUSTOM_ADDRESS_NOT_SUPPORTED_CHAINS = ['hedera'];

export const isCustomAddressNotSupportedChain = chain_name =>
  CUSTOM_ADDRESS_NOT_SUPPORTED_CHAINS.includes(chain_name);

export const isPendingTransactionSupportedChain = chain_name =>
  EVM_CHAINS.includes(chain_name);

const PRIVATE_KEY_NOT_SUPPORTED_CHAINS = ['ripple', 'cardano'];

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
export const ModalAddTokenList = [
  {
    label: 'Ethereum',
    value: 'ethereum',
    chain_symbol: 'ETH',
    type: 'token',
    token_type: 'ERC20',
    isEVM: true,
  },
  {
    label: 'Polygon',
    value: 'polygon',
    chain_symbol: 'POL',
    type: 'token',
    token_type: 'ERC20',
    isEVM: true,
  },
  {
    label: 'Base',
    value: 'base',
    chain_symbol: 'ETH',
    type: 'token',
    token_type: 'ERC20',
    isEVM: true,
  },
  {
    label: 'Binance Smart Chain',
    value: 'binance_smart_chain',
    chain_symbol: 'BNB',
    type: 'token',
    token_type: 'BEP20',
    isEVM: true,
  },
  {
    label: 'Tron',
    value: 'tron',
    chain_symbol: 'TRX',
    type: 'token',
    token_type: 'TRC20',
  },
  {
    label: 'Solana',
    value: 'solana',
    chain_symbol: 'SOL',
    type: 'token',
    token_type: 'SPL20',
  },
  {
    label: 'Arbitrum',
    value: 'arbitrum',
    chain_symbol: 'ETH',
    type: 'token',
    token_type: 'ERC20',
    isEVM: true,
  },
  {
    label: 'Optimism',
    value: 'optimism',
    chain_symbol: 'ETH',
    type: 'token',
    token_type: 'ERC20',
    isEVM: true,
  },
  {
    label: 'Optimism Binance Smart Chain',
    value: 'optimism_binance_smart_chain',
    chain_symbol: 'BNB',
    type: 'token',
    token_type: 'BEP20',
    isEVM: true,
  },
  {
    label: 'Avalanche',
    value: 'avalanche',
    chain_symbol: 'AVAX',
    type: 'token',
    token_type: 'ERC20',
    isEVM: true,
  },
  {
    label: 'Fantom',
    value: 'fantom',
    chain_symbol: 'FTM',
    type: 'token',
    token_type: 'ERC20',
    isEVM: true,
  },
  {
    label: 'Gnosis',
    value: 'gnosis',
    chain_symbol: 'XDAI',
    type: 'token',
    token_type: 'ERC20',
    isEVM: true,
  },
  {
    label: 'Kava',
    value: 'kava',
    chain_symbol: 'KAVA',
    type: 'token',
    token_type: 'ERC20',
    isEVM: true,
  },
  {
    label: 'Linea',
    value: 'linea',
    chain_symbol: 'ETH',
    type: 'token',
    token_type: 'ERC20',
    isEVM: true,
  },
  {
    label: 'zkSync Era',
    value: 'zksync',
    chain_symbol: 'ETH',
    type: 'token',
    token_type: 'ERC20',
    isEVM: true,
  },
  {
    label: 'Viction',
    value: 'viction',
    chain_symbol: 'VIC',
    type: 'token',
    token_type: 'ERC20',
    isEVM: true,
  },
  {
    label: 'Ethereum Classic',
    value: 'ethereum_classic',
    chain_symbol: 'ETC',
    type: 'token',
    token_type: 'ERC20',
    isEVM: true,
  },
  {
    label: 'EthereumPoW',
    value: 'ethereum_pow',
    chain_symbol: 'ETHW',
    type: 'token',
    token_type: 'ERC20',
    isEVM: true,
  },
  {
    label: 'Ink',
    value: 'ink',
    chain_symbol: 'ETH',
    type: 'token',
    token_type: 'ERC20',
    isEVM: true,
  },
];

export const PrivateKeyList = [
  {
    label: 'Aptos',
    value: 'aptos',
  },
  {
    label: 'Arbitrum',
    value: 'arbitrum',
  },
  {
    label: 'Avalanche',
    value: 'avalanche',
  },
  {
    label: 'Base',
    value: 'base',
  },
  {
    label: 'Binance Smart Chain',
    value: 'binance_smart_chain',
  },
  {
    label: 'Bitcoin Cash',
    value: 'bitcoin_cash',
  },
  {
    label: 'Bitcoin Legacy',
    value: 'bitcoin_legacy',
  },
  {
    label: 'Bitcoin Segwit',
    value: 'bitcoin_segwit',
  },
  {
    label: 'Bitcoin Native Segwit',
    value: 'bitcoin',
  },
  {
    label: 'Cosmos',
    value: 'cosmos',
  },
  {
    label: 'Dogecoin',
    value: 'dogecoin',
  },
  {
    label: 'Ethereum',
    value: 'ethereum',
  },
  {
    label: 'Ethereum Classic',
    value: 'ethereum_classic',
  },
  {
    label: 'EthereumPoW',
    value: 'ethereum_pow',
  },
  {
    label: 'Fantom',
    value: 'fantom',
  },
  {
    label: 'Gnosis',
    value: 'gnosis',
  },
  {
    label: 'Hedera',
    value: 'hedera',
  },
  {
    label: 'Ink',
    value: 'ink',
  },
  {
    label: 'Kava',
    value: 'kava',
  },
  {
    label: 'Linea',
    value: 'linea',
  },
  {
    label: 'Litecoin',
    value: 'litecoin',
  },
  {
    label: 'Optimism',
    value: 'optimism',
  },
  {
    label: 'Optimism Binance Smart Chain',
    value: 'optimism_binance_smart_chain',
  },
  {
    label: 'Polkadot',
    value: 'polkadot',
  },
  {
    label: 'Polygon',
    value: 'polygon',
  },
  {
    label: 'Solana',
    value: 'solana',
  },
  {
    label: 'Stellar',
    value: 'stellar',
  },
  {
    label: 'Tezos',
    value: 'tezos',
  },
  {
    label: 'Ton',
    value: 'ton',
  },
  {
    label: 'Tron',
    value: 'tron',
  },
  {
    label: 'Viction',
    value: 'viction',
  },
  {
    label: 'zkSync Era',
    value: 'zksync',
  },
  {
    label: 'Filecoin',
    value: 'filecoin',
  },
];

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

export const NFT_SUPPORTED_CHAIN = [
  'Ethereum',
  'BSC',
  'Polygon',
  'Solana',
  'Arbitrum',
  'Base',
  'Optimism',
];

export const MORALIS_CHAIN_TO_CHAIN = {
  Ethereum: 'ethereum',
  Polygon: 'polygon',
  BSC: 'binance_smart_chain',
  Solana: 'solana',
  Arbitrum: 'arbitrum',
  Base: 'base',
  Optimism: 'optimism',
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
    return `${SCAN_URL[chain_name]}/address/${address}${
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
    return `${config.FILECOIN_SCAN_URL}/address/${address}`;
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

const EVMDerivationPath = [
  {
    label: "Ledger (m/44'/60'/1'/0/0)",
    value: "m/44'/60'/1'/0/0",
  },
  {
    label: "Metamask (m/44'/60'/0'/0/1)",
    value: "m/44'/60'/0'/0/1",
  },
];

const tronDerivationPath = [
  {
    label: "Ledger (m/44'/195'/1'/0/0)",
    value: "m/44'/195'/1'/0/0",
  },
];

const solanaMDerivationPath = [
  {
    label: "Ledger (m/44'/501'/1')",
    value: "m/44'/501'/1'",
  },
];

export const allDerivePath = {
  ethereum: EVMDerivationPath,
  solana: solanaMDerivationPath,
  tron: tronDerivationPath,
};

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
      if (i === providers - 1) {
        if (defaultResponse) {
          return defaultResponse;
        } else {
          throw e;
        }
      }
    }
  }
};

const DERIVE_INDEX = {
  ethereum: 4,
  tron: 4,
  solana: 3,
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

export function shuffleArray(array) {
  // Create a copy of the array to avoid mutating the original array
  const newArray = array.slice();

  for (let i = newArray.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [newArray[i], newArray[j]] = [newArray[j], newArray[i]];
  }

  return newArray;
}
const fingerPrintName = {
  'Touch ID': 'Touch ID',
  'Face ID': 'Face ID',
  Biometrics: 'Fingerprint',
};

export const getFingerprintName = name => {
  return fingerPrintName[name] || 'Fingerprint';
};

export const GAS_CURRENCY = {
  ethereum: 'Gwei',
  bitcoin: 'sat/B',
  bitcoin_legacy: 'sat/B',
  bitcoin_segwit: 'sat/B',
  litecoin: 'lit/B',
  dogecoin: 'sat/B',
  bitcoin_cash: 'sat/B',
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
