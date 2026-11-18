import {
  KNOWN_BAD_CONTRACT_REPAIRS,
  countContractRepairs,
  isStaleBeforeRepair,
  repairScheduledPaymentsContracts,
  repairWalletsContracts,
  repairedContractAddress,
} from './contractRepairs';

const BAD_ETH = '0x1796F4516d6e70bfCC8CEF9d40251F590ff4810b';
const BAD_TRON = 'TRkkfqRArFkoXojnonYmHqdvXQ8gGoJvTo';
const USDT_ETH = '0xdAC17F958D2ee523a2206206994597C13D831ec7';
const USDC_ETH = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48';
const USDT_TRON = 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t';

const token = (chain_name, symbol, contractAddress, extra = {}) => ({
  _id: `${chain_name}-${symbol}`,
  type: 'token',
  chain_name,
  symbol,
  contractAddress,
  transactions: [{hash: 'stale'}],
  ...extra,
});

describe('repairedContractAddress', () => {
  test.each([
    ['ethereum', 'USDT', BAD_ETH, USDT_ETH],
    ['ethereum', 'USDC', BAD_ETH, USDC_ETH],
    ['tron', 'USDT', BAD_TRON, USDT_TRON],
  ])('%s %s maps to the real contract', (chain, symbol, bad, good) => {
    expect(repairedContractAddress(chain, symbol, bad)).toBe(good);
  });

  test('EVM addresses and symbols match case-insensitively', () => {
    expect(
      repairedContractAddress('ethereum', 'usdt', BAD_ETH.toLowerCase()),
    ).toBe(USDT_ETH);
    expect(
      repairedContractAddress(
        'ethereum',
        'USDC',
        ` ${BAD_ETH.toUpperCase().replace('0X', '0x')} `,
      ),
    ).toBe(USDC_ETH);
  });

  test('TRON addresses are case-sensitive', () => {
    expect(
      repairedContractAddress('tron', 'USDT', BAD_TRON.toLowerCase()),
    ).toBeNull();
  });

  test.each([
    ['ethereum', 'DAI', BAD_ETH],
    ['binance_smart_chain', 'USDT', BAD_ETH],
    ['tron', 'USDC', BAD_TRON],
    ['ethereum', 'USDT', USDT_ETH],
    ['ethereum', 'USDT', undefined],
    ['ethereum', undefined, BAD_ETH],
  ])('no repair for %s %s %s', (chain, symbol, address) => {
    expect(repairedContractAddress(chain, symbol, address)).toBeNull();
  });

  test('every repair target is the correct, different contract', () => {
    for (const r of KNOWN_BAD_CONTRACT_REPAIRS) {
      expect(r.good).not.toBe(r.bad);
    }
    expect(Object.isFrozen(KNOWN_BAD_CONTRACT_REPAIRS)).toBe(true);
  });
});

describe('repairWalletsContracts', () => {
  const wallets = () => [
    {
      clientId: 'w1',
      coins: [
        token('ethereum', 'USDT', BAD_ETH),
        token('ethereum', 'USDC', BAD_ETH),
        {_id: 'eth', type: 'coin', chain_name: 'ethereum', symbol: 'ETH'},
        token('ethereum', 'LINK', '0x514910771AF9Ca656af840dff83E8264EcF986CA'),
      ],
    },
    {clientId: 'w2', coins: [token('tron', 'USDT', BAD_TRON)]},
    {clientId: 'w3', coins: [token('tron', 'USDT', USDT_TRON)]},
    {clientId: 'w4'},
  ];

  test('repairs every wallet and clears the stale transactions', () => {
    const all = wallets();
    expect(repairWalletsContracts(all)).toBe(3);
    expect(all[0].coins[0]).toMatchObject({
      contractAddress: USDT_ETH,
      transactions: [],
    });
    expect(all[0].coins[1]).toMatchObject({
      contractAddress: USDC_ETH,
      transactions: [],
    });
    expect(all[1].coins[0]).toMatchObject({
      contractAddress: USDT_TRON,
      transactions: [],
    });
  });

  test('leaves native coins, other tokens and already-correct coins alone', () => {
    const all = wallets();
    repairWalletsContracts(all);
    expect(all[0].coins[2]).toEqual({
      _id: 'eth',
      type: 'coin',
      chain_name: 'ethereum',
      symbol: 'ETH',
    });
    expect(all[0].coins[3].transactions).toEqual([{hash: 'stale'}]);
    expect(all[2].coins[0].transactions).toEqual([{hash: 'stale'}]);
  });

  test('is idempotent and tolerates missing data', () => {
    const all = wallets();
    repairWalletsContracts(all);
    expect(repairWalletsContracts(all)).toBe(0);
    expect(repairWalletsContracts(undefined)).toBe(0);
    expect(repairWalletsContracts([null, {coins: null}])).toBe(0);
  });
});

describe('scheduled payments', () => {
  const payments = () => ({
    w1: [
      {
        id: 'p1',
        chain: 'ethereum',
        asset: {symbol: 'USDT', contractAddress: BAD_ETH},
      },
      {id: 'p2', chain: 'ethereum', asset: {symbol: 'ETH'}},
    ],
    w2: [
      {
        id: 'p3',
        chain: 'tron',
        asset: {symbol: 'USDT', contractAddress: USDT_TRON},
      },
    ],
  });

  test('a scheduled payment follows its coin', () => {
    const all = payments();
    expect(repairScheduledPaymentsContracts(all)).toBe(1);
    expect(all.w1[0].asset.contractAddress).toBe(USDT_ETH);
    expect(all.w1[1].asset).toEqual({symbol: 'ETH'});
    expect(all.w2[0].asset.contractAddress).toBe(USDT_TRON);
    expect(repairScheduledPaymentsContracts(all)).toBe(0);
    expect(repairScheduledPaymentsContracts(undefined)).toBe(0);
  });

  test('countContractRepairs reports what would change, per token', () => {
    const counts = countContractRepairs(
      [
        {
          coins: [
            token('ethereum', 'USDT', BAD_ETH),
            token('ethereum', 'USDC', BAD_ETH),
          ],
        },
        {
          coins: [
            token('ethereum', 'USDT', BAD_ETH),
            token('tron', 'USDT', USDT_TRON),
          ],
        },
      ],
      payments(),
    );
    expect(counts).toEqual({
      coins: {'ethereum/USDT': 2, 'ethereum/USDC': 1},
      coinTotal: 3,
      scheduled: 1,
      total: 4,
    });
    expect(countContractRepairs(undefined, undefined).total).toBe(0);
  });
});

describe('isStaleBeforeRepair', () => {
  const repaired = token('ethereum', 'USDT', USDT_ETH);
  const stale = token('ethereum', 'USDT', BAD_ETH, {balance: '0'});

  test('a pre-repair snapshot of a repaired coin is stale', () => {
    expect(isStaleBeforeRepair(stale, repaired)).toBe(true);
  });

  test.each([
    ['the stored coin is still unrepaired', stale, stale],
    ['the snapshot already has the right contract', repaired, repaired],
    ['there is no stored coin', stale, undefined],
    ['the ids differ', stale, {...repaired, _id: 'other'}],
    [
      'the coin is not affected at all',
      token('ethereum', 'LINK', '0x514910771AF9Ca656af840dff83E8264EcF986CA'),
      token('ethereum', 'LINK', '0x514910771AF9Ca656af840dff83E8264EcF986CA'),
    ],
  ])('not stale when %s', (_, incoming, stored) => {
    expect(isStaleBeforeRepair(incoming, stored)).toBe(false);
  });
});
