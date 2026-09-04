/*
 * Session-proposal logic for WalletConnectRequestModal: which proposed chains
 * this wallet can serve, which coin answers for each, and the namespaces the
 * session is approved with.
 *
 * Every entry in `config.WALLET_CONNECT_SUPPORTED_CHAIN` is one CAIP-2 chain id
 * with a `namespace`; a coin may answer for several ids (Hedera answers for
 * `hedera:<net>` with its `0.0.N` account id and for `eip155:<chain_id>` with
 * its EVM address). Pure functions, unit tested in a node environment.
 */
import {normalizeNamespaces} from '@walletconnect/utils';
import {config} from 'dok-wallet-blockchain-networks/config/config';
import {
  getCustomizePublicAddress,
  isHederaUnactivated,
} from 'dok-wallet-blockchain-networks/helper';

// bip122 has one chain id for every Bitcoin address type, so the type is the
// user's choice in the modal rather than the dApp's.
export const BTC_VARIANT_CHAIN_NAMES = [
  'bitcoin',
  'bitcoin_segwit',
  'bitcoin_legacy',
  'bitcoin_taproot',
];

const unique = items => [...new Set(items)];

const chainsOf = namespaces =>
  Object.values(normalizeNamespaces(namespaces || {})).flatMap(
    namespace => namespace?.chains || [],
  );

export const collectProposalChains = ({
  requiredNamespaces,
  optionalNamespaces,
} = {}) => ({
  requiredChains: unique(chainsOf(requiredNamespaces)),
  optionalChains: unique(chainsOf(optionalNamespaces)),
});

export const getUnsupportedRequiredChains = requiredChains =>
  (requiredChains || []).filter(
    key => !config.WALLET_CONNECT_SUPPORTED_CHAIN[key],
  );

const findCoinForChain = (entry, allCoins, bitcoinAddressType) => {
  if (entry.chain_name === 'bitcoin') {
    const variants = allCoins.filter(
      coin =>
        coin.symbol === 'BTC' &&
        BTC_VARIANT_CHAIN_NAMES.includes(coin.chain_name),
    );
    return (
      variants.find(coin => coin.chain_name === bitcoinAddressType) ||
      variants[0]
    );
  }
  return allCoins.find(
    coin =>
      coin.symbol === entry.symbol && coin.chain_name === entry.chain_name,
  );
};

/**
 * One entry per proposed chain id the wallet supports and has a coin for:
 * the WalletConnect entry merged with the coin (address, accountId,
 * privateKey, …). `key`, `namespace` and `chain_display_name` always come from
 * the WalletConnect entry so two ids on one coin stay distinguishable.
 */
export const resolveSessionChainData = ({
  requiredChains = [],
  optionalChains = [],
  allCoins = [],
  bitcoinAddressType,
}) =>
  unique([...requiredChains, ...optionalChains]).flatMap(key => {
    const entry = config.WALLET_CONNECT_SUPPORTED_CHAIN[key];
    if (!entry) {
      return [];
    }
    const coin = findCoinForChain(entry, allCoins, bitcoinAddressType);
    if (!coin) {
      return [];
    }
    return [
      {
        ...entry,
        ...coin,
        key,
        namespace: entry.namespace,
        chain_display_name: entry.chain_display_name,
      },
    ];
  });

/**
 * The account string a namespace expects: Hedera dApps address accounts as
 * `hedera:<net>:0.0.N`, everything else (including Hedera's eip155 relay) as
 * the coin address.
 */
export const getSessionAccountAddress = entry =>
  entry?.namespace === 'hedera'
    ? entry?.accountId
    : getCustomizePublicAddress(entry?.address);

const isUnservable = entry =>
  entry.namespace === 'hedera' && isHederaUnactivated(entry);

/**
 * Chain data as stored per session (walletData) and used for accounts: the
 * `address` field carries the namespace's account form, and native Hedera
 * entries without a ledger account yet are left out.
 */
export const toSessionAccountsData = chainData =>
  (chainData || [])
    .filter(entry => !isUnservable(entry))
    .map(entry => ({...entry, address: getSessionAccountAddress(entry)}));

const chainOfAccount = account => account.split(':').slice(0, 2).join(':');

/**
 * Approved namespaces: for each proposed namespace the chains and accounts of
 * every required + optional chain we serve, and the union of methods and
 * events — the same shape Reown's buildApprovedNamespaces produces. `chains`
 * is not optional in practice: AppKit's WalletConnect connector reads
 * `session.namespaces.eip155.chains` to pick the active chain after approval
 * and falls back to eip155:1 without it. Namespaces with no account are
 * omitted; required chains without an account are returned in
 * `missingRequired` so the caller can reject the proposal.
 */
export const buildSessionNamespaces = ({
  requiredNamespaces,
  optionalNamespaces,
  sessionChainData = [],
}) => {
  const required = normalizeNamespaces(requiredNamespaces || {});
  const optional = normalizeNamespaces(optionalNamespaces || {});
  const namespaces = {};
  const missingRequired = [];
  const accountFor = chain => {
    const found = sessionChainData.find(entry => entry.key === chain);
    return found?.address ? `${chain}:${found.address}` : null;
  };

  unique([...Object.keys(required), ...Object.keys(optional)]).forEach(
    namespace => {
      const requiredChains = required[namespace]?.chains || [];
      const optionalChains = optional[namespace]?.chains || [];
      requiredChains.forEach(chain => {
        if (!accountFor(chain)) {
          missingRequired.push(chain);
        }
      });
      const accounts = unique(
        [...requiredChains, ...optionalChains].map(accountFor).filter(Boolean),
      );
      if (!accounts.length) {
        return;
      }
      namespaces[namespace] = {
        chains: unique(accounts.map(chainOfAccount)),
        accounts,
        methods: unique([
          ...(required[namespace]?.methods || []),
          ...(optional[namespace]?.methods || []),
        ]),
        events: unique([
          ...(required[namespace]?.events || []),
          ...(optional[namespace]?.events || []),
        ]),
      };
    },
  );

  return {namespaces, missingRequired};
};
