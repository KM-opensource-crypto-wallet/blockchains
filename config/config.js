// CHANE BELOW FLAG TO false
export const IS_SANDBOX = false;

export const CHAIN_CONFIG = {
  ethereum: {
    premium: {mainnet: true},
    chain_id: {
      sandbox: 11155111,
      production: 1,
    },
    supported: true,
    is_evm: true,
    chain_loader: 'evm',
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
    scan: {
      sandbox: 'https://sepolia.etherscan.io',
      production: 'https://etherscan.io',
      txPath: 'tx',
    },
    custom_rpc: {
      label: 'Ethereum',
      order: 0,
    },
    scan_service: 'etherscan',
    tx_hash_path: 'hash',
    gas_fee_options: true,
    gas_currency: 'Gwei',
    fees_options: true,
    eip_7702: true,
    derive_index: 4,
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
    custom_derivation: {
      Ledger: j => `m/44'/60'/${j}'/0/0`,
      Metamask: j => `m/44'/60'/0'/0/${j}`,
    },
    private_key_list: {
      label: 'Ethereum',
      order: 11,
    },
    staking_keys: ['usdt', 'usdc'],
    staking_contracts: {
      '0x87870bca3f3fd6335c3f4ce8392d69350b4fa4e2': 'stake', // Aave V3 Pool
      '0x3afdc9bca9213a35503b077a6072f3d0d5ab0840': 'stake', // Compound USDT
      '0xc3d688b66703497daa19211eedff47f25384cdc3': 'stake', // Compound USDC
      '0x1b0e765f6224c21223aea2af16c1c46e38885a40': 'stake', // Compound comet reward
      '0x5c20b550819128074fd538edf79791733ccedd18': 'stake', // Fluid USDT
      '0x9fb7b4477576fe5b32be4c1843afb1e55f251b33': 'stake', // Fluid USDC
      '0xdad4e51d64c3b65a9d27ad9f3185b09449712065': 'stake', // Morpho USDT
      '0xbeef01735c132ada46aa9aa4c54623caa92a64cb': 'stake', // Morpho USDC
      '0xe2e7a17dff93280dec073c995595155283e3c372': 'stake', // Spark USDT
      '0x28b3a8fb53b741a8fd78c0fb9a6b2393d896a43d': 'stake', // Spark USDC
      '0x356b8d89c1e1239cbbb9de4815c39a1474d5ba7d': 'stake', // maple USDT
      '0xf007476bb27430795138c511f18f821e8d1e5ee2': 'stake', //  maple USDC
      '0xdac17f958d2ee523a2206206994597c13d831ec7': 'stake', // USDT contract approve
      '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48': 'stake', // USDC contract approve
    },
    staking_validators_screen: true,
    unstaking_button: true,
    address_name_support: true,
    tx_list_limit_100: true,
    moralis: {
      key: 'Ethereum',
      sandbox: 'SEPOLIA',
      production: 'ETHEREUM',
    },
    wallet_connect: {
      chain_display_name: 'Ethereum',
      symbol: 'ETH',
    },
    batch_contract: {
      sandbox: '0x0E79A1C95Ac489634f9aCfc33C914663bBc9FC60',
      production: '0xDA1333D76a1B9883022513c089a0ca84043cF079',
    },
    logo: require('assets/chain_logo/ethereum.png'),
    add_token: {
      label: 'Ethereum',
      chain_symbol: 'ETH',
      type: 'token',
      token_type: 'ERC20',
      isEVM: true,
      order: 0,
    },
  },
  binance_smart_chain: {
    premium: {mainnet: true},
    chain_id: {
      sandbox: 97,
      production: 56,
    },
    is_evm: true,
    chain_loader: 'evm',
    free_rpc_urls: {
      mainnet: [
        'https://bsc-rpc.publicnode.com',
        'https://bsc.drpc.org',
        'https://binance.llamarpc.com',
        'https://binance-smart-chain-public.nodies.app',
      ],
      testnet: ['https://bsc-testnet.publicnode.com'],
    },
    scan: {
      sandbox: 'https://testnet.bscscan.com',
      production: 'https://bscscan.com',
      txPath: 'tx',
    },
    custom_rpc: {
      label: 'Binance Smart Chain',
      order: 1,
    },
    scan_service: 'etherscan',
    tx_hash_path: 'hash',
    gas_fee_options: true,
    eip_1559_not_supported: true,
    private_key_list: {
      label: 'Binance Smart Chain',
      order: 4,
    },
    address_name_support: true,
    tx_list_limit_100: true,
    moralis: {
      key: 'BSC',
      sandbox: 'BSC_TESTNET',
      production: 'BSC',
    },
    wallet_connect: {
      chain_display_name: 'Binance Smart Chain',
      symbol: 'BNB',
    },
    logo: require('assets/chain_logo/binance_smart_chain.png'),
    add_token: {
      label: 'Binance Smart Chain',
      chain_symbol: 'BNB',
      type: 'token',
      token_type: 'BEP20',
      isEVM: true,
      order: 3,
    },
  },
  polygon: {
    premium: {mainnet: true},
    chain_id: {
      sandbox: 80002,
      production: 137,
    },
    is_evm: true,
    chain_loader: 'evm',
    free_rpc_urls: {
      mainnet: [
        'https://polygon-bor-rpc.publicnode.com',
        'https://polygon.drpc.org',
        'https://polygon-public.nodies.app',
      ],
      testnet: ['https://polygon-amoy-bor-rpc.publicnode.com'],
    },
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
    custom_rpc: {
      label: 'Polygon',
      order: 2,
    },
    scan_service: 'polygon',
    tx_hash_path: 'hash',
    private_key_list: {
      label: 'Polygon',
      order: 25,
    },
    tx_list_limit_100: true,
    moralis: {
      key: 'Polygon',
      sandbox: 'POLYGON_AMOY',
      production: 'POLYGON',
    },
    wallet_connect: {
      chain_display_name: 'Polygon',
      symbol: 'POL',
    },
    logo: require('assets/chain_logo/polygon.png'),
    add_token: {
      label: 'Polygon',
      chain_symbol: 'POL',
      type: 'token',
      token_type: 'ERC20',
      isEVM: true,
      order: 1,
    },
  },
  base: {
    additional_l1_fee_percentage: 30,
    premium: {mainnet: true},
    chain_id: {
      sandbox: 84532,
      production: 8453,
    },
    is_evm: true,
    chain_loader: 'evm',
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
    scan: {
      sandbox: 'https://sepolia.basescan.org',
      production: 'https://basescan.org',
      txPath: 'tx',
    },
    custom_rpc: {
      label: 'Base',
      order: 3,
    },
    scan_service: 'etherscan',
    tx_hash_path: 'hash',
    eip_7702: true,
    gas_oracle: '0x420000000000000000000000000000000000000F',
    private_key_list: {
      label: 'Base',
      order: 3,
    },
    tx_list_limit_100: true,
    moralis: {
      key: 'Base',
      sandbox: 'BASE_SEPOLIA',
      production: 'BASE',
    },
    wallet_connect: {
      chain_display_name: 'Base',
      symbol: 'ETH',
    },
    batch_contract: {
      sandbox: '0x1A26f0b16172784Db9C71a220893fB5EA859e3fb',
      production: '0xC6c4684b0e3D42D94c16cD5Cbeb6618d2202FB9D',
    },
    logo: require('assets/chain_logo/base.png'),
    add_token: {
      label: 'Base',
      chain_symbol: 'ETH',
      type: 'token',
      token_type: 'ERC20',
      isEVM: true,
      order: 2,
    },
  },
  optimism: {
    additional_l1_fee_percentage: 30,
    premium: {mainnet: true},
    chain_id: {
      sandbox: 11155420,
      production: 10,
    },
    is_evm: true,
    chain_loader: 'evm',
    free_rpc_urls: {
      mainnet: [
        'https://optimism-rpc.publicnode.com',
        'https://optimism.drpc.org',
      ],
      testnet: ['https://sepolia.optimism.io'],
    },
    scan: {
      sandbox: 'https://sepolia-optimism.etherscan.io',
      production: 'https://optimistic.etherscan.io/',
      txPath: 'tx',
    },
    custom_rpc: {
      label: 'Optimism',
      order: 5,
    },
    scan_service: 'etherscan',
    tx_hash_path: 'hash',
    eip_7702: true,
    gas_oracle: '0x420000000000000000000000000000000000000F',
    private_key_list: {
      label: 'Optimism',
      order: 22,
    },
    tx_list_limit_100: true,
    moralis: {
      key: 'Optimism',
      sandbox: 'OPTIMISM',
      production: 'OPTIMISM',
    },
    wallet_connect: {
      chain_display_name: 'Optimism',
      symbol: 'ETH',
    },
    batch_contract: {
      production: '0xC6c4684b0e3D42D94c16cD5Cbeb6618d2202FB9D',
    },
    logo: require('assets/chain_logo/optimism.png'),
    add_token: {
      label: 'Optimism',
      chain_symbol: 'ETH',
      type: 'token',
      token_type: 'ERC20',
      isEVM: true,
      order: 7,
    },
  },
  arbitrum: {
    additional_estimate_gas: 100000n,
    premium: {mainnet: true},
    chain_id: {
      sandbox: 421614,
      production: 42161,
    },
    is_evm: true,
    chain_loader: 'evm',
    free_rpc_urls: {
      mainnet: [
        'https://arbitrum-one-rpc.publicnode.com',
        'https://arbitrum.drpc.org',
      ],
      testnet: ['https://sepolia-rollup.arbitrum.io/rpc'],
    },
    scan: {
      sandbox: 'https://sepolia.arbiscan.io/',
      production: 'https://arbiscan.io',
      txPath: 'tx',
    },
    custom_rpc: {
      label: 'Arbitrum',
      order: 4,
    },
    scan_service: 'etherscan',
    tx_hash_path: 'hash',
    eip_7702: true,
    private_key_list: {
      label: 'Arbitrum',
      order: 1,
    },
    tx_list_limit_100: true,
    moralis: {
      key: 'Arbitrum',
      sandbox: 'ARBITRUM_TESTNET',
      production: 'ARBITRUM',
    },
    wallet_connect: {
      chain_display_name: 'Arbitrum',
      symbol: 'ETH',
    },
    batch_contract: {
      production: '0xC6c4684b0e3D42D94c16cD5Cbeb6618d2202FB9D',
    },
    logo: require('assets/chain_logo/arbitrum.png'),
    add_token: {
      label: 'Arbitrum',
      chain_symbol: 'ETH',
      type: 'token',
      token_type: 'ERC20',
      isEVM: true,
      order: 6,
    },
  },
  optimism_binance_smart_chain: {
    additional_l1_fee_percentage: 30,
    premium: {mainnet: true},
    chain_id: {
      sandbox: 5611,
      production: 204,
    },
    is_evm: true,
    chain_loader: 'evm',
    free_rpc_urls: {
      mainnet: ['https://opbnb-rpc.publicnode.com', 'https://opbnb.drpc.org'],
      testnet: [
        'https://opbnb-testnet-rpc.bnbchain.org',
        'https://opbnb-testnet.drpc.org',
      ],
    },
    scan: {
      sandbox: 'https://opbnb-testnet.bscscan.com',
      production: 'https://opbnb.bscscan.com',
      txPath: 'tx',
    },
    custom_rpc: {
      label: 'Optimism Binance Smart Chain',
      order: 6,
    },
    scan_service: 'etherscan',
    tx_hash_path: 'hash',
    gas_oracle: '0x420000000000000000000000000000000000000F',
    private_key_list: {
      label: 'Optimism Binance Smart Chain',
      order: 23,
    },
    tx_list_limit_100: true,
    wallet_connect: {
      chain_display_name: 'Optimism Binance Smart Chain',
      symbol: 'BNB',
    },
    logo: require('assets/chain_logo/optimism_binance_smart_chain.png'),
    add_token: {
      label: 'Optimism Binance Smart Chain',
      chain_symbol: 'BNB',
      type: 'token',
      token_type: 'BEP20',
      isEVM: true,
      order: 8,
    },
  },
  avalanche: {
    premium: {mainnet: true},
    chain_id: {
      sandbox: 43113,
      production: 43114,
    },
    is_evm: true,
    chain_loader: 'evm',
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
    scan: {
      sandbox: 'https://testnet.snowtrace.io',
      production: 'https://snowtrace.io',
      txPath: 'tx',
    },
    custom_rpc: {
      label: 'Avalanche',
      order: 7,
    },
    scan_service: 'etherscan',
    tx_hash_path: 'hash',
    gas_fee_options: true,
    private_key_list: {
      label: 'Avalanche',
      order: 2,
    },
    tx_list_limit_100: true,
    wallet_connect: {
      chain_display_name: 'Avalanche',
      symbol: 'AVAX',
    },
    logo: require('assets/chain_logo/avalanche.png'),
    add_token: {
      label: 'Avalanche',
      chain_symbol: 'AVAX',
      type: 'token',
      token_type: 'ERC20',
      isEVM: true,
      order: 9,
    },
  },
  fantom: {
    chain_id: {
      sandbox: 4002,
      production: 250,
    },
    is_evm: true,
    chain_loader: 'evm',
    free_rpc_urls: {
      mainnet: [
        'https://fantom-rpc.publicnode.com',
        'https://fantom-rpc.publicnode.com',
        'https://fantom.drpc.org',
      ],
      testnet: ['https://fantom-testnet.drpc.org'],
    },
    scan: {
      sandbox: 'https://testnet.ftmscan.com',
      production: 'https://ftmscan.com',
      txPath: 'tx',
    },
    custom_rpc: {
      label: 'Fantom',
      order: 8,
    },
    scan_service: 'etherscan',
    tx_hash_path: 'hash',
    gas_fee_options: true,
    private_key_list: {
      label: 'Fantom',
      order: 14,
    },
    tx_list_limit_100: true,
    wallet_connect: {
      chain_display_name: 'Fantom',
      symbol: 'FTM',
    },
    logo: require('assets/chain_logo/fantom.png'),
    add_token: {
      label: 'Fantom',
      chain_symbol: 'FTM',
      type: 'token',
      token_type: 'ERC20',
      isEVM: true,
      order: 10,
    },
  },
  gnosis: {
    premium: {mainnet: true},
    chain_id: {
      sandbox: 10200,
      production: 100,
    },
    is_evm: true,
    chain_loader: 'evm',
    free_rpc_urls: {
      mainnet: ['https://gnosis-rpc.publicnode.com', 'https://gnosis.drpc.org'],
      testnet: [
        'https://1rpc.io/gnosis',
        'https://gnosis-chiado-rpc.publicnode.com',
        'https://rpc.chiadochain.net',
      ],
    },
    scan: {
      sandbox: 'https://gnosisscan.io/',
      production: 'https://gnosisscan.io/',
      txPath: 'tx',
    },
    custom_rpc: {
      label: 'Gnosis',
      order: 9,
    },
    scan_service: 'etherscan',
    tx_hash_path: 'hash',
    gas_fee_options: true,
    eip_7702: true,
    private_key_list: {
      label: 'Gnosis',
      order: 15,
    },
    tx_list_limit_100: true,
    wallet_connect: {
      chain_display_name: 'Gnosis',
      symbol: 'XDAI',
    },
    batch_contract: {
      production: '0xC6c4684b0e3D42D94c16cD5Cbeb6618d2202FB9D',
    },
    logo: require('assets/chain_logo/gnosis.png'),
    add_token: {
      label: 'Gnosis',
      chain_symbol: 'XDAI',
      type: 'token',
      token_type: 'ERC20',
      isEVM: true,
      order: 11,
    },
  },
  viction: {
    fees_by_rpc: true,
    chain_id: {
      sandbox: 89,
      production: 88,
    },
    is_evm: true,
    chain_loader: 'evm',
    free_rpc_urls: {
      mainnet: ['https://viction.drpc.org'],
      testnet: ['https://rpc-testnet.viction.xyz'],
    },
    scan: {
      sandbox: 'https://testnet.vicscan.xyz',
      production: 'https://vicscan.xyz',
      txPath: 'tx',
    },
    scan_api_url: {
      sandbox: 'https://scan-api-testnet.viction.xyz',
      production: 'https://vicscan.xyz',
    },
    custom_rpc: {
      label: 'Viction',
      order: 10,
    },
    scan_service: 'vicscan',
    tx_hash_path: 'hash',
    private_key_list: {
      label: 'Viction',
      order: 32,
    },
    tx_list_limit_100: true,
    wallet_connect: {
      chain_display_name: 'Viction',
      symbol: 'VIC',
    },
    logo: require('assets/chain_logo/viction.png'),
    add_token: {
      label: 'Viction',
      chain_symbol: 'VIC',
      type: 'token',
      token_type: 'ERC20',
      isEVM: true,
      order: 15,
    },
  },
  zksync: {
    chain_id: {
      sandbox: 300,
      production: 324,
    },
    is_evm: true,
    chain_loader: 'evm',
    free_rpc_urls: {
      mainnet: ['https://zksync.drpc.org', 'https://rpc.ankr.com/zksync_era'],
      testnet: [
        'https://zksync-sepolia.drpc.org',
        'https://endpoints.omniatech.io/v1/zksync-era/sepolia/public',
      ],
    },
    scan: {
      sandbox: 'https://sepolia.explorer.zksync.io',
      production: 'https://explorer.zksync.io',
      txPath: 'tx',
    },
    custom_rpc: {
      label: 'zkSync Era',
      order: 12,
    },
    scan_service: 'etherscan',
    tx_hash_path: 'hash',
    private_key_list: {
      label: 'zkSync Era',
      order: 33,
    },
    tx_list_limit_100: true,
    wallet_connect: {
      chain_display_name: 'zkSync Era',
      symbol: 'ETH',
    },
    logo: require('assets/chain_logo/zksync.png'),
    add_token: {
      label: 'zkSync Era',
      chain_symbol: 'ETH',
      type: 'token',
      token_type: 'ERC20',
      isEVM: true,
      order: 14,
    },
  },
  linea: {
    premium: {mainnet: true},
    chain_id: {
      sandbox: 59141,
      production: 59144,
    },
    is_evm: true,
    chain_loader: 'evm',
    free_rpc_urls: {
      mainnet: ['https://linea-rpc.publicnode.com', 'https://linea.drpc.org'],
      testnet: [
        'https://rpc.sepolia.linea.build',
        'https://linea-sepolia.drpc.org',
      ],
    },
    scan: {
      sandbox: 'https://sepolia.lineascan.build',
      production: 'https://lineascan.build',
      txPath: 'tx',
    },
    custom_rpc: {
      label: 'Linea',
      order: 11,
    },
    scan_service: 'etherscan',
    tx_hash_path: 'hash',
    gas_fee_options: true,
    private_key_list: {
      label: 'Linea',
      order: 20,
    },
    tx_list_limit_100: true,
    wallet_connect: {
      chain_display_name: 'Linea',
      symbol: 'ETH',
    },
    logo: require('assets/chain_logo/linea.png'),
    add_token: {
      label: 'Linea',
      chain_symbol: 'ETH',
      type: 'token',
      token_type: 'ERC20',
      isEVM: true,
      order: 13,
    },
  },
  ethereum_classic: {
    fees_by_rpc: true,
    chain_id: {
      sandbox: 61,
      production: 61,
    },
    is_evm: true,
    chain_loader: 'evm',
    free_rpc_urls: {
      mainnet: ['https://0xrpc.io/etc', 'https://geth-at.etc-network.info'],
      testnet: [
        'https://etc.etcdesktop.com',
        'https://rpc.etcinscribe.com',
        'https://geth-at.etc-network.info',
        'https://etc.rivet.link',
      ],
    },
    scan: {
      sandbox: 'https://etc.blockscout.com',
      production: 'https://etc.blockscout.com',
      txPath: 'tx',
    },
    custom_rpc: {
      label: 'Ethereum Classic',
      order: 13,
    },
    scan_service: 'ethereum_classic',
    tx_hash_path: 'hash',
    eip_1559_not_supported: true,
    private_key_list: {
      label: 'Ethereum Classic',
      order: 12,
    },
    wallet_connect: {
      chain_display_name: 'Ethereum Classic',
      symbol: 'ETC',
    },
    logo: require('assets/chain_logo/ethereum_classic.png'),
    add_token: {
      label: 'Ethereum Classic',
      chain_symbol: 'ETC',
      type: 'token',
      token_type: 'ERC20',
      isEVM: true,
      order: 16,
    },
  },
  ethereum_pow: {
    fees_by_rpc: true,
    scan_only: true,
    chain_id: {
      sandbox: 10001,
      production: 10001,
    },
    is_evm: true,
    chain_loader: 'evm',
    free_rpc_urls: {
      mainnet: ['https://mainnet.ethereumpow.org'],
      testnet: ['https://mainnet.ethereumpow.org'],
    },
    scan: {
      sandbox: 'https://www.oklink.com/ethw',
      production: 'https://www.oklink.com/ethw',
      txPath: 'tx',
    },
    custom_rpc: {
      label: 'EthereumPoW',
      order: 14,
    },
    scan_service: 'ethereum_pow',
    tx_hash_path: 'hash',
    eip_1559_not_supported: true,
    private_key_list: {
      label: 'EthereumPoW',
      order: 13,
    },
    wallet_connect: {
      chain_display_name: 'EthereumPoW',
      symbol: 'ETC',
    },
    logo: require('assets/chain_logo/ethereum_pow.png'),
    add_token: {
      label: 'EthereumPoW',
      chain_symbol: 'ETHW',
      type: 'token',
      token_type: 'ERC20',
      isEVM: true,
      order: 17,
    },
  },
  kava: {
    fees_by_rpc: true,
    chain_id: {
      sandbox: 2221,
      production: 2222,
    },
    is_evm: true,
    chain_loader: 'evm',
    free_rpc_urls: {
      mainnet: ['https://kava-evm-rpc.publicnode.com', 'https://kava.drpc.org'],
      testnet: ['https://kava-testnet.drpc.org', 'https://evm.testnet.kava.io'],
    },
    scan: {
      sandbox: 'https://testnet.kavascan.io/',
      production: 'https://kavascan.com/',
      txPath: 'tx',
    },
    custom_rpc: {
      label: 'Kava',
      order: 15,
    },
    tx_hash_path: 'hash',
    eip_1559_not_supported: true,
    private_key_list: {
      label: 'Kava',
      order: 19,
    },
    tx_list_not_supported: true,
    wallet_connect: {
      chain_display_name: 'Kava',
      symbol: 'KAVA',
    },
    logo: require('assets/chain_logo/kava.png'),
    add_token: {
      label: 'Kava',
      chain_symbol: 'KAVA',
      type: 'token',
      token_type: 'ERC20',
      isEVM: true,
      order: 12,
    },
  },
  ink: {
    fees_by_rpc: true,
    additional_l1_fee_percentage: 30,
    premium: {mainnet: true},
    chain_id: {
      sandbox: 763373,
      production: 57073,
    },
    is_evm: true,
    chain_loader: 'evm',
    free_rpc_urls: {
      mainnet: [
        'https://rpc-qnd.inkonchain.com',
        'https://rpc-gel.inkonchain.com',
      ],
      testnet: ['https://rpc-gel-sepolia.inkonchain.com'],
    },
    scan: {
      sandbox: 'https://explorer-sepolia.inkonchain.com/',
      production: 'https://explorer.inkonchain.com/',
      txPath: 'tx',
    },
    scan_api_url: {
      sandbox: 'https://explorer-sepolia.inkonchain.com',
      production: 'https://explorer.inkonchain.com',
    },
    custom_rpc: {
      label: 'Ink',
      order: 16,
    },
    scan_service: 'ink',
    tx_hash_path: 'hash',
    eip_7702: true,
    gas_oracle: '0x420000000000000000000000000000000000000F',
    private_key_list: {
      label: 'Ink',
      order: 18,
    },
    wallet_connect: {
      chain_display_name: 'Ink',
      symbol: 'ETH',
    },
    batch_contract: {
      production: '0xC6c4684b0e3D42D94c16cD5Cbeb6618d2202FB9D',
    },
    logo: require('assets/chain_logo/ink.png'),
    add_token: {
      label: 'Ink',
      chain_symbol: 'ETH',
      type: 'token',
      token_type: 'ERC20',
      isEVM: true,
      order: 18,
    },
  },
  sei: {
    premium: {mainnet: true},
    chain_id: {
      sandbox: 1328,
      production: 1329,
    },
    is_evm: true,
    chain_loader: 'evm',
    free_rpc_urls: {
      mainnet: ['https://sei.drpc.org'],
      testnet: [
        'https://evm-rpc-testnet.sei-apis.com',
        'https://sei-testnet-public.nodies.app',
      ],
    },
    scan: {
      sandbox: 'https://testnet.seiscan.io',
      production: 'https://seiscan.io',
      txPath: 'tx',
    },
    custom_rpc: {
      label: 'Sei',
      order: 17,
    },
    scan_service: 'etherscan',
    tx_hash_path: 'hash',
    private_key_list: {
      label: 'Sei',
      order: 26,
    },
    tx_list_limit_100: true,
    wallet_connect: {
      chain_display_name: 'Sei',
      symbol: 'SEI',
    },
    logo: require('assets/chain_logo/sei.png'),
    add_token: {
      label: 'SEI',
      chain_symbol: 'SEI',
      type: 'token',
      token_type: 'ERC20',
      isEVM: true,
      order: 19,
    },
  },
  hyperliquid: {
    chain_id: {
      sandbox: 998,
      production: 999,
    },
    is_evm: true,
    chain_loader: 'evm',
    free_rpc_urls: {
      mainnet: [
        'https://rpc.hyperliquid.xyz/evm',
        'https://hyperliquid-json-rpc.stakely.io',
        'https://hyperliquid.drpc.org',
        'https://rpc.hypurrscan.io',
      ],
      testnet: ['https://rpc.hyperliquid-testnet.xyz/evm'],
    },
    scan: {
      sandbox: 'https://hyperevmscan.io/',
      production: 'https://hyperevmscan.io/',
      txPath: 'tx',
    },
    custom_rpc: {
      label: 'Hyperliquid',
      order: 18,
    },
    scan_service: 'etherscan',
    tx_hash_path: 'hash',
    private_key_list: {
      label: 'Hyperliquid',
      order: 17,
    },
    wallet_connect: {
      chain_display_name: 'Hyperliquid',
      symbol: 'HYPE',
    },
    add_token: {
      label: 'Hyperliquid',
      chain_symbol: 'HYPE',
      type: 'token',
      token_type: 'ERC20',
      isEVM: true,
      order: 20,
    },
  },
  robinhood: {
    chain_id: {
      sandbox: 46630,
      production: 4663,
    },
    is_evm: true,
    chain_loader: 'evm',
    premium: {
      mainnet: true,
    },
    free_rpc_urls: {
      mainnet: ['https://rpc.mainnet.chain.robinhood.com'],
      testnet: [
        'https://rpc.testnet.chain.robinhood.com',
        'https://robinhood-testnet.drpc.org',
      ],
    },
    scan: {
      sandbox: 'https://explorer.testnet.chain.robinhood.com',
      production: 'https://robinhoodchain.blockscout.com',
      txPath: 'tx',
    },
    custom_rpc: {
      label: 'Robinhood',
      order: 19,
    },
    scan_service: 'blockscout',
    tx_hash_path: 'hash',
    tx_list_limit_100: true,
    wallet_connect: {
      chain_display_name: 'Robinhood',
      symbol: 'ETH',
    },
    logo: require('assets/chain_logo/robinhood.webp'),
    add_token: {
      label: 'Robinhood',
      chain_symbol: 'ETH',
      type: 'token',
      token_type: 'ERC20',
      isEVM: true,
      order: 21,
    },
  },
  tron: {
    premium: {mainnet: true, testnet: true},
    supported: true,
    chain_loader: 'tron',
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
    scan: {
      sandbox: 'https://nile.tronscan.org/#',
      production: 'https://tronscan.org/#',
      txPath: 'transaction',
    },
    tx_hash_path: 'txid',
    derive_index: 4,
    derivation_paths: [
      {
        label: "Ledger (m/44'/195'/1'/0/0)",
        value: "m/44'/195'/1'/0/0",
      },
    ],
    custom_derivation: {
      Ledger: j => `m/44'/195'/${j}'/0/0`,
    },
    derive_address: true,
    private_key_list: {
      label: 'Tron',
      order: 31,
    },
    staking_keys: ['trx'],
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
    unstaking_button: true,
    vote_button: true,
    memo_support: true,
    wallet_connect: {
      chain_display_name: 'Tron',
      symbol: 'TRX',
    },
    wallet_connect_key: {
      sandbox: 'tron:0xcd8690dc',
      production: 'tron:0x2b6653dc',
    },
    logo: require('assets/chain_logo/tron.png'),
    add_token: {
      label: 'Tron',
      chain_symbol: 'TRX',
      type: 'token',
      token_type: 'TRC20',
      order: 4,
    },
  },
  solana: {
    premium: {mainnet: true},
    supported: true,
    chain_loader: 'solana',
    free_rpc_urls: {
      mainnet: ['https://api.mainnet-beta.solana.com'],
      testnet: ['https://api.devnet.solana.com'],
    },
    scan: {
      sandbox: 'https://solscan.io',
      production: 'https://solscan.io',
      txPath: 'tx',
      sandboxQueryParam: 'cluster=devnet',
    },
    derive_index: 3,
    derivation_paths: [
      {
        label: "Ledger (m/44'/501'/1')",
        value: "m/44'/501'/1'",
      },
    ],
    custom_derivation: {
      Ledger: j => `m/44'/501'/${j}'`,
    },
    derive_address: true,
    private_key_list: {
      label: 'Solana',
      order: 27,
    },
    staking_keys: ['sol'],
    staking_validators_screen: true,
    epoch_time: true,
    memo_support: true,
    moralis: {
      key: 'Solana',
      sandbox: 'DEVNET',
      production: 'MAINNET',
    },
    wallet_connect: {
      chain_display_name: 'Solana',
      symbol: 'SOL',
    },
    wallet_connect_key: {
      sandbox: 'solana:8E9rvCKLFQia2Y35HXjjpWzj8weVo44K',
      production: 'solana:4sGjMW1sUnHzSxGspuhpqLDx6wiyjNtZ',
    },
    stake_wiz_base_url: 'https://api.stakewiz.com',
    rpc_contract_chain_id: {
      sandbox: 103,
      production: 101,
    },
    logo: require('assets/chain_logo/solana.png'),
    add_token: {
      label: 'Solana',
      chain_symbol: 'SOL',
      type: 'token',
      token_type: 'SPL20',
      order: 5,
    },
  },
  bitcoin: {
    fee_multiplier: {normal: 1.4, recommended: 1.65},
    supported: true,
    is_bitcoin: true,
    chain_loader: 'bitcoin',
    scan: {
      sandbox: 'https://mempool.space/testnet',
      production: 'https://mempool.space',
      txPath: 'tx',
    },
    gas_currency: 'sat/B',
    fees_options: true,
    derivation_paths: [
      {
        label: "Ledger (m/84'/0'/1'/0/0)",
        value: "m/84'/0'/1'/0/0",
      },
    ],
    custom_derivation: {
      Ledger: j => `m/84'/0'/${j}'/0/0`,
    },
    derive_address: true,
    private_key_list: {
      label: 'Bitcoin Native Segwit',
      order: 8,
    },
    api_base_url: {
      sandbox: 'https://mempool.space/testnet/api',
      production: 'https://mempool.space/api',
    },
  },
  bitcoin_legacy: {
    supported: true,
    is_bitcoin: true,
    chain_loader: 'bitcoin',
    gas_currency: 'sat/B',
    fees_options: true,
    derivation_paths: [
      {
        label: "Ledger (m/44'/0'/1'/0/0)",
        value: "m/44'/0'/1'/0/0",
      },
    ],
    custom_derivation: {
      Ledger: j => `m/44'/0'/${j}'/0/0`,
    },
    derive_address: true,
    private_key_list: {
      label: 'Bitcoin Legacy',
      order: 6,
    },
  },
  bitcoin_segwit: {
    supported: true,
    is_bitcoin: true,
    chain_loader: 'bitcoin',
    gas_currency: 'sat/B',
    fees_options: true,
    derivation_paths: [
      {
        label: "Ledger (m/49'/0'/1'/0/0)",
        value: "m/49'/0'/1'/0/0",
      },
    ],
    custom_derivation: {
      Ledger: j => `m/49'/0'/${j}'/0/0`,
    },
    derive_address: true,
    private_key_list: {
      label: 'Bitcoin Segwit',
      order: 7,
    },
  },
  bitcoin_lightning: {
    supported: true,
    chain_loader: 'lightning',
    private_key_not_supported: true,
    unclaim_deposit: true,
  },
  litecoin: {
    fee_multiplier: {normal: 1.4, recommended: 1.65},
    supported: true,
    is_litecoin: true,
    chain_loader: 'doge_ltc',
    scan: {
      sandbox: 'https://blockchair.com/litecoin',
      production: 'https://blockchair.com/litecoin',
      txPath: 'transaction',
    },
    gas_currency: 'lit/B',
    fees_options: true,
    private_key_list: {
      label: 'Litecoin',
      order: 21,
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
    fee_multiplier: {normal: 1.4, recommended: 1.65},
    supported: true,
    chain_loader: 'doge_ltc',
    scan: {
      sandbox: 'https://blockchair.com/dogecoin',
      production: 'https://blockchair.com/dogecoin',
      txPath: 'transaction',
    },
    gas_currency: 'sat/B',
    fees_options: true,
    private_key_list: {
      label: 'Dogecoin',
      order: 10,
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
    fee_multiplier: {normal: 1.4, recommended: 1.65},
    supported: true,
    chain_loader: 'doge_ltc',
    scan: {
      sandbox: 'https://blockchair.com/bitcoin-cash',
      production: 'https://blockchair.com/bitcoin-cash',
      txPath: 'transaction',
    },
    gas_currency: 'sat/B',
    fees_options: true,
    private_key_list: {
      label: 'Bitcoin Cash',
      order: 5,
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
    supported: true,
    chain_loader: 'cosmos',
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
    private_key_list: {
      label: 'Cosmos',
      order: 9,
    },
    memo_support: true,
    rest_base_url: 'https://cosmos-rest.publicnode.com',
    logo: require('assets/chain_logo/cosmos.png'),
  },
  polkadot: {
    scan_only: true,
    supported: true,
    chain_loader: 'polkadot',
    rpc_urls: {
      default: {
        mainnet: 'https://dot-rpc.stakeworld.io/assethub',
        testnet: 'https://dot-rpc.stakeworld.io/assethub',
      },
    },
    scan: {
      sandbox: 'https://polkadot.subscan.io',
      production: 'https://polkadot.subscan.io',
      txPath: 'extrinsic',
    },
    private_key_list: {
      label: 'Polkadot',
      order: 24,
    },
  },
  tezos: {
    supported: true,
    chain_loader: 'tezos',
    rpc_urls: {
      default: {
        mainnet: 'https://rpc.tzkt.io/mainnet',
        testnet: 'https://rpc.shadownet.teztnets.com',
      },
    },
    scan: {
      sandbox: 'https://shadownet.tzkt.io',
      production: 'https://tzkt.io',
      txPath: '',
    },
    tx_hash_path: 'opHash',
    private_key_list: {
      label: 'Tezos',
      order: 29,
    },
    api_base_url: {
      sandbox: 'https://api.shadownet.tzkt.io',
      production: 'https://api.tzkt.io',
    },
    logo: require('assets/chain_logo/tezos.png'),
  },
  thorchain: {
    supported: true,
    chain_loader: 'thorchain',
    scan: {
      sandbox: 'https://viewblock.io/thorchain',
      production: 'https://viewblock.io/thorchain',
      txPath: 'tx',
    },
    memo_support: true,
  },
  stellar: {
    supported: true,
    chain_loader: 'stellar',
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
    private_key_list: {
      label: 'Stellar',
      order: 28,
    },
    memo_support: true,
    logo: require('assets/chain_logo/stellar.png'),
  },
  ripple: {
    supported: true,
    chain_loader: 'ripple',
    rpc_urls: {
      default: {
        mainnet: 'wss://xrplcluster.com',
        testnet: 'wss://s.altnet.rippletest.net:51233',
      },
      rest: {
        mainnet: 'https://xrplcluster.com',
        testnet: 'https://testnet.xrpl-labs.com',
      },
    },
    scan: {
      sandbox: 'https://testnet.xrpl.org',
      production: 'https://livenet.xrpl.org',
      txPath: 'transactions',
    },
    tx_hash_path: 'result.hash',
    private_key_not_supported: true,
    memo_support: true,
    logo: require('assets/chain_logo/ripple.png'),
  },
  ton: {
    premium: {mainnet: true, testnet: true},
    supported: true,
    chain_loader: 'ton',
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
    tx_hash_path: 'hash',
    private_key_list: {
      label: 'Ton',
      order: 30,
    },
    memo_support: true,
    logo: require('assets/chain_logo/ton.png'),
  },
  aptos: {
    supported: true,
    chain_loader: 'aptos',
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
    private_key_list: {
      label: 'Aptos',
      order: 0,
    },
    tx_list_not_supported: true,
    logo: require('assets/chain_logo/aptos.png'),
  },
  hedera: {
    supported: true,
    chain_loader: 'hedera',
    scan: {
      sandbox: 'https://hashscan.io/testnet',
      production: 'https://hashscan.io/mainnet',
      txPath: 'transaction',
    },
    tx_hash_path: 'transactionHash',
    private_key_list: {
      label: 'Hedera',
      order: 16,
    },
    memo_support: true,
    custom_address_not_supported: true,
    api_base_url: {
      sandbox: 'https://testnet.mirrornode.hedera.com',
      production: 'https://mainnet.mirrornode.hedera.com',
    },
  },
  cardano: {
    scan_only: true,
    supported: true,
    chain_loader: 'cardano',
    scan: {
      sandbox: 'https://cardanoscan.io',
      production: 'https://cardanoscan.io',
      txPath: 'transaction',
    },
    private_key_not_supported: true,
  },
  filecoin: {
    supported: true,
    chain_loader: 'filecoin',
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
    api_base_url: {
      sandbox: 'https://api-cali.filscan.io/api/v1',
      production: 'https://api-v2.filscan.io/api/v1',
    },
    private_key_list: {
      label: 'Filecoin',
      order: 34,
    },
  },
};
const forEnv = value => (IS_SANDBOX ? value.sandbox : value.production);
const scanBase = chain_name => forEnv(CHAIN_CONFIG[chain_name].scan);

// Non-chain services also routed through the worker scan proxy (chains carry
// their own `scan_only` flag in CHAIN_CONFIG).
export const SCAN_PROXY_SERVICES = [
  'etherscan',
  'blockscout',
  'coinmarketcap',
  'moralis',
  'blockdaemon',
];
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
  BLOCK_CYPHER_BASE_URL: 'https://api.blockcypher.com',
  ETHEREUM_SCAN_BASE_URL: 'https://api.etherscan.io/v2',
  INK_BLOCK_EXPLORER_BASE_URL: forEnv(CHAIN_CONFIG.ink.scan_api_url),

  DOK_WALLET_BASE_URL: process.env.DOK_WALLET_BASE_URL,
  // DOK_WALLET_BASE_URL: 'http://localhost:8787/dashboard',
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
  FILSCAN_API_BASE_URL: forEnv(CHAIN_CONFIG.filecoin.api_base_url),
  TEZOS_SCAN_URL: scanBase('tezos'),
  STAKE_WIZ_BASE_URL: CHAIN_CONFIG.solana.stake_wiz_base_url,
  COSMOS_SCAN_URL: scanBase('cosmos'),
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
          ? {
              sandboxQueryParam: scan.sandboxQueryParam,
            }
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
