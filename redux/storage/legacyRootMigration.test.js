import {
  buildPersistEnvelope,
  ensureWalletClientIds,
  fixCurrentWalletIndex,
  parseLegacyRoot,
  parsePersistEnvelope,
  sanitizeAuth,
  sanitizeBatchTransaction,
  sanitizeSellCrypto,
  splitLegacyRoot,
  verifyMigration,
} from 'dok-wallet-blockchain-networks/redux/storage/legacyRootMigration';
import {
  assertNoSecrets,
  extractVaultPayload,
  hydrateWalletSecrets,
} from 'dok-wallet-blockchain-networks/redux/wallets/walletSecrets';

const HEX = i => `0x${String(i).padStart(2, '0').repeat(32)}`;
const MNEMONIC = 'abandon '.repeat(11) + 'about';

const legacyWallets = () => ({
  allWallets: [
    {
      clientId: 'w1',
      walletName: 'Main',
      phrase: MNEMONIC,
      coins: [
        {
          _id: 'c1',
          chain_name: 'ethereum',
          symbol: 'ETH',
          address: '0xa0',
          privateKey: HEX(1),
          deriveAddresses: [
            {
              address: '0xa0',
              derivePath: "m/44'/60'/0'/0/0",
              privateKey: HEX(1),
            },
          ],
        },
      ],
      chain_existing_coin: {ethereum: {address: '0xa0', privateKey: HEX(1)}},
    },
    {clientId: 'w2', walletName: 'Second', phrase: MNEMONIC, coins: []},
  ],
  currentWalletIndex: 1,
  pendingTransactions: {},
  masterClientId: 'master-1',
  isRefreshingAllWallets: true,
  refreshingWalletClientId: 'w1',
  refreshCoinsRequestIds: {w1: 'req'},
});

const legacySlices = () => ({
  auth: {
    isLogin: true,
    password: 'Secret123!',
    loading: true,
    error: 'x',
    fingerprintAuth: true,
    attempts: [1],
    maxAttempt: 5,
    lastAttempt: false,
  },
  wallets: legacyWallets(),
  settings: {theme: 'dark', lockTime: 5},
  sellCrypto: {
    requestDetails: {
      amount: '1',
      selectedFromWallet: legacyWallets().allWallets[0],
    },
  },
  batchTransaction: {
    transactions: {
      w1: [
        {amount: '1', coinInfo: {chain_name: 'ethereum', privateKey: HEX(1)}},
        {
          amount: '2',
          coinInfo: {
            chain_name: 'ethereum',
            address: '0xabc',
            privateKey: HEX(1),
            deriveAddresses: [
              {
                address: '0xdef',
                derivePath: "m/44'/60'/0'/0/1",
                privateKey: HEX(2),
              },
            ],
          },
        },
      ],
    },
  },
  schedulePayment: {
    scheduledPayments: [],
    isSubmitting: true,
    pendingSubmitCount: 2,
  },
  customRpc: {rpcs: {}},
});

// Exactly what createPersistoid writes: a JSON object whose values are the
// JSON-stringified slices.
const legacyRootString = (slices = legacySlices()) =>
  JSON.stringify({
    ...Object.fromEntries(
      Object.entries(slices).map(([k, v]) => [k, JSON.stringify(v)]),
    ),
    _persist: JSON.stringify({version: -1, rehydrated: true}),
  });

describe('legacyRootMigration', () => {
  describe('parseLegacyRoot', () => {
    it('parses the persistoid format from a string or an object', () => {
      const fromString = parseLegacyRoot(legacyRootString());
      expect(Object.keys(fromString.slices).sort()).toEqual(
        Object.keys(legacySlices()).sort(),
      );
      expect(fromString.slices.auth.password).toBe('Secret123!');
      expect(fromString.persist).toEqual({version: -1, rehydrated: true});

      const fromObject = parseLegacyRoot(JSON.parse(legacyRootString()));
      expect(fromObject.slices).toEqual(fromString.slices);
    });

    it('decodes each value first when asked (web crypto-js path)', () => {
      const encoded = JSON.stringify({
        auth: 'ENC:' + JSON.stringify({password: 'pw'}),
        _persist: 'ENC:' + JSON.stringify({version: -1}),
      });
      const {slices, persist} = parseLegacyRoot(encoded, {
        decodeValue: (_, raw) => raw.slice(4),
      });
      expect(slices.auth).toEqual({password: 'pw'});
      expect(persist).toEqual({version: -1});
    });

    it('throws a coded error on corrupt JSON and never returns partial data', () => {
      expect(() => parseLegacyRoot('{not json')).toThrow(
        expect.objectContaining({code: 'legacy_parse'}),
      );
      expect(() => parseLegacyRoot(JSON.stringify({auth: '{oops'}))).toThrow(
        expect.objectContaining({code: 'legacy_parse'}),
      );
      expect(() => parseLegacyRoot('[]')).toThrow(
        expect.objectContaining({code: 'legacy_parse'}),
      );
    });
  });

  describe('sanitizers', () => {
    it('fixCurrentWalletIndex converts the index once and is idempotent', () => {
      const fixed = fixCurrentWalletIndex(legacyWallets());
      expect(fixed.currentWalletClientId).toBe('w2');
      expect('currentWalletIndex' in fixed).toBe(false);
      expect(fixCurrentWalletIndex(fixed)).toBe(fixed);
      expect(
        fixCurrentWalletIndex({
          allWallets: [{clientId: 'a'}],
          currentWalletIndex: 9,
        }).currentWalletClientId,
      ).toBe('a');
      expect(
        fixCurrentWalletIndex({allWallets: []}).currentWalletClientId,
      ).toBeNull();
    });

    it('sanitizeAuth drops password/loading/error and derives hasAccount', () => {
      expect(sanitizeAuth(legacySlices().auth)).toEqual({
        isLogin: true,
        fingerprintAuth: true,
        attempts: [1],
        maxAttempt: 5,
        lastAttempt: false,
        hasAccount: true,
      });
      expect(sanitizeAuth({password: ''}).hasAccount).toBe(false);
      expect(sanitizeAuth(undefined)).toEqual({hasAccount: false});
    });

    it('sanitizeSellCrypto strips the embedded wallet', () => {
      const out = sanitizeSellCrypto(legacySlices().sellCrypto);
      expect(out.requestDetails.amount).toBe('1');
      expect(out.requestDetails.selectedFromWallet.walletName).toBe('Main');
      expect(() => assertNoSecrets(out)).not.toThrow();
      expect(sanitizeSellCrypto({requestDetails: {}})).toEqual({
        requestDetails: {},
      });
    });

    it('sanitizeBatchTransaction deletes coinInfo secrets only', () => {
      const out = sanitizeBatchTransaction(legacySlices().batchTransaction);
      expect(out.transactions.w1[0]).toEqual({
        amount: '1',
        coinInfo: {chain_name: 'ethereum'},
      });
    });

    it('sanitizeBatchTransaction strips nested deriveAddresses keys', () => {
      const out = sanitizeBatchTransaction(legacySlices().batchTransaction);
      expect(out.transactions.w1[1]).toEqual({
        amount: '2',
        coinInfo: {
          chain_name: 'ethereum',
          address: '0xabc',
          deriveAddresses: [{address: '0xdef', derivePath: "m/44'/60'/0'/0/1"}],
        },
      });
      expect(() => assertNoSecrets(out)).not.toThrow();
    });
  });

  describe('splitLegacyRoot', () => {
    it('returns sanitized slices, the vault payload, the password and counts', () => {
      const {slices} = parseLegacyRoot(legacyRootString());
      const result = splitLegacyRoot(slices);

      expect(result.password).toBe('Secret123!');
      expect(result.hasAccount).toBe(true);
      expect(result.counts).toEqual({wallets: 2, coins: 1, deriveKeys: 1});
      expect(result.vaultPayload).toEqual(
        extractVaultPayload(legacyWallets().allWallets),
      );

      expect(Object.keys(result.slices).sort()).toEqual(
        Object.keys(slices).sort(),
      );
      expect(() => assertNoSecrets(result.slices)).not.toThrow();
      expect(result.slices.auth.hasAccount).toBe(true);
      expect(result.slices.auth.password).toBeUndefined();
      expect(result.slices.wallets.currentWalletClientId).toBe('w2');
      expect(result.slices.wallets.isRefreshingAllWallets).toBe(false);
      expect(result.slices.wallets.refreshCoinsRequestIds).toEqual({});
      expect(result.slices.wallets.masterClientId).toBe('master-1');
      expect(result.slices.schedulePayment).toEqual({
        scheduledPayments: [],
        isSubmitting: false,
        pendingSubmitCount: 0,
      });
      // Untouched slices pass through by reference.
      expect(result.slices.settings).toBe(slices.settings);
      expect(result.slices.customRpc).toBe(slices.customRpc);
    });

    it('handles the no-password legacy state (onboarding never finished)', () => {
      const slices = legacySlices();
      slices.auth.password = '';
      const result = splitLegacyRoot(slices);
      expect(result.hasAccount).toBe(false);
      expect(result.password).toBe('');
      expect(result.slices.auth.hasAccount).toBe(false);
      // Secrets are still extracted so the caller can decide what to do with
      // orphan wallets.
      expect(result.counts.wallets).toBe(2);
    });

    it('is deterministic (running twice gives identical output)', () => {
      const a = splitLegacyRoot(legacySlices());
      const b = splitLegacyRoot(legacySlices());
      expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    });
  });

  describe('persist envelopes', () => {
    it('buildPersistEnvelope matches redux-persist field-wise shape and round-trips', () => {
      const slice = {a: 1, b: {c: [1, 2]}, d: undefined};
      const raw = buildPersistEnvelope(slice);
      const outer = JSON.parse(raw);
      expect(Object.keys(outer)).toEqual(['a', 'b', '_persist']);
      expect(outer.a).toBe('1');
      expect(JSON.parse(outer._persist)).toEqual({
        version: 1,
        rehydrated: true,
      });
      expect(parsePersistEnvelope(raw)).toEqual({
        a: 1,
        b: {c: [1, 2]},
        _persist: {version: 1, rehydrated: true},
      });
    });
  });

  // Wallets created before clientId existed only get one at runtime
  // (walletsSlice.createClientIdIfNotExist, dispatched after rehydrate). The
  // migration runs before the store exists, so it must assign the id itself or
  // the wallet's secrets would be stripped from the slice and never reach the
  // vault (extractVaultPayload keys by clientId).
  describe('legacy wallets without clientId', () => {
    const UUID_RE =
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    const walletsWithoutId = () => ({
      allWallets: [
        legacyWallets().allWallets[0],
        {walletName: 'Old', phrase: MNEMONIC, coins: []},
      ],
      currentWalletIndex: 1,
    });

    it('ensureWalletClientIds is a no-op when every wallet already has one', () => {
      const wallets = legacyWallets();
      expect(ensureWalletClientIds(wallets)).toBe(wallets);
      expect(ensureWalletClientIds(null)).toBe(null);
      expect(ensureWalletClientIds({allWallets: 'nope'})).toEqual({
        allWallets: 'nope',
      });
    });

    it('ensureWalletClientIds assigns ids only where missing and never mutates', () => {
      const wallets = walletsWithoutId();
      const out = ensureWalletClientIds(wallets);
      expect(out.allWallets[0]).toBe(wallets.allWallets[0]);
      expect(out.allWallets[1].clientId).toMatch(UUID_RE);
      expect(out.allWallets[1].phrase).toBe(MNEMONIC);
      expect(wallets.allWallets[1].clientId).toBeUndefined();
    });

    it('splitLegacyRoot gives the slice, the vault payload and legacyWallets the same new id', () => {
      const {
        slices,
        vaultPayload,
        legacyWallets: normalized,
      } = splitLegacyRoot({wallets: walletsWithoutId()});
      const assigned = slices.wallets.allWallets[1].clientId;
      expect(assigned).toMatch(UUID_RE);
      expect(normalized.allWallets[1].clientId).toBe(assigned);
      expect(slices.wallets.currentWalletClientId).toBe(assigned);
      expect(Object.keys(vaultPayload.wallets).sort()).toEqual(
        ['w1', assigned].sort(),
      );
      expect(vaultPayload.wallets[assigned].phrase).toBe(MNEMONIC);
      expect(() => assertNoSecrets(slices.wallets)).not.toThrow();
      const hydrated = hydrateWalletSecrets(
        slices.wallets.allWallets,
        vaultPayload,
      );
      expect(hydrated[1].phrase).toBe(MNEMONIC);
    });

    it('verifyMigration refuses wallets that still have no clientId', () => {
      const legacy = walletsWithoutId();
      const {slices, vaultPayload} = splitLegacyRoot({wallets: legacy});
      const raw = verifyMigration({
        legacyWallets: legacy,
        migratedWallets: slices.wallets,
        decryptedVault: vaultPayload,
      });
      expect(raw.ok).toBe(false);
      expect(raw.problems.join(' ')).toMatch(/without clientId/);

      const migratedMissing = verifyMigration({
        legacyWallets: legacy,
        migratedWallets: {
          allWallets: slices.wallets.allWallets.map(({clientId, ...w}) => w),
        },
        decryptedVault: vaultPayload,
      });
      expect(migratedMissing.ok).toBe(false);
      expect(migratedMissing.problems.join(' ')).toMatch(/without clientId/);
    });
  });

  describe('verifyMigration', () => {
    it('passes for a faithful migration', () => {
      const legacy = legacyWallets();
      const {slices, vaultPayload} = splitLegacyRoot({wallets: legacy});
      const result = verifyMigration({
        legacyWallets: legacy,
        migratedWallets: parsePersistEnvelope(
          buildPersistEnvelope(slices.wallets),
        ),
        decryptedVault: vaultPayload,
      });
      expect(result).toEqual({ok: true, problems: []});
    });

    it('accepts public 64-hex values under chain-specific keys (Tron txID, block hashes)', () => {
      const legacy = legacyWallets();
      legacy.allWallets[0].coins[0].transactions = [
        {
          txID: 'ab'.repeat(32),
          blockHash: 'cd'.repeat(32),
          raw_data_hex: 'ef'.repeat(32),
        },
        {signature: 'ab'.repeat(32), parentHash: 'cd'.repeat(32)},
      ];
      const {slices, vaultPayload} = splitLegacyRoot({wallets: legacy});
      const result = verifyMigration({
        legacyWallets: legacy,
        migratedWallets: parsePersistEnvelope(
          buildPersistEnvelope(slices.wallets),
        ),
        decryptedVault: vaultPayload,
      });
      expect(result).toEqual({ok: true, problems: []});
    });

    it('still catches a real leak by key name and names the key, never the value', () => {
      const legacy = legacyWallets();
      const {slices, vaultPayload} = splitLegacyRoot({wallets: legacy});
      const leaked = JSON.parse(JSON.stringify(slices.wallets));
      leaked.allWallets[0].coins[0].privateKey = HEX(1);
      const result = verifyMigration({
        legacyWallets: legacy,
        migratedWallets: leaked,
        decryptedVault: vaultPayload,
      });
      expect(result.ok).toBe(false);
      expect(result.problems.join('\n')).toMatch(
        /secrets left .* under privateKey/,
      );
      expect(result.problems.join('\n')).toMatch(
        /differ from the stripped legacy/,
      );
      expect(result.problems.join('\n')).not.toContain(HEX(1));
    });

    it('reports missing wallets, coin-count drift, leaked secrets and vault mismatch', () => {
      const legacy = legacyWallets();
      const {slices, vaultPayload} = splitLegacyRoot({wallets: legacy});
      const broken = {
        ...slices.wallets,
        allWallets: [
          {...slices.wallets.allWallets[0], coins: [], privateKey: HEX(3)},
        ],
      };
      const result = verifyMigration({
        legacyWallets: legacy,
        migratedWallets: broken,
        decryptedVault: {...vaultPayload, wallets: {}},
      });
      expect(result.ok).toBe(false);
      expect(result.problems).toHaveLength(5);
      expect(result.problems.join('\n')).toMatch(/clientIds differ/);
      expect(result.problems.join('\n')).toMatch(/coin count differs/);
      expect(result.problems.join('\n')).toMatch(/secrets left/);
      expect(result.problems.join('\n')).toMatch(/vault payload/);
      // Never leaks a value into the report.
      expect(result.problems.join('\n')).not.toContain(HEX(3));
    });
  });
});
