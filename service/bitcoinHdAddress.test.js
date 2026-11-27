import {
  buildLegacyWindowPaths,
  deriveAddressRange,
  ensureStandardAddresses,
  getAccountBasePath,
  getDeriveAddressLabel,
  getLegacyWindowItems,
  getNetworkByChainName,
  getVisibleDeriveAddresses,
  hasLegacyScheme,
  isLegacyWindowPath,
  removeLegacyWindowItems,
  shouldPruneLegacyWindow,
} from 'dok-wallet-blockchain-networks/service/bitcoinHdAddress';
import {BitcoinChain} from 'dok-wallet-blockchain-networks/cryptoChain/chains/BitcoinChain';
import {
  fetchBitcoinAddressUsage,
  fetchBitcoinBalances,
  isAddressUsageScanAvailable,
} from 'dok-wallet-blockchain-networks/service/bitcoinDataSource';

jest.mock('dok-wallet-blockchain-networks/config/config', () => ({
  IS_SANDBOX: false,
  config: {},
}));

jest.mock('dok-wallet-blockchain-networks/helper', () => ({
  convertToSmallAmount: jest.fn(),
  getExplorerTxUrl: jest.fn(),
  parseBalance: jest.fn(value => value),
  validateNumber: jest.fn(),
  // Faithful copy of helper/index.js mergeUniqueAccounts (dedup by address
  // OR derivePath, old entries win position, new fields overlay matches).
  mergeUniqueAccounts: (oldAccounts, newAccounts) => {
    if (!Array.isArray(oldAccounts) || !oldAccounts.length) {
      return Array.isArray(newAccounts) ? newAccounts : [];
    }
    if (!Array.isArray(newAccounts) || !newAccounts.length) {
      return oldAccounts;
    }
    const newByAddress = new Map(newAccounts.map(n => [n.address, n]));
    const newByDerivePath = new Map(newAccounts.map(n => [n.derivePath, n]));
    const oldAddresses = new Set();
    const oldDerivePaths = new Set();
    const merged = oldAccounts.map(o => {
      oldAddresses.add(o.address);
      oldDerivePaths.add(o.derivePath);
      const match =
        newByAddress.get(o.address) ?? newByDerivePath.get(o.derivePath);
      return match ? {...o, ...match} : o;
    });
    const toAdd = newAccounts.filter(
      n => !oldAddresses.has(n.address) && !oldDerivePaths.has(n.derivePath),
    );
    return [...merged, ...toAdd];
  },
}));

jest.mock('dok-wallet-blockchain-networks/service/bitcoinDataSource', () => ({
  isAddressUsageScanAvailable: jest.fn(() => true),
  fetchBitcoinAddressUsage: jest.fn(),
  fetchBitcoinBalances: jest.fn(),
  fetchBitcoinTransactionDetails: jest.fn(),
  fetchBitcoinUTXO: jest.fn(),
  fetchBitcoinTransactions: jest.fn(),
  fetchBitcoinTransaction: jest.fn(),
  broadcastBitcoinTransaction: jest.fn(),
  fetchBitcoinFeeRate: jest.fn(),
}));

// BIP84 test vector (mnemonic: abandon x11 + about), account m/84'/0'/0'.
const ZPUB =
  'zpub6rFR7y4Q2AijBEqTUquhVz398htDFrtymD9xYYfG1m4wAcvPhXNfE3EfH1r1ADqtfSdVCToUG868RvUUkgDKf31mGDtKsAYz2oz2AGutZYs';
const FIRST_RECEIVE_ADDRESS = 'bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu';

// BIP86 test vector (same mnemonic), account m/86'/0'/0'.
const TAPROOT_XPUB =
  'xpub6BgBgsespWvERF3LHQu6CnqdvfEvtMcQjYrcRzx53QJjSxarj2afYWcLteoGVky7D3UKDP9QyrLprQ3VCECoY49yfdDEHGCtMMj92pReUsQ';
const TAPROOT_FIRST_RECEIVE_ADDRESS =
  'bc1p5cyxnuxmeuwuvkwfem96lqzszd02n6xdcjrs20cac6yqjjwudpxqkedrcr';
const TAPROOT_FIRST_CHANGE_ADDRESS =
  'bc1p3qkhfews2uk44qtvauqyr2ttdsw7svhkl9nkm9s9c3x4ax5h60wqwruhk7';

const STANDARD_COUNT = 40; // receive 0..19 + change 0..19
const LEGACY_COUNT = 18; // …/2/0 … …/19/0

const usageAllUnused = ({addresses}) =>
  Promise.resolve(
    Object.fromEntries(addresses.map(address => [address, false])),
  );

describe('legacy window helpers', () => {
  it('buildLegacyWindowPaths returns …/2/0 through …/19/0 per chain', () => {
    const paths = buildLegacyWindowPaths('bitcoin');
    expect(paths).toHaveLength(LEGACY_COUNT);
    expect(paths[0]).toBe("m/84'/0'/0'/2/0");
    expect(paths[paths.length - 1]).toBe("m/84'/0'/0'/19/0");
    expect(buildLegacyWindowPaths('bitcoin_segwit')[0]).toBe("m/49'/0'/0'/2/0");
    expect(buildLegacyWindowPaths('bitcoin_legacy')[0]).toBe("m/44'/0'/0'/2/0");
  });

  it('isLegacyWindowPath matches only the exact legacy shape', () => {
    expect(isLegacyWindowPath('bitcoin', "m/84'/0'/0'/2/0")).toBe(true);
    expect(isLegacyWindowPath('bitcoin', "m/84'/0'/0'/19/0")).toBe(true);
    expect(isLegacyWindowPath('bitcoin_segwit', "m/49'/0'/0'/5/0")).toBe(true);
    // Standard receive/change paths never match.
    expect(isLegacyWindowPath('bitcoin', "m/84'/0'/0'/0/0")).toBe(false);
    expect(isLegacyWindowPath('bitcoin', "m/84'/0'/0'/1/0")).toBe(false);
    expect(isLegacyWindowPath('bitcoin', "m/84'/0'/0'/0/5")).toBe(false);
    expect(isLegacyWindowPath('bitcoin', "m/84'/0'/0'/1/19")).toBe(false);
    // Out of window / off-shape / wrong base.
    expect(isLegacyWindowPath('bitcoin', "m/84'/0'/0'/20/0")).toBe(false);
    expect(isLegacyWindowPath('bitcoin', "m/84'/0'/0'/2/1")).toBe(false);
    expect(isLegacyWindowPath('bitcoin', "m/49'/0'/0'/2/0")).toBe(false);
    expect(isLegacyWindowPath('bitcoin', undefined)).toBe(false);
    expect(isLegacyWindowPath('bitcoin', 'garbage')).toBe(false);
  });

  it('getLegacyWindowItems excludes custom and standard entries', () => {
    const items = [
      {derivePath: "m/84'/0'/0'/0/0", address: 'std'},
      {derivePath: "m/84'/0'/0'/2/0", address: 'legacy'},
      {derivePath: "m/84'/0'/0'/3/0", address: 'custom', isCustom: true},
    ];
    expect(getLegacyWindowItems('bitcoin', items)).toEqual([
      {derivePath: "m/84'/0'/0'/2/0", address: 'legacy'},
    ]);
    expect(getLegacyWindowItems('bitcoin', undefined)).toEqual([]);
  });

  describe('shouldPruneLegacyWindow (all-or-nothing)', () => {
    const legacyItems = [
      {derivePath: "m/84'/0'/0'/2/0", address: 'a'},
      {derivePath: "m/84'/0'/0'/3/0", address: 'b'},
    ];

    it('prunes only when every entry is provably unused', () => {
      expect(
        shouldPruneLegacyWindow({
          legacyItems,
          usage: {a: false, b: false},
          keepAddresses: new Set(),
        }),
      ).toBe(true);
    });

    it('one used address keeps the whole window', () => {
      expect(
        shouldPruneLegacyWindow({
          legacyItems,
          usage: {a: false, b: true},
          keepAddresses: new Set(),
        }),
      ).toBe(false);
    });

    it('a recorded balance keeps the whole window', () => {
      expect(
        shouldPruneLegacyWindow({
          legacyItems: [legacyItems[0], {...legacyItems[1], balance: '1200'}],
          usage: {a: false, b: false},
          keepAddresses: new Set(),
        }),
      ).toBe(false);
    });

    it('a protected (active) address keeps the whole window', () => {
      expect(
        shouldPruneLegacyWindow({
          legacyItems,
          usage: {a: false, b: false},
          keepAddresses: new Set(['b']),
        }),
      ).toBe(false);
    });

    it('a missing usage result keeps the whole window', () => {
      expect(
        shouldPruneLegacyWindow({
          legacyItems,
          usage: {a: false},
          keepAddresses: new Set(),
        }),
      ).toBe(false);
    });

    it('empty input never prunes', () => {
      expect(
        shouldPruneLegacyWindow({
          legacyItems: [],
          usage: {},
          keepAddresses: new Set(),
        }),
      ).toBe(false);
    });
  });

  it('removeLegacyWindowItems drops the window, keeps standard and custom', () => {
    const items = [
      {derivePath: "m/84'/0'/0'/0/0", address: 'std'},
      {derivePath: "m/84'/0'/0'/2/0", address: 'legacy'},
      {derivePath: "m/84'/0'/0'/19/0", address: 'legacy19'},
      {derivePath: "m/84'/0'/0'/5/0", address: 'custom', isCustom: true},
    ];
    expect(removeLegacyWindowItems('bitcoin', items)).toEqual([
      {derivePath: "m/84'/0'/0'/0/0", address: 'std'},
      {derivePath: "m/84'/0'/0'/5/0", address: 'custom', isCustom: true},
    ]);
  });

  describe('getDeriveAddressLabel', () => {
    it('classifies receive, change, legacy, and custom entries', () => {
      expect(
        getDeriveAddressLabel('bitcoin', {derivePath: "m/84'/0'/0'/0/3"}),
      ).toBe('Receive');
      expect(
        getDeriveAddressLabel('bitcoin', {derivePath: "m/84'/0'/0'/1/0"}),
      ).toBe('Change');
      expect(
        getDeriveAddressLabel('bitcoin', {derivePath: "m/84'/0'/0'/7/0"}),
      ).toBe('Legacy');
      expect(
        getDeriveAddressLabel('bitcoin_segwit', {
          derivePath: "m/49'/0'/0'/1/5",
        }),
      ).toBe('Change');
      expect(
        getDeriveAddressLabel('bitcoin_legacy', {
          derivePath: "m/44'/0'/0'/0/0",
        }),
      ).toBe('Receive');
    });

    it('isCustom wins over any path shape', () => {
      expect(
        getDeriveAddressLabel('bitcoin', {
          derivePath: "m/84'/0'/0'/1/0",
          isCustom: true,
        }),
      ).toBe('Custom');
      expect(
        getDeriveAddressLabel('bitcoin', {
          derivePath: "m/84'/0'/0'/7/0",
          isCustom: true,
        }),
      ).toBe('Custom');
    });

    it('falls back to Receive for missing paths', () => {
      expect(getDeriveAddressLabel('bitcoin', {})).toBe('Receive');
      expect(getDeriveAddressLabel('bitcoin', undefined)).toBe('Receive');
    });
  });

  describe('getVisibleDeriveAddresses', () => {
    it('hides unfunded change addresses, keeps everything else', () => {
      const items = [
        {derivePath: "m/84'/0'/0'/0/0", address: 'receive'},
        {derivePath: "m/84'/0'/0'/1/0", address: 'change-empty'},
        {derivePath: "m/84'/0'/0'/1/1", address: 'change-funded', balance: '5'},
        {derivePath: "m/84'/0'/0'/2/0", address: 'legacy'},
        {derivePath: "m/84'/0'/0'/9/9", address: 'custom', isCustom: true},
        {derivePath: "m/84'/0'/0'/0/1"},
      ];
      expect(
        getVisibleDeriveAddresses('bitcoin', items).map(item => item.address),
      ).toEqual(['receive', 'change-funded', 'legacy', 'custom']);
    });

    it('handles empty and undefined input', () => {
      expect(getVisibleDeriveAddresses('bitcoin', undefined)).toEqual([]);
      expect(getVisibleDeriveAddresses('bitcoin', [])).toEqual([]);
    });
  });
});

describe('ensureStandardAddresses', () => {
  it('derives standard + legacy window by default (58 watch-only entries)', () => {
    const result = ensureStandardAddresses({
      chain_name: 'bitcoin',
      deriveAddresses: [],
      accountKey: ZPUB,
    });
    expect(result).toHaveLength(STANDARD_COUNT + LEGACY_COUNT);
    expect(result[0].derivePath).toBe("m/84'/0'/0'/0/0");
    expect(result[0].address).toBe(FIRST_RECEIVE_ADDRESS);
    expect(result[0].privateKey).toBeUndefined();
    expect(
      result.filter(item => isLegacyWindowPath('bitcoin', item.derivePath)),
    ).toHaveLength(LEGACY_COUNT);
  });

  it('skips the legacy window when includeLegacyWindow is false', () => {
    const result = ensureStandardAddresses({
      chain_name: 'bitcoin',
      deriveAddresses: [],
      accountKey: ZPUB,
      includeLegacyWindow: false,
    });
    expect(result).toHaveLength(STANDARD_COUNT);
    expect(
      result.some(item => isLegacyWindowPath('bitcoin', item.derivePath)),
    ).toBe(false);
  });

  it('is idempotent once the window is complete', () => {
    const first = ensureStandardAddresses({
      chain_name: 'bitcoin',
      deriveAddresses: [],
      accountKey: ZPUB,
    });
    const second = ensureStandardAddresses({
      chain_name: 'bitcoin',
      deriveAddresses: first,
      accountKey: ZPUB,
    });
    expect(second).toBe(first);
  });

  it('preserves existing legacy entries even when the window is excluded', () => {
    const standardOnly = ensureStandardAddresses({
      chain_name: 'bitcoin',
      deriveAddresses: [],
      accountKey: ZPUB,
      includeLegacyWindow: false,
    });
    const keptLegacy = {derivePath: "m/84'/0'/0'/7/0", address: 'used-legacy'};
    const result = ensureStandardAddresses({
      chain_name: 'bitcoin',
      deriveAddresses: [...standardOnly, keptLegacy],
      accountKey: ZPUB,
      includeLegacyWindow: false,
    });
    expect(result).toContainEqual(keptLegacy);
    expect(result).toHaveLength(STANDARD_COUNT + 1);
  });

  it('returns input unchanged without an account key', () => {
    const input = [{derivePath: "m/84'/0'/0'/0/0", address: 'x'}];
    expect(
      ensureStandardAddresses({
        chain_name: 'bitcoin',
        deriveAddresses: input,
        accountKey: null,
      }),
    ).toBe(input);
  });
});

describe('BitcoinChain.getBalance legacy scan', () => {
  const chain = BitcoinChain();

  beforeEach(() => {
    jest.clearAllMocks();
    isAddressUsageScanAvailable.mockReturnValue(true);
    fetchBitcoinAddressUsage.mockImplementation(usageAllUnused);
    fetchBitcoinBalances.mockImplementation(({derive_addresses}) =>
      Promise.resolve({
        data: {
          totalBalance: '0',
          deriveAddresses: derive_addresses.map(item => ({
            ...item,
            balance: '0',
          })),
        },
      }),
    );
  });

  const getBalanceWith = overrides =>
    chain.getBalance({
      address: FIRST_RECEIVE_ADDRESS,
      chain_name: 'bitcoin',
      extendedPublicKey: ZPUB,
      deriveAddresses: [],
      isLegacyScanDone: false,
      ...overrides,
    });

  it('prunes the whole window when all 18 legacy addresses are unused', async () => {
    const result = await getBalanceWith({});
    // First usage call is the legacy scan over exactly 18 addresses.
    expect(fetchBitcoinAddressUsage.mock.calls[0][0].addresses).toHaveLength(
      LEGACY_COUNT,
    );
    expect(result.deriveAddresses).toHaveLength(STANDARD_COUNT);
    expect(result.isLegacyScanDone).toBe(true);
  });

  it('keeps all 18 when any single legacy address was used', async () => {
    fetchBitcoinAddressUsage.mockImplementationOnce(({addresses}) =>
      Promise.resolve(
        Object.fromEntries(
          addresses.map((address, index) => [address, index === 4]),
        ),
      ),
    );
    const result = await getBalanceWith({});
    expect(result.deriveAddresses).toHaveLength(STANDARD_COUNT + LEGACY_COUNT);
    expect(result.isLegacyScanDone).toBe(true);
  });

  it('keeps everything and leaves the flag unset when the scan fails', async () => {
    fetchBitcoinAddressUsage.mockRejectedValueOnce(new Error('electrum down'));
    const result = await getBalanceWith({});
    expect(result.deriveAddresses).toHaveLength(STANDARD_COUNT + LEGACY_COUNT);
    expect(result.isLegacyScanDone).toBe(false);
  });

  it('skips legacy generation and scan once resolved', async () => {
    const standardOnly = ensureStandardAddresses({
      chain_name: 'bitcoin',
      deriveAddresses: [],
      accountKey: ZPUB,
      includeLegacyWindow: false,
    });
    const result = await getBalanceWith({
      deriveAddresses: standardOnly,
      isLegacyScanDone: true,
    });
    expect(result.deriveAddresses).toHaveLength(STANDARD_COUNT);
    expect(result.isLegacyScanDone).toBe(true);
    // Only the standard gap-limit scan ran; no 18-address legacy call.
    expect(
      fetchBitcoinAddressUsage.mock.calls.some(
        call => call[0].addresses.length === LEGACY_COUNT,
      ),
    ).toBe(false);
  });

  it('rescans despite the flag when the address list was lost', async () => {
    const result = await getBalanceWith({
      deriveAddresses: [],
      isLegacyScanDone: true,
    });
    expect(fetchBitcoinAddressUsage.mock.calls[0][0].addresses).toHaveLength(
      LEGACY_COUNT,
    );
    expect(result.deriveAddresses).toHaveLength(STANDARD_COUNT);
    expect(result.isLegacyScanDone).toBe(true);
  });
});

// What the old address-recovery endpoint returned for the BIP84/49/44 test
// vector accounts (abandon x11 + about): the old app scheme …/i/0, i = 0..19.
// The app must find the same addresses from the xpub on its own.
const OLD_SCHEME_ACCOUNTS = [
  {
    chain_name: 'bitcoin',
    xpub: ZPUB,
    basePath: "m/84'/0'/0'",
    addresses: {
      0: 'bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu',
      1: 'bc1q8c6fshw2dlwun7ekn9qwf37cu2rn755upcp6el',
      2: 'bc1qgypllrw8plmfj3tutsff7c0p9j9adukc4qagn6',
      10: 'bc1qgtm9w3l96jxxw4agvsz8lcm6vamr8nrf8l0du0',
      19: 'bc1qn6rssdh4nexle22799k0tdck53msg90zm0fgjp',
    },
  },
  {
    chain_name: 'bitcoin_segwit',
    xpub: 'ypub6Ww3ibxVfGzLrAH1PNcjyAWenMTbbAosGNB6VvmSEgytSER9azLDWCxoJwW7Ke7icmizBMXrzBx9979FfaHxHcrArf3zbeJJJUZPf663zsP',
    basePath: "m/49'/0'/0'",
    addresses: {
      0: '37VucYSaXLCAsxYyAPfbSi9eh4iEcbShgf',
      1: '34K56kSjgUCUSD8GTtuF7c9Zzwokbs6uZ7',
      2: '3GHtPiS333CV2fDqX68GEL7eNYt3nXGo1G',
      10: '3PSbikpKfS8H5dryb8Vtr6TCP9kW1SwPXd',
      19: '3Kqu6afqeeCFwQLoeBQtpPoXERMuumNH6P',
    },
  },
  {
    chain_name: 'bitcoin_legacy',
    xpub: 'xpub6BosfCnifzxcFwrSzQiqu2DBVTshkCXacvNsWGYJVVhhawA7d4R5WSWGFNbi8Aw6ZRc1brxMyWMzG3DSSSSoekkudhUd9yLb6qx39T9nMdj',
    basePath: "m/44'/0'/0'",
    addresses: {
      0: '1LqBGSKuX5yYUonjxT5qGfpUsXKYYWeabA',
      1: '1J3J6EvPrv8q6AC3VCjWV45Uf3nssNMRtH',
      2: '1PKxPe6zBab3JRFwj4EzNXZLxhJy6YTKWv',
      10: '1KjcT5eqhrVER9qE3xxtEKUSoZVHTJreqb',
      19: '1MTHAfzqPk6VVgGMJhdNGQYinsAqMg5E7k',
    },
  },
];

describe('BitcoinChain.getBalance for a wallet with one saved address', () => {
  const cases = OLD_SCHEME_ACCOUNTS.flatMap(account => [
    {...account, label: 'no saved address', saved: []},
    {
      ...account,
      label: 'one saved address',
      saved: [
        {derivePath: `${account.basePath}/0/0`, address: account.addresses[0]},
      ],
    },
  ]);

  it.each(cases)(
    '$chain_name, $label: finds every old-scheme address from the xpub',
    async ({chain_name, xpub, basePath, addresses, saved}) => {
      jest.clearAllMocks();
      isAddressUsageScanAvailable.mockReturnValue(true);
      // Funds sit on an old-scheme address, so the scan keeps the window.
      fetchBitcoinAddressUsage.mockImplementation(({addresses: list}) =>
        Promise.resolve(
          Object.fromEntries(
            list.map(address => [address, address === addresses[10]]),
          ),
        ),
      );
      fetchBitcoinBalances.mockImplementation(({derive_addresses}) =>
        Promise.resolve({
          data: {
            totalBalance: '1000',
            deriveAddresses: derive_addresses.map(item => ({
              ...item,
              balance: item.address === addresses[10] ? '1000' : '0',
            })),
          },
        }),
      );

      const result = await BitcoinChain().getBalance({
        address: addresses[0],
        chain_name,
        extendedPublicKey: xpub,
        deriveAddresses: saved,
        isLegacyScanDone: false,
      });

      expect(result?.totalBalance).toBe('1000');
      const byPath = new Map(
        result.deriveAddresses.map(item => [item.derivePath, item.address]),
      );
      for (let i = 0; i < 20; i++) {
        expect(byPath.has(`${basePath}/${i}/0`)).toBe(true);
      }
      for (const [index, address] of Object.entries(addresses)) {
        expect(byPath.get(`${basePath}/${index}/0`)).toBe(address);
      }
    },
  );
});

describe('BitcoinChain.getBalance takes only balances from the response', () => {
  // Not an address of the test-vector account.
  const OTHER_ADDRESS = 'bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh';
  const CHANGE_0_PATH = "m/84'/0'/0'/1/0";
  const ownList = () =>
    ensureStandardAddresses({
      chain_name: 'bitcoin',
      deriveAddresses: [],
      accountKey: ZPUB,
      includeLegacyWindow: false,
    });

  beforeEach(() => {
    jest.clearAllMocks();
    isAddressUsageScanAvailable.mockReturnValue(true);
    fetchBitcoinAddressUsage.mockImplementation(usageAllUnused);
  });

  const respondWith = deriveAddresses =>
    fetchBitcoinBalances.mockResolvedValue({
      data: {totalBalance: '5000', deriveAddresses},
    });

  it('ignores a changed address and extra entries in the response', async () => {
    const own = ownList();
    const ownChange0 = own.find(item => item.derivePath === CHANGE_0_PATH);
    respondWith([
      ...own.map(item => ({
        ...item,
        address:
          item.derivePath === CHANGE_0_PATH ? OTHER_ADDRESS : item.address,
        balance: item.address === FIRST_RECEIVE_ADDRESS ? '5000' : '0',
      })),
      {derivePath: "m/84'/0'/0'/1/1", address: OTHER_ADDRESS, balance: '0'},
    ]);

    const result = await BitcoinChain().getBalance({
      address: FIRST_RECEIVE_ADDRESS,
      chain_name: 'bitcoin',
      extendedPublicKey: ZPUB,
      deriveAddresses: own,
      isLegacyScanDone: true,
    });

    expect(result.totalBalance).toBe('5000');
    expect(result.deriveAddresses).toHaveLength(own.length);
    expect(result.deriveAddresses.map(item => item.address)).not.toContain(
      OTHER_ADDRESS,
    );
    expect(
      result.deriveAddresses.find(item => item.derivePath === CHANGE_0_PATH)
        .address,
    ).toBe(ownChange0.address);
    expect(
      result.deriveAddresses.find(
        item => item.address === FIRST_RECEIVE_ADDRESS,
      ).balance,
    ).toBe('5000');
  });

  it('keeps entries the response left out', async () => {
    const own = ownList();
    respondWith(own.slice(0, 5).map(item => ({...item, balance: '0'})));

    const result = await BitcoinChain().getBalance({
      address: FIRST_RECEIVE_ADDRESS,
      chain_name: 'bitcoin',
      extendedPublicKey: ZPUB,
      deriveAddresses: own,
      isLegacyScanDone: true,
    });

    expect(result.deriveAddresses.map(item => item.address)).toEqual(
      own.map(item => item.address),
    );
  });

  it('keeps the coin address when there is no xpub', async () => {
    respondWith([
      {derivePath: "m/84'/0'/0'/0/0", address: OTHER_ADDRESS, balance: '7'},
    ]);

    const result = await BitcoinChain().getBalance({
      address: FIRST_RECEIVE_ADDRESS,
      chain_name: 'bitcoin',
      deriveAddresses: [],
    });

    expect(result.deriveAddresses).toEqual([
      {derivePath: "m/84'/0'/0'/0/0", address: FIRST_RECEIVE_ADDRESS},
    ]);
  });
});

describe('bitcoin_taproot (BIP-86)', () => {
  it('uses purpose 86 and plain xpub/xprv version bytes', () => {
    expect(getAccountBasePath('bitcoin_taproot')).toBe("m/86'/0'/0'");
    const network = getNetworkByChainName('bitcoin_taproot');
    expect(network.bip32).toEqual({public: 0x0488b21e, private: 0x0488ade4});
    expect(network.bech32).toBe('bc');
  });

  it('derives the BIP-86 reference addresses from the account xpub', () => {
    const [receive] = deriveAddressRange({
      chain_name: 'bitcoin_taproot',
      accountKey: TAPROOT_XPUB,
      chainIndex: 0,
      start: 0,
      count: 1,
    });
    const [change] = deriveAddressRange({
      chain_name: 'bitcoin_taproot',
      accountKey: TAPROOT_XPUB,
      chainIndex: 1,
      start: 0,
      count: 1,
    });
    expect(receive).toEqual({
      derivePath: "m/86'/0'/0'/0/0",
      address: TAPROOT_FIRST_RECEIVE_ADDRESS,
    });
    expect(change.address).toBe(TAPROOT_FIRST_CHANGE_ADDRESS);
  });

  it('has no legacy-scheme window', () => {
    expect(hasLegacyScheme('bitcoin_taproot')).toBe(false);
    expect(hasLegacyScheme('bitcoin')).toBe(true);
    expect(buildLegacyWindowPaths('bitcoin_taproot')).toEqual([]);
    expect(isLegacyWindowPath('bitcoin_taproot', "m/86'/0'/0'/5/0")).toBe(
      false,
    );
  });

  it('ensureStandardAddresses yields exactly the 40 standard entries', () => {
    const result = ensureStandardAddresses({
      chain_name: 'bitcoin_taproot',
      deriveAddresses: [],
      accountKey: TAPROOT_XPUB,
      includeLegacyWindow: true,
    });
    expect(result).toHaveLength(STANDARD_COUNT);
    expect(result.every(item => item.address.startsWith('bc1p'))).toBe(true);
    expect(result[0].address).toBe(TAPROOT_FIRST_RECEIVE_ADDRESS);
  });

  it('getBalance resolves the legacy flag without a legacy window', async () => {
    jest.clearAllMocks();
    isAddressUsageScanAvailable.mockReturnValue(true);
    fetchBitcoinAddressUsage.mockImplementation(usageAllUnused);
    fetchBitcoinBalances.mockImplementation(({derive_addresses}) =>
      Promise.resolve({
        data: {
          totalBalance: '0',
          deriveAddresses: derive_addresses.map(item => ({
            ...item,
            balance: '0',
          })),
        },
      }),
    );
    const result = await BitcoinChain().getBalance({
      address: TAPROOT_FIRST_RECEIVE_ADDRESS,
      chain_name: 'bitcoin_taproot',
      extendedPublicKey: TAPROOT_XPUB,
      deriveAddresses: [],
      isLegacyScanDone: false,
    });
    expect(result.deriveAddresses).toHaveLength(STANDARD_COUNT);
    expect(result.isLegacyScanDone).toBe(true);
  });
});
