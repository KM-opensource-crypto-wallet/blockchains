import {
  AUTH_PERSIST_BLACKLIST,
  WALLETS_REFRESH_RESET,
  WALLET_PERSIST_LIMITS,
  batchTransactionPersistTransform,
  createMessagePersistTransform,
  createWalletsPersistTransform,
  recentTransactions,
  schedulePaymentPersistTransform,
  sellCryptoPersistTransform,
  slimWalletForPersist,
} from 'dok-wallet-blockchain-networks/redux/storage/persistTransforms';
import {assertNoSecrets} from 'dok-wallet-blockchain-networks/redux/wallets/walletSecrets';

const HEX = i => `0x${String(i).padStart(2, '0').repeat(32)}`;
const wallet = (clientId, relockOption) => ({
  clientId,
  phrase: 'abandon '.repeat(11) + 'about',
  hideSettings: {isHidden: false, relockOption, secretCodeHash: 'a'.repeat(64)},
  coins: [
    {chain_name: 'ethereum', symbol: 'ETH', address: '0xa', privateKey: HEX(1)},
  ],
});

describe('persistTransforms', () => {
  it('auth blacklist covers the password and transient flags', () => {
    expect(AUTH_PERSIST_BLACKLIST).toEqual([
      'password',
      'loading',
      'error',
      'isVaultUnlocked',
    ]);
  });

  describe('wallets', () => {
    const transform = createWalletsPersistTransform({
      manualRelockOption: 'MANUAL',
    });

    it('inbound allWallets: forces isHidden for non-MANUAL relock, then strips secrets', () => {
      const out = transform.in(
        [wallet('a', 'RELAUNCH'), wallet('b', 'MANUAL')],
        'allWallets',
      );
      expect(out[0].hideSettings.isHidden).toBe(true);
      expect(out[1].hideSettings.isHidden).toBe(false);
      expect(() => assertNoSecrets(out)).not.toThrow();
      expect(out[0].hideSettings.relockOption).toBe('RELAUNCH');
    });

    it('inbound other fields pass through', () => {
      expect(transform.in('w1', 'currentWalletClientId')).toBe('w1');
    });

    it('outbound resets in-flight refresh flags only', () => {
      expect(transform.out(true, 'isRefreshingAllWallets')).toBe(false);
      expect(transform.out('w1', 'refreshingWalletClientId')).toBeNull();
      expect(transform.out({w1: 'r'}, 'refreshCoinsRequestIds')).toEqual({});
      expect(transform.out('w1', 'currentWalletClientId')).toBe('w1');
      expect(Object.keys(WALLETS_REFRESH_RESET)).toHaveLength(3);
    });
  });

  it('schedulePayment outbound resets submit flags', () => {
    expect(schedulePaymentPersistTransform.out(true, 'isSubmitting')).toBe(
      false,
    );
    expect(schedulePaymentPersistTransform.out(3, 'pendingSubmitCount')).toBe(
      0,
    );
    expect(
      schedulePaymentPersistTransform.out([1], 'scheduledPayments'),
    ).toEqual([1]);
    expect(schedulePaymentPersistTransform.in(true, 'isSubmitting')).toBe(true);
  });

  it('sellCrypto inbound strips the embedded wallet', () => {
    const out = sellCryptoPersistTransform.in(
      {amount: '1', selectedFromWallet: wallet('a', 'MANUAL')},
      'requestDetails',
    );
    expect(out.amount).toBe('1');
    expect(out.selectedFromWallet.clientId).toBe('a');
    expect(() => assertNoSecrets(out)).not.toThrow();
    expect(
      sellCryptoPersistTransform.in({amount: '1'}, 'requestDetails'),
    ).toEqual({
      amount: '1',
    });
  });

  it('batchTransaction inbound strips coinInfo secrets', () => {
    const out = batchTransactionPersistTransform.in(
      {
        w1: [
          {amount: '1', coinInfo: {chain_name: 'ethereum', privateKey: HEX(2)}},
        ],
      },
      'transactions',
    );
    expect(out.w1[0].coinInfo).toEqual({chain_name: 'ethereum'});
    expect(batchTransactionPersistTransform.in('x', 'other')).toBe('x');
  });

  describe('slimming (Phase 4)', () => {
    const tx = (i, date) => ({hash: `h${i}`, date});

    it('recentTransactions keeps the newest N by date and preserves order when undated', () => {
      const dated = Array.from({length: 5}, (_, i) => tx(i, 1000 + i));
      expect(recentTransactions(dated, 2).map(t => t.hash)).toEqual([
        'h4',
        'h3',
      ]);
      expect(recentTransactions(dated, 10)).toBe(dated);
      const undated = [{hash: 'a'}, {hash: 'b'}, {hash: 'c'}];
      expect(recentTransactions(undated, 2).map(t => t.hash)).toEqual([
        'a',
        'b',
      ]);
      expect(recentTransactions(undefined, 2)).toBeUndefined();
    });

    it('slimWalletForPersist caps transactions, drops nft, slims walletData', () => {
      const many = Array.from({length: 250}, (_, i) => tx(i, i));
      const w = {
        clientId: 'a',
        nft: {Ethereum_data: [{big: true}]},
        selectedNftChain: 'Ethereum',
        coins: [
          {
            chain_name: 'ethereum',
            symbol: 'ETH',
            transactions: many,
            UTXOs: [1],
          },
          {chain_name: 'bitcoin', symbol: 'BTC'},
        ],
        walletData: {
          s1: [
            {
              key: 'eip155:1',
              address: '0xa',
              symbol: 'ETH',
              currencyRate: '1',
              transactions: many,
              deriveAddresses: [{address: '0xa'}],
              staking: [1],
            },
          ],
        },
      };
      const out = slimWalletForPersist(w);
      expect(out.nft).toBeUndefined();
      expect(out.selectedNftChain).toBe('Ethereum');
      expect(out.coins[0].transactions).toHaveLength(200);
      expect(out.coins[0].transactions[0].hash).toBe('h249');
      expect(out.coins[0].UTXOs).toEqual([1]);
      expect(out.coins[1]).toBe(w.coins[1]);
      expect(out.walletData.s1[0]).toEqual({
        key: 'eip155:1',
        address: '0xa',
        symbol: 'ETH',
        currencyRate: '1',
      });
      // Input untouched.
      expect(w.coins[0].transactions).toHaveLength(250);
      expect(w.nft).toBeDefined();
    });

    it('the wallets transform applies slimming after stripping', () => {
      const transform = createWalletsPersistTransform({
        maxTransactionsPerCoin: 3,
      });
      const many = Array.from({length: 10}, (_, i) => tx(i, i));
      const out = transform.in(
        [
          {
            ...wallet('a', 'MANUAL'),
            nft: {x: 1},
            coins: [
              {
                chain_name: 'ethereum',
                symbol: 'ETH',
                privateKey: HEX(1),
                transactions: many,
              },
            ],
          },
        ],
        'allWallets',
      );
      expect(out[0].nft).toBeUndefined();
      expect(out[0].coins[0].privateKey).toBeUndefined();
      expect(out[0].coins[0].transactions.map(t => t.hash)).toEqual([
        'h9',
        'h8',
        'h7',
      ]);
      expect(WALLET_PERSIST_LIMITS.maxTransactionsPerCoin).toBe(200);
    });

    it('message transform keeps the newest messages per conversation', () => {
      const transform = createMessagePersistTransform({
        maxMessagesPerConversation: 2,
      });
      const out = transform.in(
        {t1: [{id: 'new'}, {id: 'mid'}, {id: 'old'}], t2: [{id: 'x'}]},
        'messageData',
      );
      expect(out.t1.map(m => m.id)).toEqual(['new', 'mid']);
      expect(out.t2).toHaveLength(1);
      expect(transform.in({a: 1}, 'conversationData')).toEqual({a: 1});
      expect(WALLET_PERSIST_LIMITS.maxMessagesPerConversation).toBe(100);
    });
  });
});
