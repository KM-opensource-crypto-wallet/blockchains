// initiateSellCryptoTransfer signs with the LIVE coin: the persisted
// requestDetails copies (selectedFromWallet, selectedFromAsset) are stripped of
// their keys at rest, so after a relaunch they are keyless stubs.
jest.mock('dok-wallet-blockchain-networks/service/dokApi', () => ({
  getSellCryptoUrl: jest.fn(),
  getSellCryptoPaymentDetails: jest.fn(),
  getSellCryptoQuote: jest.fn(),
}));
jest.mock(
  'dok-wallet-blockchain-networks/redux/currentTransfer/currentTransferSlice',
  () => ({
    calculateEstimateFee: payload => ({type: 'test/estimate', payload}),
    updateCurrentTransferData: payload => ({type: 'test/update', payload}),
    setCurrentTransferCustomError: payload => ({
      type: 'test/customError',
      payload,
    }),
  }),
);

import {
  initiateSellCryptoTransfer,
  SELL_WALLET_MISSING_MESSAGE,
} from 'dok-wallet-blockchain-networks/redux/sellCrypto/sellCryptoSlice';

const HEX = i => `0x${String(i).padStart(2, '0').repeat(32)}`;

const liveCoin = {
  _id: 'c1',
  chain_name: 'ethereum',
  symbol: 'USDT',
  address: '0xA0',
  contractAddress: '0xToken',
  privateKey: HEX(1),
};
const strippedAsset = {
  _id: 'c1',
  chain_name: 'ethereum',
  symbol: 'USDT',
  address: '0xa0',
  contractAddress: '0xtoken',
};

const run = async ({asset, wallets}) => {
  const dispatched = [];
  const getState = () => ({
    wallets: {allWallets: wallets},
    sellCrypto: {
      requestDetails: {
        selectedFromWallet: {clientId: 'w1', walletName: 'Main'},
        selectedFromAsset: asset,
      },
      transferDetails: {
        depositAddress: '0xdep',
        depositAmount: '1',
        memo: null,
      },
    },
  });
  await initiateSellCryptoTransfer()(
    a => dispatched.push(a),
    getState,
    undefined,
  );
  return {
    dispatched,
    update: dispatched.find(a => a.type === 'test/update')?.payload,
    estimate: dispatched.find(a => a.type === 'test/estimate')?.payload,
  };
};

describe('initiateSellCryptoTransfer', () => {
  it('uses the live coin (matched by _id) and the live wallet', async () => {
    const wallet = {
      clientId: 'w1',
      walletName: 'Main',
      phrase: 'm',
      coins: [liveCoin],
    };
    const {update, estimate} = await run({
      asset: strippedAsset,
      wallets: [wallet],
    });
    expect(update.currentCoin).toBe(liveCoin);
    expect(estimate.selectedCoin).toBe(liveCoin);
    expect(estimate.selectedWallet).toBe(wallet);
    expect(estimate.fromAddress).toBe('0xA0');
    expect(estimate.toAddress).toBe('0xdep');
  });

  it('falls back to chain + address + contract when the id differs', async () => {
    const renamed = {...liveCoin, _id: 'other'};
    const wallet = {
      clientId: 'w1',
      coins: [{...liveCoin, _id: 'x', contractAddress: '0xOther'}, renamed],
    };
    const {estimate} = await run({asset: strippedAsset, wallets: [wallet]});
    expect(estimate.selectedCoin).toBe(renamed);
  });

  it('falls back to the stored coin stub when the live wallet has no match', async () => {
    const wallet = {
      clientId: 'w1',
      phrase: 'm',
      coins: [{...liveCoin, _id: 'x', contractAddress: '0xOther'}],
    };
    const {update, estimate} = await run({
      asset: strippedAsset,
      wallets: [wallet],
    });
    expect(update.currentCoin).toBe(strippedAsset);
    expect(estimate.selectedCoin).toBe(strippedAsset);
    expect(estimate.selectedWallet).toBe(wallet);
  });

  it('refuses to continue when the live wallet is gone', async () => {
    const spy = jest.spyOn(console, 'error').mockImplementation(() => {});
    const {dispatched, update, estimate} = await run({
      asset: strippedAsset,
      wallets: [],
    });
    spy.mockRestore();
    expect(update).toBeUndefined();
    expect(estimate).toBeUndefined();
    expect(dispatched).toEqual(
      expect.arrayContaining([
        {
          type: 'sellCrypto/setSellCryptoError',
          payload: SELL_WALLET_MISSING_MESSAGE,
        },
        {type: 'test/customError', payload: SELL_WALLET_MISSING_MESSAGE},
      ]),
    );
  });
});
