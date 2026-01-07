import {fetchRpcUrls} from 'dok-wallet-blockchain-networks/service/dokApi';
import {isValidObject} from 'dok-wallet-blockchain-networks/helper';
import {IS_SANDBOX} from 'dok-wallet-blockchain-networks/config/config';
import {compareAndSortRpcUrls} from 'dok-wallet-blockchain-networks/service/rpcService';
import dayjs from 'dayjs';

const allRPCUrl = {
  solana: {
    mainnet: 'https://api.mainnet-beta.solana.com',
    testnet: 'https://api.devnet.solana.com',
  },
  solana_wc: {
    mainnet: `wss://solana-mainnet.g.alchemy.com/v2/${process.env.SOLANA_RPC_KEY}`,
    testnet: 'ws://api.devnet.solana.com',
  },
  tx_solana: {
    mainnet: 'https://api.mainnet-beta.solana.com',
    testnet: 'https://api.devnet.solana.com',
  },
  ripple: {
    mainnet: 'wss://xrplcluster.com',
    testnet: 'wss://s.altnet.rippletest.net:51233',
  },
  tezos: {
    mainnet: 'https://mainnet.tezos.ecadinfra.com',
    testnet: 'https://ghostnet.ecadinfra.com',
  },
  stellar: {
    mainnet: 'https://horizon.stellar.org',
    testnet: 'https://horizon-testnet.stellar.org',
  },
  tron_solidity_node: {
    mainnet: 'https://api.trongrid.io',
    testnet: 'https://nile.trongrid.io',
  },
  tron_event_server: {
    mainnet: 'https://api.trongrid.io',
    testnet: 'https://nile.trongrid.io',
  },
  tron_full_host: {
    mainnet: 'https://api.trongrid.io',
    testnet: 'https://nile.trongrid.io',
  },
  tron_api_key: {
    mainnet: process.env.TRON_API_KEY_1,
    testnet: process.env.TRON_API_KEY_1,
  },
  tron_api_key_2: {
    mainnet: process.env.TRON_API_KEY_2,
    testnet: process.env.TRON_API_KEY_2,
  },
  cosmos: {
    mainnet: 'https://cosmos-rpc.publicnode.com:443',
    testnet: 'https://cosmos-rpc.publicnode.com:443',
  },
  polkadot: {
    mainnet: 'https://dot-rpc.stakeworld.io/assethub',
    testnet: 'https://dot-rpc.stakeworld.io/assethub',
  },
  ton: {
    mainnet: 'https://toncenter.com/api/v2/jsonRPC',
    testnet: 'https://testnet.toncenter.com/api/v2/jsonRPC',
  },
  ton_api_key: {
    mainnet: process.env.TON_SCAN_API_KEY,
    testnet: process.env.TON_SCAN_API_KEY,
  },
  polygon_blockscout: {
    mainnet: true,
    testnet: true,
  },
};

const allFreeRpcUrl = {
  ethereum: {
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
  arbitrum: {
    mainnet: [
      'https://arbitrum-one-rpc.publicnode.com',
      'https://arbitrum.drpc.org',
    ],
    testnet: ['https://sepolia-rollup.arbitrum.io/rpc'],
  },
  base: {
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
  optimism: {
    mainnet: [
      'https://optimism-rpc.publicnode.com',
      'https://optimism.drpc.org',
    ],
    testnet: ['https://sepolia.optimism.io'],
  },
  polygon: {
    mainnet: [
      'https://polygon-bor-rpc.publicnode.com',
      'https://polygon.drpc.org',
      'https://polygon-public.nodies.app',
    ],
    testnet: ['https://polygon-amoy-bor-rpc.publicnode.com'],
  },
  binance_smart_chain: {
    mainnet: [
      'https://bsc-rpc.publicnode.com',
      'https://bsc.drpc.org',
      'https://binance.llamarpc.com',
      'https://binance-smart-chain-public.nodies.app',
    ],
    testnet: ['https://bsc-testnet.publicnode.com'],
  },
  optimism_binance_smart_chain: {
    mainnet: ['https://opbnb-rpc.publicnode.com', 'https://opbnb.drpc.org'],
    testnet: [
      'https://opbnb-testnet-rpc.bnbchain.org',
      'https://opbnb-testnet.nodereal.io/v1/e9a36765eb8a40b9bd12e680a1fd2bc5',
      'https://opbnb-testnet.nodereal.io/v1/64a9df0874fb4a93b9d0a3849de012d3',
    ],
  },
  avalanche: {
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
  fantom: {
    mainnet: [
      'https://fantom-rpc.publicnode.com',
      'https://fantom-rpc.publicnode.com',
      'https://fantom.drpc.org',
    ],
    testnet: ['https://fantom-testnet.drpc.org'],
  },
  gnosis: {
    mainnet: ['https://gnosis-rpc.publicnode.com', 'https://gnosis.drpc.org'],
    testnet: [
      'https://1rpc.io/gnosis',
      'https://gnosis-chiado-rpc.publicnode.com',
      'https://rpc.chiadochain.net',
    ],
  },
  viction: {
    mainnet: ['https://viction.drpc.org'],
    testnet: ['https://rpc-testnet.viction.xyz'],
  },
  linea: {
    mainnet: ['https://linea-rpc.publicnode.com', 'https://linea.drpc.org'],
    testnet: [
      'https://rpc.sepolia.linea.build',
      'https://linea-sepolia.infura.io/v3/9aa3d95b3bc440fa88ea12eaa4456161',
    ],
  },
  zksync: {
    mainnet: ['https://zksync.drpc.org', 'https://rpc.ankr.com/zksync_era'],
    testnet: [
      'https://zksync-sepolia.drpc.org',
      'https://endpoints.omniatech.io/v1/zksync-era/sepolia/public',
    ],
  },
  ethereum_classic: {
    mainnet: ['https://0xrpc.io/etc', 'https://geth-at.etc-network.info'],
    testnet: [
      'https://etc.etcdesktop.com',
      'https://rpc.etcinscribe.com',
      'https://geth-at.etc-network.info',
      'https://etc.rivet.link',
    ],
  },
  ethereum_pow: {
    mainnet: ['https://mainnet.ethereumpow.org'],
    testnet: ['https://mainnet.ethereumpow.org'],
  },
  kava: {
    mainnet: ['https://kava-evm-rpc.publicnode.com', 'https://kava.drpc.org'],
    testnet: ['https://kava-testnet.drpc.org', 'https://evm.testnet.kava.io'],
  },
  ink: {
    mainnet: [
      'https://rpc-qnd.inkonchain.com',
      'https://rpc-gel.inkonchain.com',
    ],
    testnet: ['https://rpc-gel-sepolia.inkonchain.com'],
  },
  sei: {
    mainnet: ['https://sei.drpc.org'],
    testnet: [
      'https://evm-rpc-testnet.sei-apis.com',
      'https://sei-testnet-public.nodies.app',
    ],
  },
  solana: {
    mainnet: [
      'https://solana-mainnet.g.alchemy.com/v2/LqXKA4ZLdyCbWyPwtLqri3696CgruA0w',
      'https://proud-quaint-patina.solana-mainnet.quiknode.pro/7955f2808766bd176ed1fe12d66abd88b33059dd',
      'https://api.mainnet-beta.solana.com',
    ],
    testnet: ['https://api.devnet.solana.com'],
  },
  tx_solana: {
    mainnet: [
      'https://solana-mainnet.g.alchemy.com/v2/LqXKA4ZLdyCbWyPwtLqri3696CgruA0w',
      'https://api.mainnet-beta.solana.com',
      'https://proud-quaint-patina.solana-mainnet.quiknode.pro/7955f2808766bd176ed1fe12d66abd88b33059dd',
    ],
    testnet: ['https://api.devnet.solana.com'],
  },
  filecoin: {
    mainnet: [
      'https://api.node.glif.io/rpc/v0',
      'https://filecoin.chainup.net/rpc/v1',
    ],
    testnet: [
      'https://api.calibration.node.glif.io/rpc/v0',
      'https://filecoin-calibration.chainup.net/rpc/v1',
    ],
  },
};

let rpcUrls = {
  url: Object.assign(
    {},
    ...Object.keys(allRPCUrl).map(key => ({
      [key]: allRPCUrl[key][IS_SANDBOX ? 'testnet' : 'mainnet'],
    })),
  ),
  free_url: Object.assign(
    {},
    ...Object.keys(allFreeRpcUrl).map(key => ({
      [key]: allFreeRpcUrl[key][IS_SANDBOX ? 'testnet' : 'mainnet'],
    })),
  ),
};

export const fetchRPCUrl = async () => {
  try {
    const resp = await fetchRpcUrls();
    const data = isValidObject(resp?.data) ? resp?.data : {};
    const freeUrl = isValidObject(data?.free_url) ? data?.free_url : {};
    const url = isValidObject(data?.url) ? data?.url : {};
    rpcUrls = {
      url: {
        ...rpcUrls.url,
        ...url,
      },
      free_url: {
        ...rpcUrls.free_url,
        ...freeUrl,
      },
    };
  } catch (e) {
    console.error('Error in fetchRPCUrl', e);
  }
};

let lastCallTimeStamp;
export const compareRpcUrls = async () => {
  try {
    if (
      lastCallTimeStamp &&
      dayjs().diff(dayjs(lastCallTimeStamp), 'minutes') < 9
    ) {
      throw new Error('last call made with 10 minutes');
    }
    lastCallTimeStamp = new Date();
    const freeUrl = isValidObject(rpcUrls?.free_url) ? rpcUrls?.free_url : {};
    const resp = await compareAndSortRpcUrls(freeUrl);
    const data = isValidObject(resp) ? resp : {};
    rpcUrls = {
      ...rpcUrls,
      free_url: {
        ...rpcUrls.free_url,
        ...data,
      },
    };
  } catch (e) {
    console.error('Error in compare RPC urls', e);
  }
};

export const getRPCUrl = chain_name => {
  const allRpcUrls = rpcUrls?.url;
  return allRpcUrls[chain_name] ?? '';
};

export const getFreeRPCUrl = chain_name => {
  const freeUrl = rpcUrls?.free_url;
  const currentFreeUrls = freeUrl[chain_name];
  return Array.isArray(currentFreeUrls) && currentFreeUrls?.length
    ? currentFreeUrls
    : [rpcUrls?.url[chain_name]];
};
