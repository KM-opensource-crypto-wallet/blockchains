// CHANE BELOW FLAG TO false
import * as bitcoin from 'bitcoinjs-lib';
import {EvmChain} from '@moralisweb3/common-evm-utils';
import {SolNetwork} from '@moralisweb3/common-sol-utils';
import * as StellarSdk from '@stellar/stellar-sdk';

export const IS_SANDBOX = false;

export function getSecureRandomValues(length = 16) {
  const result = new Uint8Array(length);

  // Browser or React Native with polyfill
  // eslint-disable-next-line no-undef
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    // eslint-disable-next-line no-undef
    return crypto.getRandomValues(result);
  }

  // React Native fallback
  if (
    typeof global !== 'undefined' &&
    global.crypto &&
    global.crypto.getRandomValues
  ) {
    return global.crypto.getRandomValues(result);
  }

  // Node.js environment (Next.js SSR)
  if (
    typeof process !== 'undefined' &&
    process.versions &&
    process.versions.node
  ) {
    // Dynamic import to avoid issues with Next.js
    const nodeCrypto = require('crypto');
    const randomBytes = nodeCrypto.randomBytes(length);
    for (let i = 0; i < length; i++) {
      result[i] = randomBytes[i];
    }
    return result;
  }
  return result;
}

export function shuffleArray(array) {
  // Create a copy of the array to avoid mutating the original array
  const newArray = array.slice();

  // Use secure random values for the shuffle
  for (let i = newArray.length - 1; i > 0; i--) {
    // Get a single random value for each swap
    const randomBytes = getSecureRandomValues(1);
    // Convert to a number and get modulo to stay in range
    const j = randomBytes[0] % (i + 1);
    // Swap elements
    [newArray[i], newArray[j]] = [newArray[j], newArray[i]];
  }

  return newArray;
}

const SANDBOX_CHAIN_ID = {
  ethereum: 11155111,
  binance_smart_chain: 97,
  optimism: 11155420,
  polygon: 80002,
  base: 84532,
  arbitrum: 421614,
  optimism_binance_smart_chain: 5611,
  avalanche: 43113,
  fantom: 4002,
  gnosis: 10200,
  viction: 89,
  zksync: 300,
  linea: 59141,
  ethereum_classic: 61,
  ethereum_pow: 10001,
  kava: 2221,
  ink: 763373,
};

const PRODUCTION_CHAIN_ID = {
  ethereum: 1,
  binance_smart_chain: 56,
  polygon: 137,
  base: 8453,
  optimism: 10,
  arbitrum: 42161,
  optimism_binance_smart_chain: 204,
  avalanche: 43114,
  fantom: 250,
  gnosis: 100,
  viction: 88,
  zksync: 324,
  linea: 59144,
  ethereum_classic: 61,
  ethereum_pow: 10001,
  kava: 2222,
  ink: 57073,
};

export const CHAIN_ID = IS_SANDBOX ? SANDBOX_CHAIN_ID : PRODUCTION_CHAIN_ID;

const MORALIS_CHAIN_SANDBOX = {
  Ethereum: EvmChain.SEPOLIA,
  Polygon: EvmChain.MUMBAI,
  BSC: EvmChain.BSC_TESTNET,
  Solana: SolNetwork.DEVNET,
  Arbitrum: EvmChain.ARBITRUM_TESTNET,
  Optimism: EvmChain.OPTIMISM,
  Base: EvmChain.BASE_SEPOLIA,
};

const MORALIS_CHAIN_PRODUCTION = {
  Ethereum: EvmChain.ETHEREUM,
  Polygon: EvmChain.POLYGON,
  BSC: EvmChain.BSC,
  Solana: SolNetwork.MAINNET,
  Arbitrum: EvmChain.ARBITRUM,
  Base: EvmChain.BASE,
  Optimism: EvmChain.OPTIMISM,
};

const WalletConnectSupportedChainSandbox = {
  'eip155:11155111': {
    chain_display_name: 'Ethereum',
    chain_name: 'ethereum',
    symbol: 'ETH',
  },
  'eip155:97': {
    chain_display_name: 'Binance Smart Chain',
    chain_name: 'binance_smart_chain',
    symbol: 'BNB',
  },
  'eip155:11155420': {
    chain_display_name: 'Optimism',
    chain_name: 'optimism',
    symbol: 'ETH',
  },
  'eip155:80002': {
    chain_display_name: 'Polygon',
    chain_name: 'polygon',
    symbol: 'POL',
  },
  'eip155:84532': {
    chain_display_name: 'Base',
    chain_name: 'base',
    symbol: 'ETH',
  },
  'eip155:421614': {
    chain_display_name: 'Arbitrum',
    chain_name: 'arbitrum',
    symbol: 'ETH',
  },
  'eip155:5611': {
    chain_display_name: 'Optimism Binance Smart Chain',
    chain_name: 'optimism_binance_smart_chain',
    symbol: 'BNB',
  },
  'eip155:43113': {
    chain_display_name: 'Avalanche',
    chain_name: 'avalanche',
    symbol: 'AVAX',
  },
  'eip155:4002': {
    chain_display_name: 'Fantom',
    chain_name: 'fantom',
    symbol: 'FTM',
  },
  'eip155:10200': {
    chain_display_name: 'Gnosis',
    chain_name: 'gnosis',
    symbol: 'XDAI',
  },
  'eip155:89': {
    chain_display_name: 'Viction',
    chain_name: 'viction',
    symbol: 'VIC',
  },
  'eip155:300': {
    chain_display_name: 'zkSync Era',
    chain_name: 'zksync',
    symbol: 'ETH',
  },
  'eip155:59141': {
    chain_display_name: 'Linea',
    chain_name: 'linea',
    symbol: 'ETH',
  },
  'eip155:61': {
    chain_display_name: 'Ethereum Classic',
    chain_name: 'ethereum_classic',
    symbol: 'ETC',
  },
  'eip155:10001': {
    chain_display_name: 'EthereumPoW',
    chain_name: 'ethereum_pow',
    symbol: 'ETC',
  },
  'eip155:2221': {
    chain_display_name: 'Kava',
    chain_name: 'kava',
    symbol: 'KAVA',
  },
  'eip155:763373': {
    chain_display_name: 'Ink',
    chain_name: 'ink',
    symbol: 'ETH',
  },
  'tron:0xcd8690dc': {
    chain_display_name: 'Tron',
    chain_name: 'tron',
    symbol: 'TRX',
  },
  'solana:8E9rvCKLFQia2Y35HXjjpWzj8weVo44K': {
    chain_display_name: 'Solana',
    chain_name: 'solana',
    symbol: 'SOL',
  },
};

const WalletConnectSupportedChainProduction = {
  'eip155:1': {
    chain_display_name: 'Ethereum',
    chain_name: 'ethereum',
    symbol: 'ETH',
  },
  'eip155:56': {
    chain_display_name: 'Binance Smart Chain',
    chain_name: 'binance_smart_chain',
    symbol: 'BNB',
  },
  'eip155:137': {
    chain_display_name: 'Polygon',
    chain_name: 'polygon',
    symbol: 'POL',
  },
  'eip155:8453': {
    chain_display_name: 'Base',
    chain_name: 'base',
    symbol: 'ETH',
  },
  'eip155:10': {
    chain_display_name: 'Optimism',
    chain_name: 'optimism',
    symbol: 'ETH',
  },
  'eip155:42161': {
    chain_display_name: 'Arbitrum',
    chain_name: 'arbitrum',
    symbol: 'ETH',
  },
  'eip155:204': {
    chain_display_name: 'Optimism Binance Smart Chain',
    chain_name: 'optimism_binance_smart_chain',
    symbol: 'BNB',
  },
  'eip155:43114': {
    chain_display_name: 'Avalanche',
    chain_name: 'avalanche',
    symbol: 'AVAX',
  },
  'eip155:250': {
    chain_display_name: 'Fantom',
    chain_name: 'fantom',
    symbol: 'FTM',
  },
  'eip155:100': {
    chain_display_name: 'Gnosis',
    chain_name: 'gnosis',
    symbol: 'XDAI',
  },
  'eip155:88': {
    chain_display_name: 'Viction',
    chain_name: 'viction',
    symbol: 'VIC',
  },
  'eip155:324': {
    chain_display_name: 'zkSync Era',
    chain_name: 'zksync',
    symbol: 'ETH',
  },
  'eip155:59144': {
    chain_display_name: 'Linea',
    chain_name: 'linea',
    symbol: 'ETH',
  },
  'eip155:61': {
    chain_display_name: 'Ethereum Classic',
    chain_name: 'ethereum_classic',
    symbol: 'ETC',
  },
  'eip155:10001': {
    chain_display_name: 'EthereumPoW',
    chain_name: 'ethereum_pow',
    symbol: 'ETC',
  },
  'eip155:2222': {
    chain_display_name: 'Kava',
    chain_name: 'kava',
    symbol: 'KAVA',
  },
  'eip155:57073': {
    chain_display_name: 'Ink',
    chain_name: 'ink',
    symbol: 'ETH',
  },
  'tron:0x2b6653dc': {
    chain_display_name: 'Tron',
    chain_name: 'tron',
    symbol: 'TRX',
  },
  'solana:4sGjMW1sUnHzSxGspuhpqLDx6wiyjNtZ': {
    chain_display_name: 'Solana',
    chain_name: 'solana',
    symbol: 'SOL',
  },
};

const ETHER_API_KEYS = shuffleArray([
  process.env.ETHERSCAN_API_KEY_1,
  process.env.ETHERSCAN_API_KEY_2,
]);

export const SCAN_URL = {
  ethereum: IS_SANDBOX
    ? 'https://sepolia.etherscan.io'
    : 'https://etherscan.io',
  binance_smart_chain: IS_SANDBOX
    ? 'https://testnet.bscscan.com'
    : 'https://bscscan.com',
  polygon_scan: IS_SANDBOX
    ? 'https://amoy.polygonscan.com'
    : 'https://polygonscan.com',
  polygon_blockscout: IS_SANDBOX
    ? 'https://amoy.polygonscan.com'
    : 'https://polygon.blockscout.com',
  base: IS_SANDBOX ? 'https://goerli.basescan.org' : 'https://basescan.org',
  arbitrum: IS_SANDBOX
    ? 'https://goerli-optimism.etherscan.io/'
    : 'https://arbiscan.io',
  optimism: IS_SANDBOX
    ? 'https://goerli-optimism.etherscan.io'
    : 'https://optimistic.etherscan.io/',
  optimism_binance_smart_chain: IS_SANDBOX
    ? 'https://opbnb-testnet.bscscan.com'
    : 'https://opbnb.bscscan.com',
  avalanche: IS_SANDBOX
    ? 'https://testnet.snowtrace.io'
    : 'https://snowtrace.io',
  fantom: IS_SANDBOX ? 'https://testnet.ftmscan.com' : 'https://ftmscan.com',
  gnosis: 'https://gnosisscan.io/',
  viction: IS_SANDBOX ? 'https://testnet.vicscan.xyz' : 'https://vicscan.xyz',
  linea: IS_SANDBOX
    ? 'https://sepolia.lineascan.build'
    : 'https://lineascan.build',
  zkSync: IS_SANDBOX
    ? 'https://sepolia.explorer.zksync.io'
    : 'https://explorer.zksync.io',
  kava: IS_SANDBOX ? 'https://testnet.kavascan.io/' : 'https://kavascan.com/',
  ethereum_classic: 'https://etc.blockscout.com',
  ethereum_pow: 'https://www.oklink.com/ethw',
  ink: IS_SANDBOX
    ? 'https://explorer-sepolia.inkonchain.com/'
    : 'https://explorer.inkonchain.com/',
};

export const config = {
  TRON_SOLIDITY_NODE: 'https://api.trongrid.io',
  TRON_EVENT_SERVER: 'https://api.trongrid.io',
  TRON_API_KEY: process.env.TRON_API_KEY_1,
  TRON_FULL_HOST: 'https://api.trongrid.io',
  BLOCK_CYPHER_BASE_URL: 'https://api.blockcypher.com',
  BLOCK_CYPHER_API_KEY: process.env.BLOCK_CYPHER_API_KEY,
  TRONWEB_BASE_URL: 'https://api.trongrid.io',

  ETHEREUM_SCAN_BASE_URL: 'https://api.etherscan.io/v2',
  ETHEREUM_SCAN_API_KEY_1: ETHER_API_KEYS[0],
  ETHEREUM_SCAN_API_KEY_2: ETHER_API_KEYS[1],
  POLYGON_BLOCKSCOUT_BASE_URL: IS_SANDBOX
    ? 'https://api-testnet.polygonscan.com'
    : 'https://polygon.blockscout.com',
  INK_BLOCK_EXPLORER_BASE_URL: IS_SANDBOX
    ? 'https://explorer-sepolia.inkonchain.com'
    : 'https://explorer.inkonchain.com',

  KAVA_SCAN_BASE_URL: IS_SANDBOX
    ? 'https://testnet.kavascan.io/'
    : 'https://kavascan.com/',
  DOK_WALLET_BASE_URL: process.env.DOK_WALLET_BASE_URL,
  // DOK_WALLET_BASE_URL: 'http://localhost:3001/dev',
  BITCOIN_SCAN_URL: IS_SANDBOX
    ? 'https://mempool.space/testnet'
    : 'https://mempool.space',
  BITCOIN_BASE_URL: IS_SANDBOX
    ? 'https://mempool.space/testnet/api'
    : 'https://mempool.space/api',
  BITCOIN_NETWORK_STRING: IS_SANDBOX
    ? bitcoin?.networks?.testnet
    : bitcoin?.networks?.mainnet,
  LITECOIN_NETWORK_STRING: {
    messagePrefix: '\x18Litecoin Signed Message:\n',
    bech32: 'ltc',
    bip32: {
      public: 0x019da462,
      private: 0x019d9cfe,
    },
    pubKeyHash: 0x30,
    scriptHash: 0x32,
    wif: 0xb0,
  },
  BITCOIN_CASH_NETWORK: {
    messagePrefix: '\x18BitcoinCash Signed Message:\n',
    bech32: 'bitcoincash',
    bip32: {
      private: 0x0488ade4,
      public: 0x0488b21e,
    },
    pubKeyHash: 0x00,
    scriptHash: 0x32,
    wif: 0x80,
  },
  LITECOIN_SCAN_URL: 'https://blockchair.com/litecoin',
  BITCOIN_CASH_SCAN_URL: 'https://blockchair.com/bitcoin-cash',
  SOLANA_RPC_CONTRACT_CHAIN_ID: IS_SANDBOX ? 103 : 101,
  COIN_MARKET_CAP_API_KEYS: [
    process.env.COIN_MARKET_CAP_API_KEY_1,
    process.env.COIN_MARKET_CAP_API_KEY_2,
    process.env.COIN_MARKET_CAP_API_KEY_3,
    process.env.COIN_MARKET_CAP_API_KEY_4,
  ],
  WALLET_CONNECT_SUPPORTED_CHAIN: IS_SANDBOX
    ? WalletConnectSupportedChainSandbox
    : WalletConnectSupportedChainProduction,
  SOLANA_SCAN_URL: 'https://solscan.io',

  MORALIS_CHAIN: IS_SANDBOX ? MORALIS_CHAIN_SANDBOX : MORALIS_CHAIN_PRODUCTION,
  MORALIS_API_KEY: process.env.MORALIS_API_KEY,
  BLOCKFROST_API_KEY: process.env.BLOCKFROST_API_KEY,
  STELLAR_NETWORK: IS_SANDBOX
    ? StellarSdk.Networks.TESTNET
    : StellarSdk.Networks.PUBLIC,
  STELLAR_URL: IS_SANDBOX
    ? 'https://horizon-testnet.stellar.org'
    : 'https://horizon.stellar.org',
  STELLAR_SCAN_URL: IS_SANDBOX
    ? 'https://testnet.stellarchain.io'
    : 'https://stellarchain.io',
  RIPPLE_SCAN_URL: IS_SANDBOX
    ? 'https://testnet.xrpl.org'
    : 'https://livenet.xrpl.org',
  THORCHAIN_API_URL: 'https://midgard.ninerealms.com',
  THORCHAIN_SCAN_URL: 'https://viewblock.io/thorchain',
  TZKT_API_BASE_URL: IS_SANDBOX
    ? 'https://api.ghostnet.tzkt.io'
    : 'https://api.tzkt.io',
  TEZOS_SCAN_URL: IS_SANDBOX ? 'https://ghostnet.tzkt.io' : 'https://tzkt.io',
  STAKE_WIZ_BASE_URL: 'https://api.stakewiz.com',

  COSMOS_SCAN_URL: 'https://www.mintscan.io',
  COSMOS_SCAN_BASE_URL: 'https://apis.mintscan.io',
  COSMOS_API_KEY: process.env.COSMOS_API_KEY,
  AVAX_SCAN_API_URL:
    'https://api-beta.avascan.info/v2/network/mainnet/evm/43114',
  VICTION_SCAN_API_URL: IS_SANDBOX
    ? 'https://scan-api-testnet.viction.xyz'
    : 'https://vicscan.xyz',
  POLKADOT_SCAN_BASE_URL: 'https://polkadot.api.subscan.io',
  POLKADOT_SCAN_URL: 'https://polkadot.subscan.io',
  POLKADOT_SCAN_API_KEY: process.env.POLKADOT_SCAN_API_KEY,
  TON_SCAN_URL: IS_SANDBOX
    ? 'https://testnet.tonscan.org'
    : 'https://tonscan.org',
  TON_SCAN_BASE_URL: IS_SANDBOX
    ? 'https://testnet.toncenter.com'
    : 'https://toncenter.com',
  TON_SCAN_API_KEY: process.env.TON_SCAN_API_KEY,
  TRON_SCAN_BASE_URL: IS_SANDBOX
    ? 'https://nileapi.tronscan.org'
    : 'https://apilist.tronscanapi.com',
  TRON_SCAN_API_KEY: process.env.TRON_SCAN_API_KEY,
  TRON_SCAN_URL: IS_SANDBOX
    ? 'https://nile.tronscan.org/#'
    : 'https://tronscan.org/#',
  ETHEREUM_CLASSIC_SCAN_API_URL: 'https://etc.blockscout.com',
  ETHEREUM_POW_SCAN_API_URL: 'https://www.oklink.com',
  ETHEREUM_POW_SCAN_API_KEY: process.env.ETHEREUM_POW_SCAN_API_KEY,
  DOGECOIN_NETWORK_STRING: {
    messagePrefix: '\x19Dogecoin Signed Message:\n',
    bech32: 'doge',
    bip32: {
      public: 0x02facafd,
      private: 0x02fac398,
    },
    pubKeyHash: 0x1e,
    scriptHash: 0x16,
    wif: 0x9e,
  },
  DOGECOIN_SCAN_URL: 'https://blockchair.com/dogecoin',
  APTOS_SCAN_URL: 'https://explorer.aptoslabs.com',
  HEDERA_BASE_URL: IS_SANDBOX
    ? 'https://testnet.mirrornode.hedera.com'
    : 'https://mainnet.mirrornode.hedera.com',
  HEDERA_SCAN_URL: IS_SANDBOX
    ? 'https://hashscan.io/testnet'
    : 'https://hashscan.io/mainnet',
  CARDANO_SCAN_URL: 'https://cardanoscan.io',
  FILECOIN_SCAN_URL: IS_SANDBOX
    ? 'https://calibration.filscan.io/en'
    : 'https://filscan.io/en',
};

export const APP_NAME = process?.env?.APP_NAME || '';
export const isWeb = APP_NAME === 'dokwallet-desktop';

export const GAS_ORACLE_CONTRACT_ADDRESS = {
  optimism_binance_smart_chain: '0x420000000000000000000000000000000000000F',
  optimism: '0x420000000000000000000000000000000000000F',
  base: '0x420000000000000000000000000000000000000F',
  ink: '0x420000000000000000000000000000000000000F',
};

const SANDBOX_BATCH_TRANSACTION_CONTRACT = {
  ethereum: '0x0E79A1C95Ac489634f9aCfc33C914663bBc9FC60',
  base: '0x1A26f0b16172784Db9C71a220893fB5EA859e3fb',
};

const PRODUCTION_BATCH_TRANSACTION_CONTRACT = {
  ethereum: '0xDA1333D76a1B9883022513c089a0ca84043cF079',
  optimism: '0xC6c4684b0e3D42D94c16cD5Cbeb6618d2202FB9D',
  arbitrum: '0xC6c4684b0e3D42D94c16cD5Cbeb6618d2202FB9D',
  gnosis: '0xC6c4684b0e3D42D94c16cD5Cbeb6618d2202FB9D',
  base: '0xC6c4684b0e3D42D94c16cD5Cbeb6618d2202FB9D',
};

export const BATCH_TRANSACTION_CONTRACT_ADDRESS = IS_SANDBOX
  ? SANDBOX_BATCH_TRANSACTION_CONTRACT
  : PRODUCTION_BATCH_TRANSACTION_CONTRACT;
