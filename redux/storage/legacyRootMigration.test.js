import {
  buildPersistEnvelope,
  ensureWalletClientIds,
  fixCurrentWalletIndex,
  normalizePathPattern,
  parseLegacyRoot,
  parsePersistEnvelope,
  shapeOf,
  structuralDiff,
  sanitizeAuth,
  sanitizeBatchTransaction,
  sanitizeSellCrypto,
  splitLegacyRoot,
  verifyMigration,
  SENTRY_SENSITIVE_VALUE_RE,
} from 'dok-wallet-blockchain-networks/redux/storage/legacyRootMigration';
import {
  assertNoSecrets,
  extractVaultPayload,
  findSecretPaths,
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
      // The sell screen stores the live coin next to the wallet.
      selectedFromAsset: legacyWallets().allWallets[0].coins[0],
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

// initializeFilters.fulfilled stores clones of the in-memory transactions
// (keys included) under filteredData.
const withBatchFilteredData = slices => ({
  ...slices,
  batchTransaction: {
    ...slices.batchTransaction,
    filteredData: {
      filteredTransactions: JSON.parse(
        JSON.stringify(slices.batchTransaction.transactions.w1),
      ),
      uniqueChains: ['ethereum'],
      loading: true,
      error: null,
    },
  },
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

    it('sanitizeSellCrypto strips the embedded wallet and the embedded coin', () => {
      const out = sanitizeSellCrypto(legacySlices().sellCrypto);
      expect(out.requestDetails.amount).toBe('1');
      expect(out.requestDetails.selectedFromWallet.walletName).toBe('Main');
      expect(out.requestDetails.selectedFromAsset).toEqual({
        _id: 'c1',
        chain_name: 'ethereum',
        symbol: 'ETH',
        address: '0xa0',
        deriveAddresses: [{address: '0xa0', derivePath: "m/44'/60'/0'/0/0"}],
      });
      expect(() => assertNoSecrets(out)).not.toThrow();
      expect(sanitizeSellCrypto({requestDetails: {}})).toEqual({
        requestDetails: {},
      });
      // Either field alone.
      const assetOnly = sanitizeSellCrypto({
        requestDetails: {
          selectedFromAsset: {address: '0xa0', privateKey: HEX(1)},
        },
      });
      expect(assetOnly.requestDetails).toEqual({
        selectedFromAsset: {address: '0xa0'},
      });
    });

    it('sanitizeBatchTransaction strips filteredData.filteredTransactions too', () => {
      const legacy = withBatchFilteredData(legacySlices()).batchTransaction;
      const out = sanitizeBatchTransaction(legacy);
      expect(out.filteredData.filteredTransactions).toEqual(
        out.transactions.w1,
      );
      expect(out.filteredData.uniqueChains).toEqual(['ethereum']);
      expect(() => assertNoSecrets(out)).not.toThrow();
      // Never adds the field when the legacy slice did not have it.
      expect(
        sanitizeBatchTransaction(legacySlices().batchTransaction).filteredData,
      ).toBeUndefined();
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

    it('writes no secret into any slice and reports none for the known shapes', () => {
      const result = splitLegacyRoot(withBatchFilteredData(legacySlices()));
      for (const [name, slice] of Object.entries(result.slices)) {
        expect({
          name,
          paths: findSecretPaths(slice, {valueShapes: false}),
        }).toEqual({name, paths: []});
      }
      expect(result.residualSecrets).toEqual({});
    });

    it('deep-strips and reports secrets under a shape no sanitizer knows', () => {
      const slices = legacySlices();
      slices.settings = {
        ...slices.settings,
        paymentUrlCoin: {
          symbol: 'ETH',
          privateKey: HEX(5),
          deriveAddresses: [{address: '0x1', privateKey: HEX(6)}],
        },
      };
      const result = splitLegacyRoot(slices);
      expect(result.slices.settings).toEqual({
        theme: 'dark',
        lockTime: 5,
        paymentUrlCoin: {symbol: 'ETH', deriveAddresses: [{address: '0x1'}]},
      });
      expect(result.residualSecrets).toEqual({
        settings: {
          count: 2,
          keys: ['PK'],
          pathPatterns: [
            'paymentUrlCoin.PK x1',
            'paymentUrlCoin.deriveAddresses[*].PK x1',
          ],
        },
      });
      // Key names only, never a value.
      expect(JSON.stringify(result.residualSecrets)).not.toContain(HEX(5));
      // Untouched slices still pass through by reference.
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
      expect(result).toEqual({ok: true, problems: [], details: {}});
    });

    it('passes when a wallet carries a selectedNft coin snapshot (Sentry 7750264661)', () => {
      // setSelectedNft copies the live coin, with its 50 native derive keys,
      // next to the NFT metadata; resetNfts only clears it 2 s after launch,
      // so it is in the legacy blob of anyone who opened an NFT last session.
      const legacy = legacyWallets();
      const coin = legacy.allWallets[0].coins[0];
      legacy.allWallets[0].selectedNft = {
        token_id: '7',
        name: 'Ape',
        coin: {
          ...coin,
          deriveAddresses: Array.from({length: 50}, (_, i) => ({
            address: `0xd${i}`,
            derivePath: `m/44'/60'/0'/0/${i}`,
            privateKey: HEX(2),
          })),
        },
      };
      const {slices, vaultPayload} = splitLegacyRoot({wallets: legacy});
      const written = parsePersistEnvelope(
        buildPersistEnvelope(slices.wallets),
      );
      expect(written.allWallets[0].selectedNft.token_id).toBe('7');
      expect(written.allWallets[0].selectedNft.coin.address).toBe('0xa0');
      const result = verifyMigration({
        legacyWallets: legacy,
        migratedWallets: written,
        decryptedVault: vaultPayload,
      });
      expect(result).toEqual({ok: true, problems: [], details: {}});
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
      expect(result).toEqual({ok: true, problems: [], details: {}});
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
        /plaintext keys left .* under PK/,
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
      expect(result.problems.join('\n')).toMatch(/plaintext keys left/);
      expect(result.problems.join('\n')).toMatch(/vault payload/);
      // Never leaks a value into the report.
      expect(result.problems.join('\n')).not.toContain(HEX(3));
    });
  });

  // Diagnostics for a failed self-check: structure, field names, lengths and
  // counts only. Sentry's scrubObject drops any KEY that looks sensitive, so
  // every detail is a string VALUE under a neutral key.
  describe('verifyMigration details', () => {
    const WIF = 'L1aW4aubDFB7yfras2S1mN3bqg9nwySY8nkoLmJebSLD5BWv3ENZ';
    const XPRV =
      'xprv9s21ZrQH143K3QTDL4LXw2F7HEK3wJUD2nW2nRk4stbPy6cq3jPPqjiChkVvvNKmPGJxWUtg6LnF5kejMRNNU3TGtRBeJgk33yuGBxrMPHi';
    const UUID = '4f8b2c1e-9d3a-4b7f-8e21-0c5d6a7b8f90';
    const BTC_ADDR = 'bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq';
    const SOL_ADDR = '7EYnhQoR9YM3N7UoaKRoA44Uy8JeaZV3qyouov87awMs';

    const leakedWithSelectedNft = () => {
      const legacy = legacyWallets();
      const {slices, vaultPayload} = splitLegacyRoot({wallets: legacy});
      const leaked = JSON.parse(JSON.stringify(slices.wallets));
      leaked.allWallets[0].selectedNft = {
        token_id: '7',
        coin: {
          address: '0xa0',
          privateKey: HEX(2),
          deriveAddresses: Array.from({length: 50}, (_, i) => ({
            address: `0xd${i}`,
            derivePath: `m/44'/60'/0'/0/${i}`,
            privateKey: HEX(3),
          })),
        },
      };
      return {legacy, leaked, vaultPayload};
    };

    // KIMLWALLET-APP-8: a legacy wallet whose chain_existing_coin.bitcoin is
    // the whole coin (coinSync copied it in), derive keys included.
    const legacyWithFullCoinChainEntry = deriveCount => {
      const legacy = legacyWallets();
      legacy.allWallets[0].chain_existing_coin.bitcoin = {
        chain_name: 'bitcoin',
        address: 'bc1qa',
        privateKey: 'L1aW4aubDFB7yfras2S1mN3bqg9nwySY8nkoLmJebSLD5BWv3ENZ',
        deriveAddresses: Array.from({length: deriveCount}, (_, i) => ({
          address: `bc1q${i}`,
          derivePath: `m/84'/0'/0'/0/${i}`,
          privateKey: HEX(4),
        })),
      };
      return legacy;
    };

    it('a whole coin copied into chain_existing_coin migrates cleanly', () => {
      const legacy = legacyWithFullCoinChainEntry(150);
      const {slices, vaultPayload} = splitLegacyRoot({wallets: legacy});
      expect(slices.wallets.allWallets[0].chain_existing_coin.bitcoin).toEqual({
        address: 'bc1qa',
      });
      expect(
        vaultPayload.wallets.w1.chainExisting.bitcoin.privateKey,
      ).toBeTruthy();
      const result = verifyMigration({
        legacyWallets: legacy,
        migratedWallets: parsePersistEnvelope(
          buildPersistEnvelope(slices.wallets),
        ),
        decryptedVault: vaultPayload,
      });
      expect(result).toEqual({ok: true, problems: [], details: {}});
    });

    it('the old strip left exactly the 76-char pattern the Sentry event reported', () => {
      const legacy = legacyWithFullCoinChainEntry(150);
      const {slices, vaultPayload} = splitLegacyRoot({wallets: legacy});
      // What the pre-fix strip wrote: the entry's own privateKey omitted, the
      // copied coin's derive keys kept.
      const leaked = JSON.parse(JSON.stringify(slices.wallets));
      const {privateKey, ...entryWithoutKey} =
        legacy.allWallets[0].chain_existing_coin.bitcoin;
      expect(privateKey).toBeTruthy();
      leaked.allWallets[0].chain_existing_coin.bitcoin = entryWithoutKey;
      const {ok, problems, details} = verifyMigration({
        legacyWallets: legacy,
        migratedWallets: leaked,
        decryptedVault: vaultPayload,
      });
      expect(ok).toBe(false);
      const pattern =
        'allWallets[*].chain_existing_coin.bitcoin.deriveAddresses[*].PK x150';
      expect(details.leakedPathPatterns).toEqual([pattern]);
      expect(pattern.replace('.PK', '.privateKey')).toHaveLength(76);
      expect(details.leakContext).toEqual([
        `${pattern.replace(
          ' x150',
          '',
        )} | parent object{PK,address,derivePath} | grandparent object{address,chain_name,deriveAddresses}`,
      ]);
      expect(details.sliceRootInventory).toEqual(
        expect.arrayContaining([
          'allWallets: array(2)',
          'masterClientId: string(8)',
        ]),
      );
      // Nothing in the report trips Sentry's server-side password filter.
      for (const line of [
        ...problems,
        ...details.leakedPathPatterns,
        ...details.leakContext,
        ...details.walletFieldInventory,
        ...details.sliceRootInventory,
      ]) {
        expect(line).not.toMatch(SENTRY_SENSITIVE_VALUE_RE);
      }
    });

    it('normalizePathPattern keeps code-defined field names and hides dynamic keys', () => {
      expect(normalizePathPattern('allWallets[3].coins[12].privateKey')).toBe(
        'allWallets[*].coins[*].PK',
      );
      expect(
        normalizePathPattern('pendingTransactions.ethereum_ETH_0xabc0123.hash'),
      ).toBe('pendingTransactions.<key>.hash');
      expect(normalizePathPattern(`deriveKeys.evm.m/44'/60'/0'/0/1`)).toBe(
        'deriveKeys.evm.<key>',
      );
      expect(normalizePathPattern(`wallets.${UUID}.coins.ethereum_ETH`)).toBe(
        'wallets.<key>.coins.ethereum_ETH',
      );
      expect(normalizePathPattern(`walletData.${BTC_ADDR}`)).toBe(
        'walletData.<key>',
      );
      expect(normalizePathPattern(`x.${SOL_ADDR}`)).toBe('x.<key>');
      expect(normalizePathPattern('[0].privateKey')).toBe('[*].PK');
    });

    it('shapeOf never includes a value', () => {
      expect(shapeOf(undefined)).toBe('missing');
      expect(shapeOf(null)).toBe('null');
      expect(shapeOf(HEX(1))).toBe('string(66)');
      expect(shapeOf(3)).toBe('number');
      expect(shapeOf(true)).toBe('boolean');
      expect(shapeOf([1, 2])).toBe('array(2)');
      expect(shapeOf({b: 1, a: 2, [BTC_ADDR]: 3})).toBe('object{<key>,a,b}');
      const wide = Object.fromEntries(
        Array.from({length: 14}, (_, i) => [`f${i}`, i]),
      );
      expect(shapeOf(wide)).toMatch(
        /^object\{f0,f1,f10,f11,f12,f13,f2,f3,f4,f5,f6,f7,…\}$/,
      );
    });

    it('structuralDiff names the path and the shapes, never the values', () => {
      const a = {
        allWallets: [
          {name: 'x', coins: [{k: HEX(1)}, {k: HEX(2)}], list: [1, 2, 3]},
        ],
      };
      const b = {
        allWallets: [
          {
            name: 'x',
            coins: [{k: HEX(1)}, {k: HEX(3)}],
            list: [1, 2],
            extra: {p: 1},
          },
        ],
      };
      const diff = structuralDiff(a, b, {labelA: 'legacy', labelB: 'migrated'});
      expect(diff).toEqual([
        'allWallets[*].coins[*].k: legacy string(66) vs migrated string(66)',
        'allWallets[*].list: legacy array(3) vs migrated array(2)',
        'allWallets[*].extra: legacy missing vs migrated object{p}',
      ]);
      expect(structuralDiff(a, JSON.parse(JSON.stringify(a)))).toEqual([]);
      const many = structuralDiff(
        {},
        Object.fromEntries(Array.from({length: 13}, (_, i) => [`f${i}`, i])),
        {maxEntries: 10},
      );
      expect(many).toHaveLength(11);
      expect(many[10]).toBe('… +3 more differences');
    });

    it('is empty for a faithful migration', () => {
      const legacy = legacyWallets();
      const {slices, vaultPayload} = splitLegacyRoot({wallets: legacy});
      const result = verifyMigration({
        legacyWallets: legacy,
        migratedWallets: parsePersistEnvelope(
          buildPersistEnvelope(slices.wallets),
        ),
        decryptedVault: vaultPayload,
      });
      expect(result.details).toEqual({});
    });

    it('a leaked selectedNft copy is pinpointed by path pattern and field inventory', () => {
      const {legacy, leaked, vaultPayload} = leakedWithSelectedNft();
      const {ok, details} = verifyMigration({
        legacyWallets: legacy,
        migratedWallets: leaked,
        decryptedVault: vaultPayload,
      });
      expect(ok).toBe(false);
      expect(details.leakedPathPatterns).toEqual([
        'allWallets[*].selectedNft.coin.deriveAddresses[*].PK x50',
        'allWallets[*].selectedNft.coin.PK x1',
      ]);
      expect(details.walletsDiff).toEqual([
        'allWallets[*].selectedNft: legacy missing vs migrated object{coin,token_id}',
      ]);
      expect(details.walletFieldInventory).toEqual(
        expect.arrayContaining(['selectedNft', 'coins[*].deriveAddresses']),
      );
      expect(details.counts).toEqual({
        legacyWallets: 2,
        migratedWallets: 2,
        coinsPerWallet: [1, 0],
        deriveAddressesPerWallet: [1, 0],
      });
      const text = JSON.stringify(details);
      expect(text).not.toContain(HEX(2));
      expect(text).not.toContain(HEX(3));
      expect(text).not.toContain('0x');
      expect(text).not.toContain('w1');
      expect(text).not.toContain("m/44'");
    });

    it('vault mismatch and coin-count drift point at the wallet and the entry', () => {
      const legacy = legacyWallets();
      const {slices, vaultPayload} = splitLegacyRoot({wallets: legacy});
      const migrated = parsePersistEnvelope(
        buildPersistEnvelope(slices.wallets),
      );
      migrated.allWallets[0].coins = [];
      const {details, problems} = verifyMigration({
        legacyWallets: legacy,
        migratedWallets: migrated,
        decryptedVault: {
          ...vaultPayload,
          wallets: {
            ...vaultPayload.wallets,
            w1: {...vaultPayload.wallets.w1, coins: {}},
          },
        },
      });
      expect(problems.join('\n')).toMatch(/coin count differs/);
      expect(details.coinCountDrift).toEqual(['wallet#0: 1 -> 0']);
      expect(details.walletsDiff).toEqual([
        'allWallets[*].coins: legacy array(1) vs migrated array(0)',
      ]);
      expect(details.vaultDiff).toEqual([
        'wallets.w1.coins.ethereum_ETH: expected object{PK,_id} vs actual missing',
      ]);
      expect(details.walletCounts).toBeUndefined();
    });

    it('never leaks a value through any branch', () => {
      const legacy = legacyWallets();
      legacy.allWallets[0].coins.push({
        _id: 'c-btc',
        chain_name: 'bitcoin',
        symbol: 'BTC',
        address: BTC_ADDR,
        privateKey: WIF,
        extendedPrivateKey: XPRV,
        deriveAddresses: [{address: BTC_ADDR, privateKey: WIF}],
      });
      legacy.allWallets[1].clientId = UUID;
      legacy.allWallets[1].phrase = MNEMONIC;
      legacy.allWallets[1].pendingTransactions = {
        [`bitcoin_BTC_${BTC_ADDR}`]: [{hash: 'ab'.repeat(32)}],
      };
      const {slices} = splitLegacyRoot({wallets: legacy});
      const broken = JSON.parse(JSON.stringify(slices.wallets));
      // Every problem branch at once.
      delete broken.allWallets[1].clientId;
      broken.allWallets[0].coins[1].privateKey = WIF;
      broken.allWallets[0].secretCodeSalt = 'b'.repeat(32);
      broken.allWallets.push({clientId: 'ghost', coins: []});
      const {details, problems} = verifyMigration({
        legacyWallets: legacy,
        migratedWallets: broken,
        decryptedVault: {
          v: 1,
          wallets: {
            [UUID]: {
              phrase: MNEMONIC,
              coins: {},
              chainExisting: {},
              deriveKeys: {},
            },
          },
        },
      });
      expect(problems.length).toBeGreaterThanOrEqual(4);
      const text = JSON.stringify(details);
      for (const secret of [
        WIF,
        XPRV,
        MNEMONIC,
        HEX(1),
        UUID,
        BTC_ADDR,
        SOL_ADDR,
        '0xa0',
        'abandon',
      ]) {
        expect(text).not.toContain(secret);
      }
      expect(details.walletCounts).toEqual({
        legacy: 2,
        migrated: 3,
        legacyWithoutId: 0,
        migratedWithoutId: 1,
      });
      expect(details.leakedPathPatterns).toEqual([
        'allWallets[*].SC_SALT x1',
        'allWallets[*].coins[*].PK x1',
      ]);
    });
  });
});
