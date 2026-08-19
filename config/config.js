// CHANE BELOW FLAG TO false
export const IS_SANDBOX = false;

const CHAIN_CONFIG = {
  ethereum: {
    chain_id: {sandbox: 11155111, production: 1},
    moralis: {key: 'Ethereum', sandbox: 'SEPOLIA', production: 'ETHEREUM'},
    wallet_connect: {chain_display_name: 'Ethereum', symbol: 'ETH'},
    scan: {
      sandbox: 'https://sepolia.etherscan.io',
      production: 'https://etherscan.io',
      txPath: 'tx',
    },
    batch_contract: {
      sandbox: '0x0E79A1C95Ac489634f9aCfc33C914663bBc9FC60',
      production: '0xDA1333D76a1B9883022513c089a0ca84043cF079',
    },
  },
  binance_smart_chain: {
    chain_id: {sandbox: 97, production: 56},
    moralis: {key: 'BSC', sandbox: 'BSC_TESTNET', production: 'BSC'},
    wallet_connect: {chain_display_name: 'Binance Smart Chain', symbol: 'BNB'},
    scan: {
      sandbox: 'https://testnet.bscscan.com',
      production: 'https://bscscan.com',
      txPath: 'tx',
    },
  },
  polygon: {
    chain_id: {sandbox: 80002, production: 137},
    moralis: {key: 'Polygon', sandbox: 'POLYGON_AMOY', production: 'POLYGON'},
    wallet_connect: {chain_display_name: 'Polygon', symbol: 'POL'},
    scan: {
      sandbox: 'https://amoy.polygonscan.com',
      production: 'https://polygonscan.com',
      txPath: 'tx',
    },
    scan_blockscout: {
      sandbox: 'https://amoy.polygonscan.com',
      production: 'https://polygon.blockscout.com',
      txPath: 'tx',
    },
  },
  base: {
    chain_id: {sandbox: 84532, production: 8453},
    moralis: {key: 'Base', sandbox: 'BASE_SEPOLIA', production: 'BASE'},
    wallet_connect: {chain_display_name: 'Base', symbol: 'ETH'},
    scan: {
      sandbox: 'https://sepolia.basescan.org',
      production: 'https://basescan.org',
      txPath: 'tx',
    },
    gas_oracle: '0x420000000000000000000000000000000000000F',
    batch_contract: {
      sandbox: '0x1A26f0b16172784Db9C71a220893fB5EA859e3fb',
      production: '0xC6c4684b0e3D42D94c16cD5Cbeb6618d2202FB9D',
    },
  },
  optimism: {
    chain_id: {sandbox: 11155420, production: 10},
    moralis: {key: 'Optimism', sandbox: 'OPTIMISM', production: 'OPTIMISM'},
    wallet_connect: {chain_display_name: 'Optimism', symbol: 'ETH'},
    scan: {
      sandbox: 'https://sepolia-optimism.etherscan.io',
      production: 'https://optimistic.etherscan.io/',
      txPath: 'tx',
    },
    gas_oracle: '0x420000000000000000000000000000000000000F',
    batch_contract: {
      production: '0xC6c4684b0e3D42D94c16cD5Cbeb6618d2202FB9D',
    },
  },
  arbitrum: {
    chain_id: {sandbox: 421614, production: 42161},
    moralis: {
      key: 'Arbitrum',
      sandbox: 'ARBITRUM_TESTNET',
      production: 'ARBITRUM',
    },
    wallet_connect: {chain_display_name: 'Arbitrum', symbol: 'ETH'},
    scan: {
      sandbox: 'https://sepolia.arbiscan.io/',
      production: 'https://arbiscan.io',
      txPath: 'tx',
    },
    batch_contract: {
      production: '0xC6c4684b0e3D42D94c16cD5Cbeb6618d2202FB9D',
    },
  },
  optimism_binance_smart_chain: {
    chain_id: {sandbox: 5611, production: 204},
    wallet_connect: {
      chain_display_name: 'Optimism Binance Smart Chain',
      symbol: 'BNB',
    },
    scan: {
      sandbox: 'https://opbnb-testnet.bscscan.com',
      production: 'https://opbnb.bscscan.com',
      txPath: 'tx',
    },
    gas_oracle: '0x420000000000000000000000000000000000000F',
  },
  avalanche: {
    chain_id: {sandbox: 43113, production: 43114},
    wallet_connect: {chain_display_name: 'Avalanche', symbol: 'AVAX'},
    scan: {
      sandbox: 'https://testnet.snowtrace.io',
      production: 'https://snowtrace.io',
      txPath: 'tx',
    },
    scan_api_url: 'https://api-beta.avascan.info/v2/network/mainnet/evm/43114',
  },
  fantom: {
    chain_id: {sandbox: 4002, production: 250},
    wallet_connect: {chain_display_name: 'Fantom', symbol: 'FTM'},
    scan: {
      sandbox: 'https://testnet.ftmscan.com',
      production: 'https://ftmscan.com',
      txPath: 'tx',
    },
  },
  gnosis: {
    chain_id: {sandbox: 10200, production: 100},
    wallet_connect: {chain_display_name: 'Gnosis', symbol: 'XDAI'},
    scan: {
      sandbox: 'https://gnosisscan.io/',
      production: 'https://gnosisscan.io/',
      txPath: 'tx',
    },
    batch_contract: {
      production: '0xC6c4684b0e3D42D94c16cD5Cbeb6618d2202FB9D',
    },
  },
  viction: {
    chain_id: {sandbox: 89, production: 88},
    wallet_connect: {chain_display_name: 'Viction', symbol: 'VIC'},
    scan: {
      sandbox: 'https://testnet.vicscan.xyz',
      production: 'https://vicscan.xyz',
      txPath: 'tx',
    },
    scan_api_url: {
      sandbox: 'https://scan-api-testnet.viction.xyz',
      production: 'https://vicscan.xyz',
    },
  },
  zksync: {
    chain_id: {sandbox: 300, production: 324},
    wallet_connect: {chain_display_name: 'zkSync Era', symbol: 'ETH'},
    scan: {
      sandbox: 'https://sepolia.explorer.zksync.io',
      production: 'https://explorer.zksync.io',
      txPath: 'tx',
    },
  },
  linea: {
    chain_id: {sandbox: 59141, production: 59144},
    wallet_connect: {chain_display_name: 'Linea', symbol: 'ETH'},
    scan: {
      sandbox: 'https://sepolia.lineascan.build',
      production: 'https://lineascan.build',
      txPath: 'tx',
    },
  },
  ethereum_classic: {
    chain_id: {sandbox: 61, production: 61},
    wallet_connect: {chain_display_name: 'Ethereum Classic', symbol: 'ETC'},
    scan: {
      sandbox: 'https://etc.blockscout.com',
      production: 'https://etc.blockscout.com',
      txPath: 'tx',
    },
  },
  ethereum_pow: {
    chain_id: {sandbox: 10001, production: 10001},
    wallet_connect: {chain_display_name: 'EthereumPoW', symbol: 'ETC'},
    scan: {
      sandbox: 'https://www.oklink.com/ethw',
      production: 'https://www.oklink.com/ethw',
      txPath: 'tx',
    },
  },
  kava: {
    chain_id: {sandbox: 2221, production: 2222},
    wallet_connect: {chain_display_name: 'Kava', symbol: 'KAVA'},
    scan: {
      sandbox: 'https://testnet.kavascan.io/',
      production: 'https://kavascan.com/',
      txPath: 'tx',
    },
  },
  ink: {
    chain_id: {sandbox: 763373, production: 57073},
    wallet_connect: {chain_display_name: 'Ink', symbol: 'ETH'},
    scan: {
      sandbox: 'https://explorer-sepolia.inkonchain.com/',
      production: 'https://explorer.inkonchain.com/',
      txPath: 'tx',
    },
    scan_api_url: {
      sandbox: 'https://explorer-sepolia.inkonchain.com',
      production: 'https://explorer.inkonchain.com',
    },
    gas_oracle: '0x420000000000000000000000000000000000000F',
    batch_contract: {
      production: '0xC6c4684b0e3D42D94c16cD5Cbeb6618d2202FB9D',
    },
  },
  sei: {
    chain_id: {sandbox: 1328, production: 1329},
    wallet_connect: {chain_display_name: 'Sei', symbol: 'SEI'},
    scan: {
      sandbox: 'https://testnet.seiscan.io',
      production: 'https://seiscan.io',
      txPath: 'tx',
    },
  },
  hyperliquid: {
    chain_id: {sandbox: 998, production: 999},
    wallet_connect: {chain_display_name: 'Hyperliquid', symbol: 'HYPE'},
    scan: {
      sandbox: 'https://hyperevmscan.io/',
      production: 'https://hyperevmscan.io/',
      txPath: 'tx',
    },
  },
  robinhood: {
    chain_id: {sandbox: 46630, production: 4663},
    wallet_connect: {chain_display_name: 'Robinhood', symbol: 'ETH'},
    scan: {
      sandbox: 'https://explorer.testnet.chain.robinhood.com',
      production: 'https://robinhoodchain.blockscout.com',
      txPath: 'tx',
    },
  },
  tron: {
    wallet_connect: {chain_display_name: 'Tron', symbol: 'TRX'},
    wallet_connect_key: {
      sandbox: 'tron:0xcd8690dc',
      production: 'tron:0x2b6653dc',
    },
    scan: {
      sandbox: 'https://nile.tronscan.org/#',
      production: 'https://tronscan.org/#',
      txPath: 'transaction',
    },
    full_host: 'https://api.trongrid.io',
  },
  solana: {
    moralis: {key: 'Solana', sandbox: 'DEVNET', production: 'MAINNET'},
    wallet_connect: {chain_display_name: 'Solana', symbol: 'SOL'},
    wallet_connect_key: {
      sandbox: 'solana:8E9rvCKLFQia2Y35HXjjpWzj8weVo44K',
      production: 'solana:4sGjMW1sUnHzSxGspuhpqLDx6wiyjNtZ',
    },
    scan: {
      sandbox: 'https://solscan.io',
      production: 'https://solscan.io',
      txPath: 'tx',
      sandboxQueryParam: 'cluster=devnet',
    },
    rpc_contract_chain_id: {sandbox: 103, production: 101},
    stake_wiz_base_url: 'https://api.stakewiz.com',
  },
  bitcoin: {
    scan: {
      sandbox: 'https://mempool.space/testnet',
      production: 'https://mempool.space',
      txPath: 'tx',
    },
    api_base_url: {
      sandbox: 'https://mempool.space/testnet/api',
      production: 'https://mempool.space/api',
    },
  },
  litecoin: {
    scan: {
      sandbox: 'https://blockchair.com/litecoin',
      production: 'https://blockchair.com/litecoin',
      txPath: 'transaction',
    },
    network_string: {
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
  },
  dogecoin: {
    scan: {
      sandbox: 'https://blockchair.com/dogecoin',
      production: 'https://blockchair.com/dogecoin',
      txPath: 'transaction',
    },
    network_string: {
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
  },
  bitcoin_cash: {
    scan: {
      sandbox: 'https://blockchair.com/bitcoin-cash',
      production: 'https://blockchair.com/bitcoin-cash',
      txPath: 'transaction',
    },
    network_string: {
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
  },
  cosmos: {
    scan: {
      sandbox: 'https://www.mintscan.io',
      production: 'https://www.mintscan.io',
      txPath: 'cosmos/tx',
    },
    scan_api_base_url: 'https://apis.mintscan.io',
    scan_api_key: process.env.COSMOS_API_KEY,
    rest_base_url: 'https://cosmos-rest.publicnode.com',
  },
  polkadot: {
    scan: {
      sandbox: 'https://polkadot.subscan.io',
      production: 'https://polkadot.subscan.io',
      txPath: 'extrinsic',
    },
  },
  tezos: {
    scan: {
      sandbox: 'https://ghostnet.tzkt.io',
      production: 'https://tzkt.io',
      txPath: '',
    },
    api_base_url: {
      sandbox: 'https://api.ghostnet.tzkt.io',
      production: 'https://api.tzkt.io',
    },
  },
  thorchain: {
    scan: {
      sandbox: 'https://viewblock.io/thorchain',
      production: 'https://viewblock.io/thorchain',
      txPath: 'tx',
    },
    api_base_url: 'https://midgard.thorchain.network',
  },
  stellar: {
    scan: {
      sandbox: 'https://testnet.stellarchain.io',
      production: 'https://stellarchain.io',
      txPath: 'transactions',
    },
    horizon_url: {
      sandbox: 'https://horizon-testnet.stellar.org',
      production: 'https://horizon.stellar.org',
    },
  },
  ripple: {
    scan: {
      sandbox: 'https://testnet.xrpl.org',
      production: 'https://livenet.xrpl.org',
      txPath: 'transactions',
    },
  },
  ton: {
    scan: {
      sandbox: 'https://testnet.tonscan.org',
      production: 'https://tonscan.org',
      txPath: 'tx',
    },
  },
  aptos: {
    scan: {
      sandbox: 'https://explorer.aptoslabs.com',
      production: 'https://explorer.aptoslabs.com',
      txPath: 'txn',
      sandboxQueryParam: 'network=testnet',
    },
  },
  hedera: {
    scan: {
      sandbox: 'https://hashscan.io/testnet',
      production: 'https://hashscan.io/mainnet',
      txPath: 'transaction',
    },
    api_base_url: {
      sandbox: 'https://testnet.mirrornode.hedera.com',
      production: 'https://mainnet.mirrornode.hedera.com',
    },
  },
  cardano: {
    scan: {
      sandbox: 'https://cardanoscan.io',
      production: 'https://cardanoscan.io',
      txPath: 'transaction',
    },
  },
  filecoin: {
    scan: {
      sandbox: 'https://calibration.filscan.io/en',
      production: 'https://filscan.io/en',
      txPath: 'message',
    },
  },
};

const forEnv = value => (IS_SANDBOX ? value.sandbox : value.production);
const scanBase = chain_name => forEnv(CHAIN_CONFIG[chain_name].scan);

export const CHAIN_ID = Object.fromEntries(
  Object.entries(CHAIN_CONFIG)
    .filter(([, cfg]) => cfg.chain_id)
    .map(([chain_name, cfg]) => [chain_name, forEnv(cfg.chain_id)]),
);

const WALLET_CONNECT_SUPPORTED_CHAIN = Object.fromEntries(
  Object.entries(CHAIN_CONFIG)
    .filter(([, cfg]) => cfg.wallet_connect)
    .map(([chain_name, cfg]) => [
      cfg.wallet_connect_key
        ? forEnv(cfg.wallet_connect_key)
        : `eip155:${forEnv(cfg.chain_id)}`,
      {
        chain_display_name: cfg.wallet_connect.chain_display_name,
        chain_name,
        symbol: cfg.wallet_connect.symbol,
      },
    ]),
);

export const GAS_ORACLE_CONTRACT_ADDRESS = Object.fromEntries(
  Object.entries(CHAIN_CONFIG)
    .filter(([, cfg]) => cfg.gas_oracle)
    .map(([chain_name, cfg]) => [chain_name, cfg.gas_oracle]),
);

export const BATCH_TRANSACTION_CONTRACT_ADDRESS = Object.fromEntries(
  Object.entries(CHAIN_CONFIG)
    .filter(([, cfg]) => cfg.batch_contract && forEnv(cfg.batch_contract))
    .map(([chain_name, cfg]) => [chain_name, forEnv(cfg.batch_contract)]),
);

let moralisChain;

export const config = {
  TRON_SOLIDITY_NODE: CHAIN_CONFIG.tron.full_host,
  TRON_EVENT_SERVER: CHAIN_CONFIG.tron.full_host,
  TRON_FULL_HOST: CHAIN_CONFIG.tron.full_host,
  BLOCK_CYPHER_BASE_URL: 'https://api.blockcypher.com',
  TRONWEB_BASE_URL: CHAIN_CONFIG.tron.full_host,

  ETHEREUM_SCAN_BASE_URL: 'https://api.etherscan.io/v2',
  INK_BLOCK_EXPLORER_BASE_URL: forEnv(CHAIN_CONFIG.ink.scan_api_url),

  KAVA_SCAN_BASE_URL: scanBase('kava'),
  DOK_WALLET_BASE_URL: process.env.DOK_WALLET_BASE_URL,
  // DOK_WALLET_BASE_URL: 'https://prompt-premium-mullet.ngrok-free.app/dashboard',
  ATTEST_WORKER_BASE_URL: process.env.ATTEST_WORKER_BASE_URL,
  // ATTEST_WORKER_BASE_URL: 'https://prompt-premium-mullet.ngrok-free.app',
  BITCOIN_SCAN_URL: scanBase('bitcoin'),
  BITCOIN_BASE_URL: forEnv(CHAIN_CONFIG.bitcoin.api_base_url),
  get BITCOIN_NETWORK_STRING() {
    const bitcoin = require('bitcoinjs-lib');
    return IS_SANDBOX ? bitcoin?.networks?.testnet : bitcoin?.networks?.mainnet;
  },
  LITECOIN_NETWORK_STRING: CHAIN_CONFIG.litecoin.network_string,
  BITCOIN_CASH_NETWORK: CHAIN_CONFIG.bitcoin_cash.network_string,
  LITECOIN_SCAN_URL: scanBase('litecoin'),
  BITCOIN_CASH_SCAN_URL: scanBase('bitcoin_cash'),
  SOLANA_RPC_CONTRACT_CHAIN_ID: forEnv(
    CHAIN_CONFIG.solana.rpc_contract_chain_id,
  ),
  WALLET_CONNECT_SUPPORTED_CHAIN,
  SOLANA_SCAN_URL: scanBase('solana'),

  get MORALIS_CHAIN() {
    if (!moralisChain) {
      const {EvmChain} = require('@moralisweb3/common-evm-utils');
      const {SolNetwork} = require('@moralisweb3/common-sol-utils');
      moralisChain = Object.fromEntries(
        Object.entries(CHAIN_CONFIG)
          .filter(([, cfg]) => cfg.moralis)
          .map(([chain_name, cfg]) => [
            cfg.moralis.key,
            chain_name === 'solana'
              ? SolNetwork[forEnv(cfg.moralis)]
              : EvmChain[forEnv(cfg.moralis)],
          ]),
      );
    }
    return moralisChain;
  },
  get STELLAR_NETWORK() {
    const {Networks} = require('@stellar/stellar-sdk');
    return IS_SANDBOX ? Networks.TESTNET : Networks.PUBLIC;
  },
  STELLAR_URL: forEnv(CHAIN_CONFIG.stellar.horizon_url),
  STELLAR_SCAN_URL: scanBase('stellar'),
  RIPPLE_SCAN_URL: scanBase('ripple'),
  THORCHAIN_API_URL: CHAIN_CONFIG.thorchain.api_base_url,
  THORCHAIN_SCAN_URL: scanBase('thorchain'),
  TZKT_API_BASE_URL: forEnv(CHAIN_CONFIG.tezos.api_base_url),
  TEZOS_SCAN_URL: scanBase('tezos'),
  STAKE_WIZ_BASE_URL: CHAIN_CONFIG.solana.stake_wiz_base_url,

  COSMOS_SCAN_URL: scanBase('cosmos'),
  COSMOS_SCAN_BASE_URL: CHAIN_CONFIG.cosmos.scan_api_base_url,
  COSMOS_API_KEY: CHAIN_CONFIG.cosmos.scan_api_key,
  COSMOS_REST_BASE_URL: CHAIN_CONFIG.cosmos.rest_base_url,
  AVAX_SCAN_API_URL: CHAIN_CONFIG.avalanche.scan_api_url,
  VICTION_SCAN_API_URL: forEnv(CHAIN_CONFIG.viction.scan_api_url),
  POLKADOT_SCAN_URL: scanBase('polkadot'),
  TON_SCAN_URL: scanBase('ton'),
  TRON_SCAN_URL: scanBase('tron'),
  ETHEREUM_CLASSIC_SCAN_API_URL: scanBase('ethereum_classic'),
  DOGECOIN_NETWORK_STRING: CHAIN_CONFIG.dogecoin.network_string,
  DOGECOIN_SCAN_URL: scanBase('dogecoin'),
  APTOS_SCAN_URL: scanBase('aptos'),
  HEDERA_BASE_URL: forEnv(CHAIN_CONFIG.hedera.api_base_url),
  HEDERA_SCAN_URL: scanBase('hedera'),
  CARDANO_SCAN_URL: scanBase('cardano'),
  FILECOIN_SCAN_URL: scanBase('filecoin'),
};

export const SCAN_URL = Object.fromEntries(
  Object.entries(CHAIN_CONFIG)
    .filter(([, cfg]) => cfg.scan)
    .flatMap(([chain_name, cfg]) => {
      const toEntry = scan => ({
        baseUrl: forEnv(scan),
        txPath: scan.txPath,
        ...(scan.sandboxQueryParam
          ? {sandboxQueryParam: scan.sandboxQueryParam}
          : {}),
      });
      if (chain_name === 'polygon') {
        return [
          ['polygon_scan', toEntry(cfg.scan)],
          ['polygon_blockscout', toEntry(cfg.scan_blockscout)],
        ];
      }
      return [[chain_name, toEntry(cfg.scan)]];
    }),
);

export const APP_NAME = process?.env?.APP_NAME || '';
export const isWeb = APP_NAME === 'dokwallet-desktop';
