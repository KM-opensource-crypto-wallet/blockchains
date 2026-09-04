/**
 * Session-proposal logic shared by WalletConnectRequestModal. Runner: node-env
 * jest config (config.js requires image assets).
 */
import {
  buildSessionNamespaces,
  collectProposalChains,
  getUnsupportedRequiredChains,
  resolveSessionChainData,
  toSessionAccountsData,
} from 'dok-wallet-blockchain-networks/helper/walletConnectSession';
import {
  CHAIN_ID,
  IS_SANDBOX,
} from 'dok-wallet-blockchain-networks/config/config';

// helper/index.js drags in react-native through utils/common.
jest.mock('dok-wallet-blockchain-networks/helper', () => ({
  // Mirrors helper/index.js: strings of 23 chars or fewer pass through,
  // longer ones are shortened to `${first 10}...${last 10}`.
  getCustomizePublicAddress: str => {
    if (!str) {
      return '';
    }
    return str.length <= 23
      ? str
      : `${str.substring(0, 10)}...${str.substring(str.length - 10)}`;
  },
  isHederaUnactivated: coin =>
    coin?.chain_name === 'hedera' && !coin?.accountId,
}));

const HEDERA_KEY = IS_SANDBOX ? 'hedera:testnet' : 'hedera:mainnet';
const HEDERA_EVM_KEY = `eip155:${CHAIN_ID.hedera}`;
const ETH_KEY = `eip155:${CHAIN_ID.ethereum}`;

const hederaCoin = {
  chain_name: 'hedera',
  symbol: 'HBAR',
  type: 'coin',
  address: '0xabc',
  accountId: '0.0.77',
  privateKey: 'pk-hedera',
};
const ethCoin = {
  chain_name: 'ethereum',
  symbol: 'ETH',
  type: 'coin',
  address: '0xabc',
  privateKey: 'pk-eth',
};
const btcCoins = [
  {chain_name: 'bitcoin', symbol: 'BTC', type: 'coin', address: 'bc1q...'},
  {
    chain_name: 'bitcoin_taproot',
    symbol: 'BTC',
    type: 'coin',
    address: 'bc1p...',
  },
];
const allCoins = [hederaCoin, ethCoin, ...btcCoins];

const dualProposal = {
  requiredNamespaces: {},
  optionalNamespaces: {
    hedera: {
      chains: [HEDERA_KEY],
      methods: ['hedera_signMessage', 'hedera_signAndExecuteTransaction'],
      events: ['chainChanged', 'accountsChanged'],
    },
    eip155: {
      chains: [HEDERA_EVM_KEY, ETH_KEY],
      methods: ['personal_sign', 'eth_sendTransaction'],
      events: ['chainChanged'],
    },
  },
};

describe('collectProposalChains', () => {
  it('flattens required and optional chains, folding chain-keyed namespaces', () => {
    const {requiredChains, optionalChains} = collectProposalChains({
      requiredNamespaces: {[ETH_KEY]: {methods: ['eth_sign'], events: []}},
      optionalNamespaces: dualProposal.optionalNamespaces,
    });
    expect(requiredChains).toEqual([ETH_KEY]);
    expect(optionalChains).toEqual([HEDERA_KEY, HEDERA_EVM_KEY, ETH_KEY]);
  });

  it('tolerates missing namespaces', () => {
    expect(collectProposalChains({})).toEqual({
      requiredChains: [],
      optionalChains: [],
    });
  });
});

describe('getUnsupportedRequiredChains', () => {
  it('lists required chain ids this build cannot serve', () => {
    const other = IS_SANDBOX ? 'hedera:mainnet' : 'hedera:testnet';
    expect(
      getUnsupportedRequiredChains([HEDERA_KEY, other, 'cosmos:x']),
    ).toEqual([other, 'cosmos:x']);
  });
});

describe('resolveSessionChainData', () => {
  it('yields one entry per chain id, so both Hedera ids map to the one Hedera coin', () => {
    const {requiredChains, optionalChains} =
      collectProposalChains(dualProposal);
    const chainData = resolveSessionChainData({
      requiredChains,
      optionalChains,
      allCoins,
      bitcoinAddressType: 'bitcoin',
    });

    expect(chainData.map(item => item.key)).toEqual([
      HEDERA_KEY,
      HEDERA_EVM_KEY,
      ETH_KEY,
    ]);
    const [native, evm, eth] = chainData;
    expect(native).toMatchObject({
      key: HEDERA_KEY,
      namespace: 'hedera',
      chain_name: 'hedera',
      chain_display_name: 'Hedera',
      address: '0xabc',
      accountId: '0.0.77',
      privateKey: 'pk-hedera',
    });
    expect(evm).toMatchObject({
      key: HEDERA_EVM_KEY,
      namespace: 'eip155',
      chain_name: 'hedera',
      chain_display_name: 'Hedera EVM',
      address: '0xabc',
      privateKey: 'pk-hedera',
    });
    expect(eth).toMatchObject({
      key: ETH_KEY,
      namespace: 'eip155',
      chain_name: 'ethereum',
      privateKey: 'pk-eth',
    });
  });

  it('drops chains the wallet has no coin for and unsupported chain ids', () => {
    const chainData = resolveSessionChainData({
      requiredChains: ['cosmos:cosmoshub-4'],
      optionalChains: [`eip155:${CHAIN_ID.polygon}`],
      allCoins,
      bitcoinAddressType: 'bitcoin',
    });
    expect(chainData).toEqual([]);
  });

  it('picks the chosen Bitcoin address type for the single bip122 chain id', () => {
    const btcKey = Object.keys(
      require('dok-wallet-blockchain-networks/config/config').config
        .WALLET_CONNECT_SUPPORTED_CHAIN,
    ).find(key => key.startsWith('bip122:'));
    const [entry] = resolveSessionChainData({
      requiredChains: [btcKey],
      optionalChains: [],
      allCoins,
      bitcoinAddressType: 'bitcoin_taproot',
    });
    expect(entry).toMatchObject({key: btcKey, chain_name: 'bitcoin_taproot'});
  });
});

describe('toSessionAccountsData', () => {
  const chainData = () =>
    resolveSessionChainData({
      ...collectProposalChains(dualProposal),
      allCoins,
      bitcoinAddressType: 'bitcoin',
    });

  it('publishes 0.0.N on the hedera namespace and 0x on eip155 for the same coin', () => {
    const accounts = toSessionAccountsData(chainData());
    expect(accounts.find(i => i.key === HEDERA_KEY).address).toBe('0.0.77');
    expect(accounts.find(i => i.key === HEDERA_EVM_KEY).address).toBe('0xabc');
    expect(accounts.find(i => i.key === ETH_KEY).address).toBe('0xabc');
  });

  it('drops only the native Hedera entry when the account is not yet created', () => {
    const unactivated = allCoins.map(coin =>
      coin.chain_name === 'hedera' ? {...coin, accountId: undefined} : coin,
    );
    const accounts = toSessionAccountsData(
      resolveSessionChainData({
        ...collectProposalChains(dualProposal),
        allCoins: unactivated,
        bitcoinAddressType: 'bitcoin',
      }),
    );
    expect(accounts.map(i => i.key)).toEqual([HEDERA_EVM_KEY, ETH_KEY]);
  });
});

describe('buildSessionNamespaces', () => {
  it('builds CAIP-10 accounts per namespace with the union of methods and events', () => {
    const sessionChainData = toSessionAccountsData(
      resolveSessionChainData({
        ...collectProposalChains(dualProposal),
        allCoins,
        bitcoinAddressType: 'bitcoin',
      }),
    );
    const {namespaces, missingRequired} = buildSessionNamespaces({
      ...dualProposal,
      sessionChainData,
    });

    expect(missingRequired).toEqual([]);
    // `chains` is what Reown AppKit reads to pick the active chain after
    // approval; without it wagmi lands on eip155:1.
    expect(namespaces).toEqual({
      hedera: {
        chains: [HEDERA_KEY],
        accounts: [`${HEDERA_KEY}:0.0.77`],
        methods: ['hedera_signMessage', 'hedera_signAndExecuteTransaction'],
        events: ['chainChanged', 'accountsChanged'],
      },
      eip155: {
        chains: [HEDERA_EVM_KEY, ETH_KEY],
        accounts: [`${HEDERA_EVM_KEY}:0xabc`, `${ETH_KEY}:0xabc`],
        methods: ['personal_sign', 'eth_sendTransaction'],
        events: ['chainChanged'],
      },
    });
  });

  it('omits an optional namespace that ends up with no accounts', () => {
    const {namespaces} = buildSessionNamespaces({
      ...dualProposal,
      sessionChainData: [{key: ETH_KEY, address: '0xabc'}],
    });
    expect(namespaces.hedera).toBeUndefined();
    expect(namespaces.eip155.accounts).toEqual([`${ETH_KEY}:0xabc`]);
    expect(namespaces.eip155.chains).toEqual([ETH_KEY]);
  });

  it('reports required chains that have no account instead of approving an empty namespace', () => {
    const {namespaces, missingRequired} = buildSessionNamespaces({
      requiredNamespaces: {
        hedera: {
          chains: [HEDERA_KEY],
          methods: ['hedera_signMessage'],
          events: [],
        },
      },
      optionalNamespaces: {},
      sessionChainData: [],
    });
    expect(missingRequired).toEqual([HEDERA_KEY]);
    expect(namespaces).toEqual({});
  });

  it('merges required and optional definitions of the same namespace', () => {
    const {namespaces} = buildSessionNamespaces({
      requiredNamespaces: {
        eip155: {
          chains: [ETH_KEY],
          methods: ['personal_sign'],
          events: ['chainChanged'],
        },
      },
      optionalNamespaces: {
        eip155: {
          chains: [ETH_KEY, HEDERA_EVM_KEY],
          methods: ['personal_sign', 'eth_signTypedData_v4'],
          events: ['accountsChanged'],
        },
      },
      sessionChainData: [
        {key: ETH_KEY, address: '0xabc'},
        {key: HEDERA_EVM_KEY, address: '0xabc'},
      ],
    });
    expect(namespaces.eip155).toEqual({
      chains: [ETH_KEY, HEDERA_EVM_KEY],
      accounts: [`${ETH_KEY}:0xabc`, `${HEDERA_EVM_KEY}:0xabc`],
      methods: ['personal_sign', 'eth_signTypedData_v4'],
      events: ['chainChanged', 'accountsChanged'],
    });
  });
});
