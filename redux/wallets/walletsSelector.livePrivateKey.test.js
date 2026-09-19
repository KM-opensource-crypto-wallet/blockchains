import {selectLivePrivateKey} from 'dok-wallet-blockchain-networks/redux/wallets/walletsSelector';

const HEX = i => `0x${String(i).padStart(2, '0').repeat(32)}`;

const state = {
  wallets: {
    currentWalletClientId: 'w2',
    allWallets: [
      {
        clientId: 'w1',
        coins: [
          {
            chain_name: 'ethereum',
            symbol: 'ETH',
            address: '0xAAA',
            privateKey: HEX(1),
            deriveAddresses: [
              {
                address: '0xAAA',
                derivePath: "m/44'/60'/0'/0/0",
                privateKey: HEX(1),
              },
              {
                address: '0xBBB',
                derivePath: "m/44'/60'/0'/1/0",
                privateKey: HEX(2),
              },
            ],
          },
        ],
        chain_existing_coin: {tron: {address: 'TTT', privateKey: HEX(5)}},
      },
      {
        clientId: 'w2',
        coins: [
          {
            chain_name: 'ethereum',
            symbol: 'ETH',
            address: '0xCCC',
            privateKey: HEX(3),
          },
          // Stripped at rest and not yet hydrated: no key.
          {chain_name: 'bitcoin', symbol: 'BTC', address: 'bc1q'},
        ],
      },
    ],
  },
};

describe('selectLivePrivateKey', () => {
  it('matches the coin address case-insensitively', () => {
    expect(
      selectLivePrivateKey(state, {chain_name: 'Ethereum', address: '0xaaa'}),
    ).toBe(HEX(1));
  });

  it('falls back to derive addresses', () => {
    expect(
      selectLivePrivateKey(state, {chain_name: 'ethereum', address: '0xbbb'}),
    ).toBe(HEX(2));
  });

  it('prefers the current wallet, then searches the others', () => {
    expect(
      selectLivePrivateKey(state, {chain_name: 'ethereum', address: '0xCCC'}),
    ).toBe(HEX(3));
    expect(
      selectLivePrivateKey(state, {
        chain_name: 'ethereum',
        address: '0xAAA',
        clientId: 'w1',
      }),
    ).toBe(HEX(1));
  });

  it('uses chain_existing_coin when no coin carries the address', () => {
    expect(
      selectLivePrivateKey(state, {chain_name: 'tron', address: 'ttt'}),
    ).toBe(HEX(5));
  });

  it('returns undefined when the coin has no key or nothing matches', () => {
    expect(
      selectLivePrivateKey(state, {chain_name: 'bitcoin', address: 'bc1q'}),
    ).toBeUndefined();
    expect(
      selectLivePrivateKey(state, {chain_name: 'solana', address: 'x'}),
    ).toBeUndefined();
    expect(
      selectLivePrivateKey({wallets: {}}, {chain_name: 'x', address: 'y'}),
    ).toBeUndefined();
  });
});
