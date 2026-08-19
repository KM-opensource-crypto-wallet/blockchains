// CHANE BELOW FLAG TO false
export const IS_SANDBOX = false;

export const CHAIN_CONFIG = {
  ethereum: {
    gas_currency: 'Gwei',
    private_key_list: {label: 'Ethereum', order: 11},
    add_token: {
      label: 'Ethereum',
      chain_symbol: 'ETH',
      type: 'token',
      token_type: 'ERC20',
      isEVM: true,
      order: 0,
    },
    custom_rpc: {label: 'Ethereum', order: 0},
    derivation_paths: [
      {
        label: "Ledger (m/44'/60'/1'/0/0)",
        value: "m/44'/60'/1'/0/0",
      },
      {
        label: "Metamask (m/44'/60'/0'/0/1)",
        value: "m/44'/60'/0'/0/1",
      },
    ],
    derive_index: 4,
    free_rpc_urls: {
      mainnet: [
        'https://eth-mainnet.public.blastapi.io',
        'https://rpc.mevblocker.io',
        'https://eth.drpc.org',
      ],
      testnet: [
        'https://1rpc.io/sepolia',
        'https://ethereum-sepolia-rpc.publicnode.com',
      ],
    },
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
    private_key_list: {label: 'Binance Smart Chain', order: 4},
    add_token: {
      label: 'Binance Smart Chain',
      chain_symbol: 'BNB',
      type: 'token',
      token_type: 'BEP20',
      isEVM: true,
      order: 3,
    },
    custom_rpc: {label: 'Binance Smart Chain', order: 1},
    free_rpc_urls: {
      mainnet: [
        'https://bsc-rpc.publicnode.com',
        'https://bsc.drpc.org',
        'https://binance.llamarpc.com',
        'https://binance-smart-chain-public.nodies.app',
      ],
      testnet: ['https://bsc-testnet.publicnode.com'],
    },
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
    private_key_list: {label: 'Polygon', order: 25},
    add_token: {
      label: 'Polygon',
      chain_symbol: 'POL',
      type: 'token',
      token_type: 'ERC20',
      isEVM: true,
      order: 1,
    },
    custom_rpc: {label: 'Polygon', order: 2},
    free_rpc_urls: {
      mainnet: [
        'https://polygon-bor-rpc.publicnode.com',
        'https://polygon.drpc.org',
        'https://polygon-public.nodies.app',
      ],
      testnet: ['https://polygon-amoy-bor-rpc.publicnode.com'],
    },
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
    private_key_list: {label: 'Base', order: 3},
    add_token: {
      label: 'Base',
      chain_symbol: 'ETH',
      type: 'token',
      token_type: 'ERC20',
      isEVM: true,
      order: 2,
    },
    custom_rpc: {label: 'Base', order: 3},
    free_rpc_urls: {
      mainnet: [
        'https://base-rpc.publicnode.com',
        'https://base-mainnet.public.blastapi.io',
        'https://base.llamarpc.com',
      ],
      testnet: [
        'https://base-sepolia-rpc.publicnode.com',
        'https://sepolia.base.org',
      ],
    },
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
    private_key_list: {label: 'Optimism', order: 22},
    add_token: {
      label: 'Optimism',
      chain_symbol: 'ETH',
      type: 'token',
      token_type: 'ERC20',
      isEVM: true,
      order: 7,
    },
    custom_rpc: {label: 'Optimism', order: 5},
    free_rpc_urls: {
      mainnet: [
        'https://optimism-rpc.publicnode.com',
        'https://optimism.drpc.org',
      ],
      testnet: ['https://sepolia.optimism.io'],
    },
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
    private_key_list: {label: 'Arbitrum', order: 1},
    add_token: {
      label: 'Arbitrum',
      chain_symbol: 'ETH',
      type: 'token',
      token_type: 'ERC20',
      isEVM: true,
      order: 6,
    },
    custom_rpc: {label: 'Arbitrum', order: 4},
    free_rpc_urls: {
      mainnet: [
        'https://arbitrum-one-rpc.publicnode.com',
        'https://arbitrum.drpc.org',
      ],
      testnet: ['https://sepolia-rollup.arbitrum.io/rpc'],
    },
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
    private_key_list: {label: 'Optimism Binance Smart Chain', order: 23},
    add_token: {
      label: 'Optimism Binance Smart Chain',
      chain_symbol: 'BNB',
      type: 'token',
      token_type: 'BEP20',
      isEVM: true,
      order: 8,
    },
    custom_rpc: {label: 'Optimism Binance Smart Chain', order: 6},
    free_rpc_urls: {
      mainnet: ['https://opbnb-rpc.publicnode.com', 'https://opbnb.drpc.org'],
      testnet: [
        'https://opbnb-testnet-rpc.bnbchain.org',
        'https://opbnb-testnet.nodereal.io/v1/e9a36765eb8a40b9bd12e680a1fd2bc5',
        'https://opbnb-testnet.nodereal.io/v1/64a9df0874fb4a93b9d0a3849de012d3',
      ],
    },
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
    private_key_list: {label: 'Avalanche', order: 2},
    add_token: {
      label: 'Avalanche',
      chain_symbol: 'AVAX',
      type: 'token',
      token_type: 'ERC20',
      isEVM: true,
      order: 9,
    },
    custom_rpc: {label: 'Avalanche', order: 7},
    free_rpc_urls: {
      mainnet: [
        'https://avalanche-c-chain-rpc.publicnode.com',
        'https://avalanche.drpc.org',
      ],
      testnet: [
        'https://avalanche-fuji-c-chain-rpc.publicnode.com',
        'https://endpoints.omniatech.io/v1/avax/fuji/public',
        'https://api.avax-test.network/ext/bc/C/rpc',
      ],
    },
    chain_id: {sandbox: 43113, production: 43114},
    wallet_connect: {chain_display_name: 'Avalanche', symbol: 'AVAX'},
    scan: {
      sandbox: 'https://testnet.snowtrace.io',
      production: 'https://snowtrace.io',
      txPath: 'tx',
    },
  },
  fantom: {
    private_key_list: {label: 'Fantom', order: 14},
    add_token: {
      label: 'Fantom',
      chain_symbol: 'FTM',
      type: 'token',
      token_type: 'ERC20',
      isEVM: true,
      order: 10,
    },
    custom_rpc: {label: 'Fantom', order: 8},
    free_rpc_urls: {
      mainnet: [
        'https://fantom-rpc.publicnode.com',
        'https://fantom-rpc.publicnode.com',
        'https://fantom.drpc.org',
      ],
      testnet: ['https://fantom-testnet.drpc.org'],
    },
    chain_id: {sandbox: 4002, production: 250},
    wallet_connect: {chain_display_name: 'Fantom', symbol: 'FTM'},
    scan: {
      sandbox: 'https://testnet.ftmscan.com',
      production: 'https://ftmscan.com',
      txPath: 'tx',
    },
  },
  gnosis: {
    private_key_list: {label: 'Gnosis', order: 15},
    add_token: {
      label: 'Gnosis',
      chain_symbol: 'XDAI',
      type: 'token',
      token_type: 'ERC20',
      isEVM: true,
      order: 11,
    },
    custom_rpc: {label: 'Gnosis', order: 9},
    free_rpc_urls: {
      mainnet: ['https://gnosis-rpc.publicnode.com', 'https://gnosis.drpc.org'],
      testnet: [
        'https://1rpc.io/gnosis',
        'https://gnosis-chiado-rpc.publicnode.com',
        'https://rpc.chiadochain.net',
      ],
    },
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
    private_key_list: {label: 'Viction', order: 32},
    add_token: {
      label: 'Viction',
      chain_symbol: 'VIC',
      type: 'token',
      token_type: 'ERC20',
      isEVM: true,
      order: 15,
    },
    custom_rpc: {label: 'Viction', order: 10},
    free_rpc_urls: {
      mainnet: ['https://viction.drpc.org'],
      testnet: ['https://rpc-testnet.viction.xyz'],
    },
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
    private_key_list: {label: 'zkSync Era', order: 33},
    add_token: {
      label: 'zkSync Era',
      chain_symbol: 'ETH',
      type: 'token',
      token_type: 'ERC20',
      isEVM: true,
      order: 14,
    },
    custom_rpc: {label: 'zkSync Era', order: 12},
    free_rpc_urls: {
      mainnet: ['https://zksync.drpc.org', 'https://rpc.ankr.com/zksync_era'],
      testnet: [
        'https://zksync-sepolia.drpc.org',
        'https://endpoints.omniatech.io/v1/zksync-era/sepolia/public',
      ],
    },
    chain_id: {sandbox: 300, production: 324},
    wallet_connect: {chain_display_name: 'zkSync Era', symbol: 'ETH'},
    scan: {
      sandbox: 'https://sepolia.explorer.zksync.io',
      production: 'https://explorer.zksync.io',
      txPath: 'tx',
    },
  },
  linea: {
    private_key_list: {label: 'Linea', order: 20},
    add_token: {
      label: 'Linea',
      chain_symbol: 'ETH',
      type: 'token',
      token_type: 'ERC20',
      isEVM: true,
      order: 13,
    },
    custom_rpc: {label: 'Linea', order: 11},
    free_rpc_urls: {
      mainnet: ['https://linea-rpc.publicnode.com', 'https://linea.drpc.org'],
      testnet: [
        'https://rpc.sepolia.linea.build',
        'https://linea-sepolia.infura.io/v3/9aa3d95b3bc440fa88ea12eaa4456161',
      ],
    },
    chain_id: {sandbox: 59141, production: 59144},
    wallet_connect: {chain_display_name: 'Linea', symbol: 'ETH'},
    scan: {
      sandbox: 'https://sepolia.lineascan.build',
      production: 'https://lineascan.build',
      txPath: 'tx',
    },
  },
  ethereum_classic: {
    private_key_list: {label: 'Ethereum Classic', order: 12},
    add_token: {
      label: 'Ethereum Classic',
      chain_symbol: 'ETC',
      type: 'token',
      token_type: 'ERC20',
      isEVM: true,
      order: 16,
    },
    custom_rpc: {label: 'Ethereum Classic', order: 13},
    free_rpc_urls: {
      mainnet: ['https://0xrpc.io/etc', 'https://geth-at.etc-network.info'],
      testnet: [
        'https://etc.etcdesktop.com',
        'https://rpc.etcinscribe.com',
        'https://geth-at.etc-network.info',
        'https://etc.rivet.link',
      ],
    },
    chain_id: {sandbox: 61, production: 61},
    wallet_connect: {chain_display_name: 'Ethereum Classic', symbol: 'ETC'},
    scan: {
      sandbox: 'https://etc.blockscout.com',
      production: 'https://etc.blockscout.com',
      txPath: 'tx',
    },
  },
  ethereum_pow: {
    private_key_list: {label: 'EthereumPoW', order: 13},
    add_token: {
      label: 'EthereumPoW',
      chain_symbol: 'ETHW',
      type: 'token',
      token_type: 'ERC20',
      isEVM: true,
      order: 17,
    },
    custom_rpc: {label: 'EthereumPoW', order: 14},
    free_rpc_urls: {
      mainnet: ['https://mainnet.ethereumpow.org'],
      testnet: ['https://mainnet.ethereumpow.org'],
    },
    scan_proxy: true,
    chain_id: {sandbox: 10001, production: 10001},
    wallet_connect: {chain_display_name: 'EthereumPoW', symbol: 'ETC'},
    scan: {
      sandbox: 'https://www.oklink.com/ethw',
      production: 'https://www.oklink.com/ethw',
      txPath: 'tx',
    },
  },
  kava: {
    private_key_list: {label: 'Kava', order: 19},
    add_token: {
      label: 'Kava',
      chain_symbol: 'KAVA',
      type: 'token',
      token_type: 'ERC20',
      isEVM: true,
      order: 12,
    },
    custom_rpc: {label: 'Kava', order: 15},
    free_rpc_urls: {
      mainnet: ['https://kava-evm-rpc.publicnode.com', 'https://kava.drpc.org'],
      testnet: ['https://kava-testnet.drpc.org', 'https://evm.testnet.kava.io'],
    },
    chain_id: {sandbox: 2221, production: 2222},
    wallet_connect: {chain_display_name: 'Kava', symbol: 'KAVA'},
    scan: {
      sandbox: 'https://testnet.kavascan.io/',
      production: 'https://kavascan.com/',
      txPath: 'tx',
    },
  },
  ink: {
    private_key_list: {label: 'Ink', order: 18},
    add_token: {
      label: 'Ink',
      chain_symbol: 'ETH',
      type: 'token',
      token_type: 'ERC20',
      isEVM: true,
      order: 18,
    },
    custom_rpc: {label: 'Ink', order: 16},
    free_rpc_urls: {
      mainnet: [
        'https://rpc-qnd.inkonchain.com',
        'https://rpc-gel.inkonchain.com',
      ],
      testnet: ['https://rpc-gel-sepolia.inkonchain.com'],
    },
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
    private_key_list: {label: 'Sei', order: 26},
    add_token: {
      label: 'SEI',
      chain_symbol: 'SEI',
      type: 'token',
      token_type: 'ERC20',
      isEVM: true,
      order: 19,
    },
    custom_rpc: {label: 'Sei', order: 17},
    free_rpc_urls: {
      mainnet: ['https://sei.drpc.org'],
      testnet: [
        'https://evm-rpc-testnet.sei-apis.com',
        'https://sei-testnet-public.nodies.app',
      ],
    },
    chain_id: {sandbox: 1328, production: 1329},
    wallet_connect: {chain_display_name: 'Sei', symbol: 'SEI'},
    scan: {
      sandbox: 'https://testnet.seiscan.io',
      production: 'https://seiscan.io',
      txPath: 'tx',
    },
  },
  hyperliquid: {
    private_key_list: {label: 'Hyperliquid', order: 17},
    add_token: {
      label: 'Hyperliquid',
      chain_symbol: 'HYPE',
      type: 'token',
      token_type: 'ERC20',
      isEVM: true,
      order: 20,
    },
    custom_rpc: {label: 'Hyperliquid', order: 18},
    free_rpc_urls: {
      mainnet: [
        'https://rpc.hyperliquid.xyz/evm',
        'https://hyperliquid-json-rpc.stakely.io',
        'https://hyperliquid.drpc.org',
        'https://rpc.hypurrscan.io',
      ],
      testnet: ['https://rpc.hyperliquid-testnet.xyz/evm'],
    },
    chain_id: {sandbox: 998, production: 999},
    wallet_connect: {chain_display_name: 'Hyperliquid', symbol: 'HYPE'},
    scan: {
      sandbox: 'https://hyperevmscan.io/',
      production: 'https://hyperevmscan.io/',
      txPath: 'tx',
    },
  },
  robinhood: {
    add_token: {
      label: 'Robinhood',
      chain_symbol: 'ETH',
      type: 'token',
      token_type: 'ERC20',
      isEVM: true,
      order: 21,
    },
    custom_rpc: {label: 'Robinhood', order: 19},
    free_rpc_urls: {
      mainnet: ['https://rpc.mainnet.chain.robinhood.com'],
      testnet: [
        'https://rpc.testnet.chain.robinhood.com',
        'https://robinhood-testnet.drpc.org',
      ],
    },
    chain_id: {sandbox: 46630, production: 4663},
    wallet_connect: {chain_display_name: 'Robinhood', symbol: 'ETH'},
    scan: {
      sandbox: 'https://explorer.testnet.chain.robinhood.com',
      production: 'https://robinhoodchain.blockscout.com',
      txPath: 'tx',
    },
  },
  tron: {
    private_key_list: {label: 'Tron', order: 31},
    add_token: {
      label: 'Tron',
      chain_symbol: 'TRX',
      type: 'token',
      token_type: 'TRC20',
      order: 4,
    },
    derivation_paths: [
      {
        label: "Ledger (m/44'/195'/1'/0/0)",
        value: "m/44'/195'/1'/0/0",
      },
    ],
    derive_index: 4,
    staking_resources: [
      {
        label: 'BANDWIDTH',
        value: 'BANDWIDTH',
      },
      {
        label: 'ENERGY',
        value: 'ENERGY',
      },
    ],
    rpc_urls: {
      solidity_node: {
        mainnet: 'https://api.trongrid.io',
        testnet: 'https://nile.trongrid.io',
      },
      event_server: {
        mainnet: 'https://api.trongrid.io',
        testnet: 'https://nile.trongrid.io',
      },
      full_host: {
        mainnet: 'https://api.trongrid.io',
        testnet: 'https://nile.trongrid.io',
      },
    },
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
  },
  solana: {
    private_key_list: {label: 'Solana', order: 27},
    add_token: {
      label: 'Solana',
      chain_symbol: 'SOL',
      type: 'token',
      token_type: 'SPL20',
      order: 5,
    },
    derivation_paths: [
      {
        label: "Ledger (m/44'/501'/1')",
        value: "m/44'/501'/1'",
      },
    ],
    derive_index: 3,
    free_rpc_urls: {
      mainnet: [
        'https://solana-mainnet.g.alchemy.com/v2/LqXKA4ZLdyCbWyPwtLqri3696CgruA0w',
        'https://proud-quaint-patina.solana-mainnet.quiknode.pro/7955f2808766bd176ed1fe12d66abd88b33059dd',
        'https://api.mainnet-beta.solana.com',
      ],
      testnet: ['https://api.devnet.solana.com'],
    },
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
    gas_currency: 'sat/B',
    private_key_list: {label: 'Bitcoin Native Segwit', order: 8},
    derivation_paths: [
      {
        label: "Ledger (m/84'/0'/1'/0/0)",
        value: "m/84'/0'/1'/0/0",
      },
    ],
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
  bitcoin_legacy: {
    gas_currency: 'sat/B',
    private_key_list: {label: 'Bitcoin Legacy', order: 6},
    derivation_paths: [
      {
        label: "Ledger (m/44'/0'/1'/0/0)",
        value: "m/44'/0'/1'/0/0",
      },
    ],
  },

  bitcoin_segwit: {
    gas_currency: 'sat/B',
    private_key_list: {label: 'Bitcoin Segwit', order: 7},
    derivation_paths: [
      {
        label: "Ledger (m/49'/0'/1'/0/0)",
        value: "m/49'/0'/1'/0/0",
      },
    ],
  },

  litecoin: {
    gas_currency: 'lit/B',
    private_key_list: {label: 'Litecoin', order: 21},
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
    gas_currency: 'sat/B',
    private_key_list: {label: 'Dogecoin', order: 10},
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
    gas_currency: 'sat/B',
    private_key_list: {label: 'Bitcoin Cash', order: 5},
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
    private_key_list: {label: 'Cosmos', order: 9},
    rpc_urls: {
      default: {
        mainnet: 'https://cosmos-rpc.publicnode.com:443',
        testnet: 'https://cosmos-rpc.publicnode.com:443',
      },
      rest: {
        mainnet: 'https://cosmos-rest.publicnode.com',
        testnet: 'https://cosmos-rest.publicnode.com',
      },
    },
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
    private_key_list: {label: 'Polkadot', order: 24},
    rpc_urls: {
      default: {
        mainnet: 'https://dot-rpc.stakeworld.io/assethub',
        testnet: 'https://dot-rpc.stakeworld.io/assethub',
      },
    },
    scan_proxy: true,
    scan: {
      sandbox: 'https://polkadot.subscan.io',
      production: 'https://polkadot.subscan.io',
      txPath: 'extrinsic',
    },
  },
  tezos: {
    private_key_list: {label: 'Tezos', order: 29},
    rpc_urls: {
      default: {
        mainnet: 'https://mainnet.tezos.ecadinfra.com',
        testnet: 'https://ghostnet.ecadinfra.com',
      },
    },
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
  },
  stellar: {
    private_key_list: {label: 'Stellar', order: 28},
    rpc_urls: {
      default: {
        mainnet: 'https://horizon.stellar.org',
        testnet: 'https://horizon-testnet.stellar.org',
      },
    },
    scan: {
      sandbox: 'https://testnet.stellarchain.io',
      production: 'https://stellarchain.io',
      txPath: 'transactions',
    },
  },
  ripple: {
    rpc_urls: {
      default: {
        mainnet: 'wss://xrplcluster.com',
        testnet: 'wss://s.altnet.rippletest.net:51233',
      },
      rest: {
        mainnet: 'https://xrplcluster.com',
        testnet: 'https://s.altnet.rippletest.net:51234',
      },
    },
    scan: {
      sandbox: 'https://testnet.xrpl.org',
      production: 'https://livenet.xrpl.org',
      txPath: 'transactions',
    },
  },
  ton: {
    private_key_list: {label: 'Ton', order: 30},
    rpc_urls: {
      default: {
        mainnet: 'https://toncenter.com/api/v2/jsonRPC',
        testnet: 'https://testnet.toncenter.com/api/v2/jsonRPC',
      },
    },
    scan: {
      sandbox: 'https://testnet.tonscan.org',
      production: 'https://tonscan.org',
      txPath: 'tx',
    },
  },
  aptos: {
    private_key_list: {label: 'Aptos', order: 0},
    rpc_urls: {
      default: {
        mainnet: 'https://fullnode.mainnet.aptoslabs.com/v1',
        testnet: 'https://fullnode.testnet.aptoslabs.com/v1',
      },
    },
    scan: {
      sandbox: 'https://explorer.aptoslabs.com',
      production: 'https://explorer.aptoslabs.com',
      txPath: 'txn',
      sandboxQueryParam: 'network=testnet',
    },
  },
  hedera: {
    private_key_list: {label: 'Hedera', order: 16},
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
    scan_proxy: true,
    scan: {
      sandbox: 'https://cardanoscan.io',
      production: 'https://cardanoscan.io',
      txPath: 'transaction',
    },
  },
  filecoin: {
    private_key_list: {label: 'Filecoin', order: 34},
    free_rpc_urls: {
      mainnet: [
        'https://api.node.glif.io/rpc/v0',
        'https://filecoin.chainup.net/rpc/v1',
      ],
      testnet: [
        'https://api.calibration.node.glif.io/rpc/v0',
        'https://filecoin-calibration.chainup.net/rpc/v1',
      ],
    },
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

export const ethereumChains = {
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
  sei: 'ethereum',
  hyperliquid: 'ethereum',
  robinhood: 'ethereum',
};

export const supportedChain = [
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
  'bitcoin_lightning',
];

export const BITCOIN_CHAINS = [
  'bitcoin',
  'bitcoin_segwit',
  'bitcoin_legacy',
  // 'bitcoin_taproot',
];

export const LITECOIN_CHAINS = ['litecoin'];

export const EVM_CHAINS = [
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
  'sei',
  'hyperliquid',
  'robinhood',
];

export const OPTIONS_GAS_FEES_CHAIN = [
  'ethereum',
  'binance_smart_chain',
  'fantom',
  'avalanche',
  'gnosis',
  'linea',
];

export const EIP_1559_NOT_SUPPORTED = [
  'binance_smart_chain',
  'kava',
  'ethereum_classic',
  'ethereum_pow',
];

export const UNCLAIM_DEPOSIT_SUPPORTED_CHAINS = ['bitcoin_lightning'];

export const EIP_7702_SUPPORTED_CHAIN = [
  'ethereum',
  // 'binance_smart_chain',
  'base',
  'optimism',
  'ink',
  'arbitrum',
  'gnosis',
];

export const DERIVE_ADDRESS_SUPPORT_CHAIN = [
  ...EVM_CHAINS,
  'tron',
  'solana',
  'bitcoin',
  'bitcoin_segwit',
  'bitcoin_legacy',
];

export const STAKING_CHAINS = [
  'solana_sol',
  'tron_trx',
  'ethereum_usdt',
  'ethereum_usdc',
];

export const VALIDATORS_SUPPORT_IN_CREATE_STAKING_SCREEN = [
  'solana',
  'ethereum',
];

export const SUPPORT_RESOURCE_TYPE_CREATE_STAKING_SCREEN = ['tron'];

export const feesOptionsChains = [
  'ethereum',
  'bitcoin',
  'bitcoin_segwit',
  'bitcoin_legacy',
  'litecoin',
  'dogecoin',
  'bitcoin_cash',
];

export const TRANSACTION_LIST_LIMIT_100 = [
  'ethereum',
  'polygon',
  'binance_smart_chain',
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
  'sei',
  'robinhood',
];

export const EPOCH_TIME_SUPPORT_CHAIN = ['solana'];

export const UNSTAKING_BUTTON_CHAIN = ['tron', 'ethereum'];

export const VOTE_BUTTON_CHAIN = ['tron'];

export const MEMO_SUPPORT_CHAIN = [
  'cosmos',
  'ton',
  'ripple',
  'solana',
  'stellar',
  'hedera',
  'thorchain',
  'tron',
];

export const NAME_SUPPORT_IN_ADDRESS = ['ethereum', 'binance_smart_chain'];

export const TRANSACTION_LIST_NOT_SUPPORTED_CHAINS = ['aptos', 'kava'];

export const CUSTOM_ADDRESS_NOT_SUPPORTED_CHAINS = ['hedera'];

export const PRIVATE_KEY_NOT_SUPPORTED_CHAINS = [
  'ripple',
  'cardano',
  'bitcoin_lightning',
];

const chainEntries = Object.entries(CHAIN_CONFIG);

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

export const DERIVE_INDEX = Object.fromEntries(
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

export const NFT_SUPPORTED_CHAIN = [
  'Ethereum',
  'BSC',
  'Polygon',
  'Solana',
  'Arbitrum',
  'Base',
  'Optimism',
];

let moralisChain;

export const config = {
  BLOCK_CYPHER_BASE_URL: 'https://api.blockcypher.com',

  ETHEREUM_SCAN_BASE_URL: 'https://api.etherscan.io/v2',
  INK_BLOCK_EXPLORER_BASE_URL: forEnv(CHAIN_CONFIG.ink.scan_api_url),

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
  STELLAR_SCAN_URL: scanBase('stellar'),
  RIPPLE_SCAN_URL: scanBase('ripple'),
  THORCHAIN_SCAN_URL: scanBase('thorchain'),
  TZKT_API_BASE_URL: forEnv(CHAIN_CONFIG.tezos.api_base_url),
  TEZOS_SCAN_URL: scanBase('tezos'),
  STAKE_WIZ_BASE_URL: CHAIN_CONFIG.solana.stake_wiz_base_url,

  COSMOS_SCAN_URL: scanBase('cosmos'),
  COSMOS_SCAN_BASE_URL: CHAIN_CONFIG.cosmos.scan_api_base_url,
  COSMOS_API_KEY: CHAIN_CONFIG.cosmos.scan_api_key,
  COSMOS_REST_BASE_URL: CHAIN_CONFIG.cosmos.rest_base_url,
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
