// Contract addresses written into the DOK coin catalog by the 30 Oct 2026
// admin-API attack. Every wallet that created, imported or added these coins
// before the catalog was restored on 18 Nov 2026 stored the attacker's
// addresses in its coins (balance 0, sends to a non-token address).
//
// This pinned list is the only thing the repair trusts. It is deliberately not
// read from the server catalog: re-syncing stored contracts from the catalog
// would let a future catalog tampering rewrite every existing wallet.
export const KNOWN_BAD_CONTRACT_REPAIRS = Object.freeze([
  Object.freeze({
    chain_name: 'ethereum',
    symbol: 'USDT',
    bad: '0x1796F4516d6e70bfCC8CEF9d40251F590ff4810b',
    good: '0xdAC17F958D2ee523a2206206994597C13D831ec7',
  }),
  Object.freeze({
    chain_name: 'ethereum',
    symbol: 'USDC',
    bad: '0x1796F4516d6e70bfCC8CEF9d40251F590ff4810b',
    good: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
  }),
  Object.freeze({
    chain_name: 'tron',
    symbol: 'USDT',
    bad: 'TRkkfqRArFkoXojnonYmHqdvXQ8gGoJvTo',
    good: 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t',
  }),
]);

// TRON (base58) addresses are case-sensitive; EVM hex addresses are not.
const normalizeAddress = (chain_name, address) => {
  if (typeof address !== 'string') {
    return '';
  }
  const trimmed = address.trim();
  return chain_name === 'tron' ? trimmed : trimmed.toLowerCase();
};

// The correct contract for a coin that stored a known bad one, else null.
// Symbol is part of the match: one bad address was used for both USDT and USDC.
export const repairedContractAddress = (
  chain_name,
  symbol,
  contractAddress,
) => {
  const address = normalizeAddress(chain_name, contractAddress);
  if (!address || typeof symbol !== 'string') {
    return null;
  }
  const upperSymbol = symbol.trim().toUpperCase();
  const hit = KNOWN_BAD_CONTRACT_REPAIRS.find(
    item =>
      item.chain_name === chain_name &&
      item.symbol === upperSymbol &&
      normalizeAddress(chain_name, item.bad) === address,
  );
  return hit ? hit.good : null;
};

const coinRepair = coin =>
  coin?.type === 'token'
    ? repairedContractAddress(
        coin?.chain_name,
        coin?.symbol,
        coin?.contractAddress,
      )
    : null;

// True when `incoming` (a refresh result) was built from the coin before it
// was repaired: it still carries a known-bad contract while the stored coin
// with the same id no longer does. The refresh reducers then keep the stored
// coin; every other result is applied as before.
export const isStaleBeforeRepair = (incoming, stored) =>
  !!stored &&
  stored?._id === incoming?._id &&
  !!coinRepair(incoming) &&
  !coinRepair(stored);

const paymentRepair = payment =>
  repairedContractAddress(
    payment?.chain,
    payment?.asset?.symbol,
    payment?.asset?.contractAddress,
  );

const countKey = (chain_name, symbol) =>
  `${chain_name}/${String(symbol).toUpperCase()}`;

// What the repair would change, without changing anything: per "chain/SYMBOL"
// coin counts plus the number of scheduled payments. Used to log the repair.
export const countContractRepairs = (allWallets, scheduledPayments) => {
  const coins = {};
  let coinTotal = 0;
  (Array.isArray(allWallets) ? allWallets : []).forEach(wallet => {
    (Array.isArray(wallet?.coins) ? wallet.coins : []).forEach(coin => {
      if (coinRepair(coin)) {
        const key = countKey(coin.chain_name, coin.symbol);
        coins[key] = (coins[key] || 0) + 1;
        coinTotal += 1;
      }
    });
  });
  let scheduled = 0;
  Object.values(scheduledPayments || {}).forEach(list => {
    (Array.isArray(list) ? list : []).forEach(payment => {
      if (paymentRepair(payment)) {
        scheduled += 1;
      }
    });
  });
  return {coins, coinTotal, scheduled, total: coinTotal + scheduled};
};

// Reducer body for wallets.allWallets (works on an Immer draft or a plain
// array). Fixes the contract and drops the coin's cached transactions, which
// were read with the wrong contract, so the next refresh fetches them again.
// Idempotent: a repaired coin no longer matches.
export const repairWalletsContracts = allWallets => {
  let repaired = 0;
  (Array.isArray(allWallets) ? allWallets : []).forEach(wallet => {
    (Array.isArray(wallet?.coins) ? wallet.coins : []).forEach(coin => {
      const good = coinRepair(coin);
      if (good) {
        coin.contractAddress = good;
        coin.transactions = [];
        repaired += 1;
      }
    });
  });
  return repaired;
};

// Reducer body for schedulePayment.scheduledPayments ({clientId: payment[]}).
// Scheduled payments find their coin by chain|symbol|contractAddress, so they
// must follow the coin's repair or they lose their coin.
export const repairScheduledPaymentsContracts = scheduledPayments => {
  let repaired = 0;
  Object.values(scheduledPayments || {}).forEach(list => {
    (Array.isArray(list) ? list : []).forEach(payment => {
      const good = paymentRepair(payment);
      if (good) {
        payment.asset.contractAddress = good;
        repaired += 1;
      }
    });
  });
  return repaired;
};
