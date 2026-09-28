import {
  selectAllCoins,
  selectAllCoinsAcrossWallet,
  selectAllCoinSymbol,
  selectAllCoinsWalletByMnemonic,
  selectAllCoinWithIsInWalletSymbol,
  selectAllWalletConnectSessions,
  selectAllWalletName,
  selectCoinsForCurrentWallet,
  selectOtherCoins,
  selectUserCoins,
  selectWalletConnectData,
  selectWalletConnectSessions,
  getEthereumCoin,
  getPendingTransactions,
  getSelectedNft,
  getSelectedNftData,
} from 'dok-wallet-blockchain-networks/redux/wallets/walletsSelector';

// react-redux's dev stabilityCheck calls a selector twice with the same state
// and warns when the results differ by reference. Every selector here must
// return the identical reference for an unchanged state.

const eth = {
  _id: 'c1',
  chain_name: 'ethereum',
  symbol: 'ETH',
  type: 'coin',
  isInWallet: true,
};
const btc = {
  _id: 'c2',
  chain_name: 'bitcoin',
  symbol: 'BTC',
  type: 'coin',
  isInWallet: false,
};

// vault-v2: the wallets slice is empty until unlockWithPassword.
const lockedState = {wallets: {allWallets: [], currentWalletClientId: null}};

const unlockedState = {
  wallets: {
    currentWalletClientId: 'w1',
    pendingTransactions: {k: []},
    allWallets: [
      {
        clientId: 'w1',
        walletName: 'Main',
        phrase: 'seed',
        coins: [eth, btc],
        session: {t1: {topic: 't1'}},
        walletData: {t1: {address: '0x1'}},
        selectedNftChain: 'Ethereum',
        nft: {Ethereum_data: [{id: 'n1'}]},
        selectedNft: {id: 'n1'},
      },
      {
        clientId: 'w2',
        walletName: 'Other',
        coins: [btc],
        session: {t2: {topic: 't2'}},
        walletData: {t2: {address: '0x2'}},
      },
    ],
  },
};

const selectors = {
  selectCoinsForCurrentWallet,
  selectAllCoins,
  selectUserCoins,
  selectOtherCoins,
  selectAllCoinSymbol,
  selectAllCoinWithIsInWalletSymbol,
  selectAllWalletName,
  selectAllCoinsAcrossWallet,
  selectAllCoinsWalletByMnemonic,
  selectAllWalletConnectSessions,
  selectWalletConnectSessions,
  selectWalletConnectData,
  getEthereumCoin,
  getPendingTransactions,
  getSelectedNft,
  getSelectedNftData,
};

describe('wallets selectors return stable references', () => {
  describe.each([
    ['locked (empty wallets)', lockedState],
    ['unlocked', unlockedState],
  ])('%s', (_, state) => {
    it.each(Object.entries(selectors))('%s', (__, selector) => {
      expect(selector(state)).toBe(selector(state));
    });
  });
});

describe('wallets selectors keep their values', () => {
  it('locked state falls back to empty values', () => {
    expect(selectAllCoins(lockedState)).toEqual([]);
    expect(selectUserCoins(lockedState)).toEqual([]);
    expect(selectOtherCoins(lockedState)).toEqual([]);
    expect(selectAllCoinSymbol(lockedState)).toEqual([]);
    expect(selectAllCoinWithIsInWalletSymbol(lockedState)).toEqual({});
    expect(selectAllWalletName(lockedState)).toEqual([]);
    expect(selectAllCoinsAcrossWallet(lockedState)).toEqual([]);
    expect(selectAllCoinsWalletByMnemonic(lockedState)).toEqual([]);
    expect(selectAllWalletConnectSessions(lockedState)).toEqual({});
    expect(selectWalletConnectSessions(lockedState)).toEqual({});
    expect(selectWalletConnectData(lockedState)).toEqual({});
    expect(getEthereumCoin(lockedState)).toEqual({});
    expect(getPendingTransactions(lockedState)).toEqual({});
    expect(getSelectedNft(lockedState)).toEqual({});
    expect(getSelectedNftData(lockedState)).toEqual([]);
  });

  it('unlocked state derives the same data as before', () => {
    const s = unlockedState;
    expect(selectAllCoins(s)).toEqual([eth, btc]);
    expect(selectUserCoins(s)).toEqual([eth]);
    expect(selectOtherCoins(s)).toEqual([btc]);
    expect(selectAllCoinSymbol(s)).toHaveLength(2);
    expect(Object.values(selectAllCoinWithIsInWalletSymbol(s))).toEqual([
      true,
      false,
    ]);
    expect(selectAllWalletName(s)).toEqual(['Main', 'Other']);
    expect(selectAllCoinsAcrossWallet(s)).toEqual([eth, btc, btc]);
    expect(selectAllCoinsWalletByMnemonic(s)).toEqual([eth, btc]);
    expect(selectAllWalletConnectSessions(s)).toEqual({
      t1: {topic: 't1'},
      t2: {topic: 't2'},
    });
    expect(selectWalletConnectSessions(s)).toEqual({t1: {topic: 't1'}});
    expect(selectWalletConnectData(s)).toEqual({
      t1: {address: '0x1'},
      t2: {address: '0x2'},
    });
    expect(getEthereumCoin(s)).toBe(eth);
    expect(getPendingTransactions(s)).toEqual({k: []});
    expect(getSelectedNft(s)).toEqual({id: 'n1'});
    expect(getSelectedNftData(s)).toEqual([{id: 'n1'}]);
  });

  it('recomputes when the wallets change', () => {
    const before = selectUserCoins(unlockedState);
    const next = {
      wallets: {
        ...unlockedState.wallets,
        allWallets: [
          {
            ...unlockedState.wallets.allWallets[0],
            coins: [eth, {...btc, isInWallet: true}],
          },
          unlockedState.wallets.allWallets[1],
        ],
      },
    };
    const after = selectUserCoins(next);
    expect(after).not.toBe(before);
    expect(after).toHaveLength(2);
  });
});
