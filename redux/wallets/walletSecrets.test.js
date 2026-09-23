import {
  SECRET_WALLET_FIELDS,
  assertNoSecrets,
  extractVaultPayload,
  findSecretPaths,
  findWalletsMissingSecrets,
  getDeriveFamily,
  hydrateWalletSecrets,
  stripAllWalletsSecrets,
  stripWalletSecrets,
  vaultPayloadHasSecrets,
} from 'dok-wallet-blockchain-networks/redux/wallets/walletSecrets';

const MNEMONIC =
  'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
const HEX = i => `0x${String(i).padStart(2, '0').repeat(32)}`;
const XPRV =
  'xprv9s21ZrQH143K3QTDL4LXw2F7HEK3wJUD2nW2nRk4stbPy6cq3jPPqjiChkVvvNKmPGJxWUtg6LnF5kejMRNNU3TGtRBeJgk33yuGBxrMPHi';
const WIF = 'L1aW4aubDFB7yfras2S1mN3bqg9nwySY8nkoLmJebSLD5BWv3ENZ';
const TX_HASH =
  '0xabababababababababababababababababababababababababababababababab';

const evmDerives = (count, {withCustom} = {}) => {
  const list = Array.from({length: count}, (_, i) => ({
    address: `0xaddr${i}`,
    derivePath: `m/44'/60'/0'/${i}/0`,
    privateKey: HEX(i + 1),
  }));
  if (withCustom) {
    // One custom entry has no derivePath; it is keyed by address.
    list.push({address: '0xcustom', privateKey: HEX(99), isCustom: true});
  }
  return list;
};

const mnemonicWallet = () => ({
  clientId: 'w-mnemonic',
  walletName: 'Main',
  phrase: MNEMONIC,
  isBackedup: true,
  hideSettings: {
    isHidden: true,
    relockOption: 'RELAUNCH',
    secretCodeHash: 'a'.repeat(64),
    secretCodeSalt: 'b'.repeat(32),
    secretCodeIterations: 100000,
    hideNotification: true,
  },
  coins: [
    {
      _id: 'coin-eth',
      chain_name: 'ethereum',
      symbol: 'ETH',
      address: '0xaddr0',
      publicKey: '0xpub',
      privateKey: HEX(1),
      deriveAddresses: evmDerives(50, {withCustom: true}),
      transactions: [{hash: TX_HASH, amount: '1'}],
    },
    {
      _id: 'coin-usdt',
      chain_name: 'ethereum',
      symbol: 'USDT',
      address: '0xaddr0',
      privateKey: HEX(1),
      deriveAddresses: evmDerives(50, {withCustom: true}),
    },
    {
      _id: 'coin-btc',
      chain_name: 'bitcoin',
      symbol: 'BTC',
      address: 'bc1q...',
      privateKey: WIF,
      extendedPrivateKey: XPRV,
      extendedPublicKey: 'xpub661MyMwAqRbcF...',
      deriveAddresses: [
        {address: 'bc1qa', derivePath: "m/84'/0'/0'/0/0", privateKey: WIF},
        // Watch-only style entry: no key at all.
        {address: 'bc1qb', derivePath: "m/84'/0'/0'/0/1"},
      ],
      UTXOs: [{txid: 'ab'.repeat(32), vout: 0}],
    },
    {
      _id: 'coin-usdc-added',
      chain_name: 'polygon',
      symbol: 'USDC',
      address: '0xaddr0',
      phrase: MNEMONIC,
      privateKey: HEX(1),
    },
  ],
  chain_existing_coin: {
    ethereum: {address: '0xaddr0', publicKey: '0xpub', privateKey: HEX(1)},
    bitcoin: {
      address: 'bc1q...',
      privateKey: WIF,
      extendedPrivateKey: XPRV,
      extendedPublicKey: 'xpub661MyMwAqRbcF...',
    },
  },
  walletData: {
    'session-1': {
      'eip155:1': {
        address: '0xaddr0',
        privateKey: HEX(1),
        chain_name: 'ethereum',
      },
    },
    'session-2': [{address: 'bc1q...', privateKey: WIF}],
  },
});

const privateKeyWallet = () => ({
  clientId: 'w-pk',
  walletName: 'Imported',
  privateKey: HEX(7),
  isImportWalletWithPrivateKey: true,
  chain_name: 'ethereum',
  coins: [
    {
      _id: 'coin-eth-pk',
      chain_name: 'ethereum',
      symbol: 'ETH',
      address: '0xpk',
      privateKey: HEX(7),
    },
  ],
  chain_existing_coin: {ethereum: {address: '0xpk', privateKey: HEX(7)}},
});

const fixtures = () => [mnemonicWallet(), privateKeyWallet()];

describe('walletSecrets', () => {
  describe('stripWalletSecrets', () => {
    it('removes every secret and passes assertNoSecrets', () => {
      const stripped = stripAllWalletsSecrets(fixtures());
      expect(() => assertNoSecrets(stripped)).not.toThrow();
      const [m, pk] = stripped;
      expect(m.phrase).toBeUndefined();
      expect(pk.privateKey).toBeUndefined();
      expect(m.coins[0].privateKey).toBeUndefined();
      expect(m.coins[2].extendedPrivateKey).toBeUndefined();
      expect(m.coins[3].phrase).toBeUndefined();
      expect(m.coins[0].deriveAddresses[0].privateKey).toBeUndefined();
      expect(m.chain_existing_coin.bitcoin.extendedPrivateKey).toBeUndefined();
      expect(m.hideSettings.secretCodeHash).toBeUndefined();
      expect(m.hideSettings.secretCodeSalt).toBeUndefined();
      expect(m.walletData['session-1']['eip155:1'].privateKey).toBeUndefined();
      expect(m.walletData['session-2'][0].privateKey).toBeUndefined();
    });

    it('keeps everything that is not a secret', () => {
      const m = stripWalletSecrets(mnemonicWallet());
      expect(m.walletName).toBe('Main');
      expect(m.isBackedup).toBe(true);
      expect(m.hideSettings).toEqual({
        isHidden: true,
        relockOption: 'RELAUNCH',
        hideNotification: true,
      });
      expect(m.coins[0].address).toBe('0xaddr0');
      expect(m.coins[0].publicKey).toBe('0xpub');
      expect(m.coins[0].transactions).toEqual([{hash: TX_HASH, amount: '1'}]);
      expect(m.coins[0].deriveAddresses).toHaveLength(51);
      expect(m.coins[0].deriveAddresses[50]).toEqual({
        address: '0xcustom',
        isCustom: true,
      });
      expect(m.coins[2].extendedPublicKey).toBe('xpub661MyMwAqRbcF...');
      expect(m.coins[2].UTXOs).toHaveLength(1);
      expect(m.chain_existing_coin.bitcoin.address).toBe('bc1q...');
      expect(m.walletData['session-1']['eip155:1'].address).toBe('0xaddr0');
    });

    it('never mutates its input', () => {
      const wallet = mnemonicWallet();
      const snapshot = JSON.stringify(wallet);
      stripWalletSecrets(wallet);
      expect(JSON.stringify(wallet)).toBe(snapshot);
    });

    it('tolerates non-object input and wallets with no coins', () => {
      expect(stripWalletSecrets(null)).toBeNull();
      expect(stripWalletSecrets({clientId: 'x'})).toEqual({clientId: 'x'});
    });
  });

  describe('extractVaultPayload', () => {
    it('collapses EVM derive keys onto one family and keys coins by chain_symbol', () => {
      const payload = extractVaultPayload(fixtures());
      expect(payload.v).toBe(1);
      const m = payload.wallets['w-mnemonic'];
      expect(m.phrase).toBe(MNEMONIC);
      expect(m.privateKey).toBeUndefined();
      expect(m.hideSettings).toEqual({
        secretCodeHash: 'a'.repeat(64),
        secretCodeSalt: 'b'.repeat(32),
        secretCodeIterations: 100000,
      });
      expect(Object.keys(m.coins).sort()).toEqual([
        'bitcoin_BTC',
        'ethereum_ETH',
        'ethereum_USDT',
        'polygon_USDC',
      ]);
      expect(m.coins.bitcoin_BTC).toEqual({
        privateKey: WIF,
        extendedPrivateKey: XPRV,
        _id: 'coin-btc',
      });
      expect(m.coins.polygon_USDC.phrase).toBe(MNEMONIC);
      // ETH + USDT share one 'evm' family: 50 paths + 1 custom address key.
      expect(Object.keys(m.deriveKeys)).toEqual(['evm', 'bitcoin']);
      expect(Object.keys(m.deriveKeys.evm)).toHaveLength(51);
      expect(m.deriveKeys.evm['0xcustom']).toBe(HEX(99));
      expect(m.deriveKeys.bitcoin).toEqual({"m/84'/0'/0'/0/0": WIF});
      expect(m.chainExisting).toEqual({
        ethereum: {privateKey: HEX(1)},
        bitcoin: {privateKey: WIF, extendedPrivateKey: XPRV},
      });

      const pk = payload.wallets['w-pk'];
      expect(pk.privateKey).toBe(HEX(7));
      expect(pk.phrase).toBeUndefined();
      expect(pk.coins.ethereum_ETH.privateKey).toBe(HEX(7));
      expect(pk.deriveKeys).toEqual({});
    });

    it('skips wallets without a clientId', () => {
      expect(extractVaultPayload([{phrase: MNEMONIC}]).wallets).toEqual({});
    });
  });

  describe('hydrateWalletSecrets', () => {
    it('hydrate(strip(w), extract(w)) deep-equals w', () => {
      const wallets = fixtures();
      const payload = extractVaultPayload(wallets);
      const stripped = stripAllWalletsSecrets(wallets);
      const hydrated = hydrateWalletSecrets(stripped, payload);
      // walletData is stripped but deliberately not re-hydrated.
      const expected = wallets.map(w =>
        w.walletData ? {...w, walletData: stripWalletSecrets(w).walletData} : w,
      );
      expect(hydrated).toEqual(expected);
    });

    it('never overwrites an existing value and never writes undefined', () => {
      const wallet = mnemonicWallet();
      const payload = extractVaultPayload([wallet]);
      // Memory already has a (different) key for one derive entry.
      const inMemory = stripWalletSecrets(wallet);
      inMemory.coins[0].deriveAddresses[0].privateKey = 'already-here';
      const [hydrated] = hydrateWalletSecrets([inMemory], payload);
      expect(hydrated.coins[0].deriveAddresses[0].privateKey).toBe(
        'already-here',
      );
      expect(hydrated.coins[0].deriveAddresses[1].privateKey).toBe(HEX(2));
      // Watch-only BTC entry stays without a privateKey key at all.
      expect('privateKey' in hydrated.coins[2].deriveAddresses[1]).toBe(false);
    });

    it('leaves wallets with no vault entry untouched (same reference)', () => {
      const stripped = stripWalletSecrets(privateKeyWallet());
      const [out] = hydrateWalletSecrets([stripped], {v: 1, wallets: {}});
      expect(out).toBe(stripped);
    });

    it('returns input for malformed payloads', () => {
      const wallets = fixtures();
      expect(hydrateWalletSecrets(wallets, null)).toBe(wallets);
      expect(hydrateWalletSecrets(wallets, {})).toBe(wallets);
    });
  });

  describe('findWalletsMissingSecrets', () => {
    it('lists clientIds that the payload does not cover', () => {
      const wallets = fixtures();
      const payload = extractVaultPayload([wallets[0]]);
      expect(findWalletsMissingSecrets(wallets, payload)).toEqual(['w-pk']);
      expect(
        findWalletsMissingSecrets(wallets, extractVaultPayload(wallets)),
      ).toEqual([]);
    });
  });

  describe('assertNoSecrets / findSecretPaths', () => {
    it('finds secrets by key name', () => {
      expect(findSecretPaths({a: {privateKey: 'x'}})).toEqual(['a.privateKey']);
      expect(findSecretPaths({phrase: 'x'})).toEqual(['phrase']);
      expect(findSecretPaths({list: [{extendedPrivateKey: 'x'}]})).toEqual([
        'list[0].extendedPrivateKey',
      ]);
      expect(findSecretPaths({hideSettings: {secretCodeSalt: 'ab'}})).toEqual([
        'hideSettings.secretCodeSalt',
      ]);
    });

    it('finds secrets by value shape under innocent keys', () => {
      expect(findSecretPaths({note: MNEMONIC})).toEqual(['note']);
      expect(findSecretPaths({k: XPRV})).toEqual(['k']);
      expect(findSecretPaths({k: WIF})).toEqual(['k']);
      expect(findSecretPaths({k: HEX(5)})).toEqual(['k']);
    });

    it('allows public 64-hex under hash-like keys', () => {
      expect(
        findSecretPaths({
          hash: TX_HASH,
          txid: 'ab'.repeat(32),
          publicKey: HEX(3),
          transactions: [{hash: TX_HASH}],
        }),
      ).toEqual([]);
      expect(findSecretPaths({foo: TX_HASH}, {allowHexKeys: ['foo']})).toEqual(
        [],
      );
    });

    it('ignores empty secret fields', () => {
      expect(findSecretPaths({privateKey: '', phrase: null})).toEqual([]);
    });

    it('assertNoSecrets throws with the offending paths', () => {
      expect(() => assertNoSecrets(fixtures())).toThrow(/phrase/);
    });
  });

  it('exposes the field lists for the scrubber and transforms', () => {
    expect(SECRET_WALLET_FIELDS.coin).toEqual([
      'privateKey',
      'extendedPrivateKey',
      'phrase',
    ]);
    expect(getDeriveFamily('ethereum')).toBe('evm');
    expect(getDeriveFamily('polygon')).toBe('evm');
    expect(getDeriveFamily('bitcoin')).toBe('bitcoin');
  });

  it('vaultPayloadHasSecrets distinguishes key material from empty entries', () => {
    expect(vaultPayloadHasSecrets(extractVaultPayload(fixtures()))).toBe(true);
    expect(
      vaultPayloadHasSecrets(
        extractVaultPayload(stripAllWalletsSecrets(fixtures())),
      ),
    ).toBe(false);
    expect(vaultPayloadHasSecrets({v: 1, wallets: {}})).toBe(false);
    expect(vaultPayloadHasSecrets(null)).toBe(false);
    expect(
      vaultPayloadHasSecrets({
        v: 1,
        wallets: {a: {deriveKeys: {evm: {'m/0': 'k'}}}},
      }),
    ).toBe(true);
  });
});
