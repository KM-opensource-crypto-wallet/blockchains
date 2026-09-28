// Field-level redux-persist transforms shared by both apps.
//
// With one `persistReducer` per slice, a transform is called once per *field*
// of that slice with `key` = the field name (not the slice name, as under
// persistCombineReducers). These transforms therefore switch on the field.
//
// Rules (spec §5.2, slimming §6 Phase 4):
//   auth              blacklist password/loading/error + the in-memory unlock flag
//   wallets  inbound  force isHidden for non-MANUAL relock, strip secrets, then
//                     slim: ≤200 most recent transactions per coin, no `nft`
//                     cache (refetched on demand), WalletConnect `walletData`
//                     reduced to the display fields the session UI reads
//            outbound reset in-flight refresh flags
//   message  inbound  ≤100 most recent messages per conversation (bodies stay
//                     in the encrypted store; never a plaintext cache)
//   schedulePayment   outbound reset isSubmitting / pendingSubmitCount
//   sellCrypto        inbound strip the embedded selectedFromWallet
//   batchTransaction  inbound strip coinInfo secrets
import {createTransform} from 'redux-persist';
import {stripAllWalletsSecrets} from '../wallets/walletSecrets';
import {
  sanitizeBatchTransaction,
  sanitizeSellCrypto,
} from './legacyRootMigration';

// Never persisted: the password (vault replaces it), request flags, and the
// per-session "vault is unlocked" flag.
export const AUTH_PERSIST_BLACKLIST = Object.freeze([
  'password',
  'loading',
  'error',
  'isVaultUnlocked',
]);

// Slimming limits. The full lists stay in memory; a refresh replaces a coin's
// transactions wholesale (service/wallet.service.js `finalTransactions`) and
// message pagination re-fetches older messages, so capping what is persisted
// loses nothing the app cannot recover.
export const WALLET_PERSIST_LIMITS = Object.freeze({
  maxTransactionsPerCoin: 200,
  maxMessagesPerConversation: 100,
});

// Heavy or per-session fields that ride along on the coin objects copied into
// WalletConnect `walletData` at approval time. The session UI reads only
// address / symbol / chain_name / chain_display_name / chain_symbol / name /
// currencyRate / key / namespace, so everything list-shaped can go.
const WALLET_DATA_HEAVY_FIELDS = Object.freeze([
  'transactions',
  'deriveAddresses',
  'UTXOs',
  'staking',
  'stakingInfo',
  'nft',
]);

const isPlainObject = value =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

const timestampOf = tx => {
  const raw = tx?.date ?? tx?.timestamp ?? tx?.timeStamp ?? tx?.blockTimestamp;
  const n = typeof raw === 'string' ? Date.parse(raw) : Number(raw);
  return Number.isFinite(n) ? n : null;
};

/** Most recent `limit` transactions; input order is kept when undated. */
export const recentTransactions = (transactions, limit) => {
  if (!Array.isArray(transactions) || transactions.length <= limit) {
    return transactions;
  }
  const dated = transactions.every(tx => timestampOf(tx) !== null);
  if (!dated) {
    return transactions.slice(0, limit);
  }
  return [...transactions]
    .sort((a, b) => timestampOf(b) - timestampOf(a))
    .slice(0, limit);
};

const omitKeys = (object, keys) => {
  if (!isPlainObject(object)) {
    return object;
  }
  const out = {};
  for (const key of Object.keys(object)) {
    if (!keys.includes(key)) {
      out[key] = object[key];
    }
  }
  return out;
};

const slimWalletData = walletData => {
  if (!isPlainObject(walletData)) {
    return walletData;
  }
  return Object.fromEntries(
    Object.entries(walletData).map(([sessionId, entries]) => [
      sessionId,
      Array.isArray(entries)
        ? entries.map(entry => omitKeys(entry, WALLET_DATA_HEAVY_FIELDS))
        : isPlainObject(entries)
        ? Object.fromEntries(
            Object.entries(entries).map(([k, v]) => [
              k,
              omitKeys(v, WALLET_DATA_HEAVY_FIELDS),
            ]),
          )
        : entries,
    ]),
  );
};

/** Persisted shape of a (already secret-stripped) wallet. Never mutates. */
export const slimWalletForPersist = (
  wallet,
  {maxTransactionsPerCoin = WALLET_PERSIST_LIMITS.maxTransactionsPerCoin} = {},
) => {
  if (!isPlainObject(wallet)) {
    return wallet;
  }
  // The NFT cache is refetched on demand (fetchNft); never persisted.
  const out = omitKeys(wallet, ['nft']);
  if (Array.isArray(wallet.coins)) {
    out.coins = wallet.coins.map(coin =>
      isPlainObject(coin) && Array.isArray(coin.transactions)
        ? {
            ...coin,
            transactions: recentTransactions(
              coin.transactions,
              maxTransactionsPerCoin,
            ),
          }
        : coin,
    );
  }
  if (wallet.walletData !== undefined) {
    out.walletData = slimWalletData(wallet.walletData);
  }
  return out;
};

export const WALLETS_REFRESH_RESET = Object.freeze({
  isRefreshingAllWallets: false,
  refreshingWalletClientId: null,
  refreshCoinsRequestIds: {},
});

const forceRelockHidden = (allWallets, manualRelockOption) =>
  Array.isArray(allWallets)
    ? allWallets.map(wallet =>
        wallet?.hideSettings &&
        wallet.hideSettings.relockOption !== manualRelockOption
          ? {...wallet, hideSettings: {...wallet.hideSettings, isHidden: true}}
          : wallet,
      )
    : allWallets;

/**
 * `manualRelockOption` is RELOCK_OPTIONS.MANUAL from walletsSlice; passed in
 * so this module does not pull the whole slice (and every chain) into tests.
 */
export const createWalletsPersistTransform = ({
  manualRelockOption = 'MANUAL',
  maxTransactionsPerCoin = WALLET_PERSIST_LIMITS.maxTransactionsPerCoin,
} = {}) =>
  createTransform(
    (inbound, key) =>
      key === 'allWallets'
        ? stripAllWalletsSecrets(
            forceRelockHidden(inbound, manualRelockOption),
          ).map(wallet =>
            slimWalletForPersist(wallet, {maxTransactionsPerCoin}),
          )
        : inbound,
    (outbound, key) =>
      Object.prototype.hasOwnProperty.call(WALLETS_REFRESH_RESET, key)
        ? WALLETS_REFRESH_RESET[key]
        : outbound,
  );

// XMTP: `messageData[topic]` is newest-first (the initial fetch is the latest
// page; pagination appends older ones). Keep the newest N per conversation.
export const createMessagePersistTransform = ({
  maxMessagesPerConversation = WALLET_PERSIST_LIMITS.maxMessagesPerConversation,
} = {}) =>
  createTransform(
    (inbound, key) =>
      key === 'messageData' && isPlainObject(inbound)
        ? Object.fromEntries(
            Object.entries(inbound).map(([topic, messages]) => [
              topic,
              Array.isArray(messages)
                ? messages.slice(0, maxMessagesPerConversation)
                : messages,
            ]),
          )
        : inbound,
    outbound => outbound,
  );

export const schedulePaymentPersistTransform = createTransform(
  inbound => inbound,
  (outbound, key) => {
    if (key === 'isSubmitting') {
      return false;
    }
    if (key === 'pendingSubmitCount') {
      return 0;
    }
    return outbound;
  },
);

// One definition of each strip for runtime and migration: the transforms
// delegate to the legacyRootMigration sanitizers field by field.
export const sellCryptoPersistTransform = createTransform(
  (inbound, key) =>
    key === 'requestDetails'
      ? sanitizeSellCrypto({requestDetails: inbound}).requestDetails
      : inbound,
  outbound => outbound,
);

export const batchTransactionPersistTransform = createTransform(
  (inbound, key) =>
    key === 'transactions'
      ? sanitizeBatchTransaction({transactions: inbound}).transactions
      : key === 'filteredData'
      ? sanitizeBatchTransaction({filteredData: inbound}).filteredData
      : inbound,
  outbound => outbound,
);
