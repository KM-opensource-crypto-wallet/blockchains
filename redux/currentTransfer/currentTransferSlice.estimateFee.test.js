import {configureStore} from '@reduxjs/toolkit';
import {
  calculateEstimateFee,
  currentTransferSlice,
} from 'dok-wallet-blockchain-networks/redux/currentTransfer/currentTransferSlice';
import {getNativeCoin} from 'dok-wallet-blockchain-networks/service/wallet.service';

// The chain estimate is the boundary under test: whatever getEstimateFee
// returns is what the Transfer screen's amount is clamped against.
jest.mock('dok-wallet-blockchain-networks/service/wallet.service', () => ({
  fetchBatchTransactionBalances: jest.fn(),
  getNativeCoin: jest.fn(),
}));
jest.mock('utils/toast', () => ({showToast: jest.fn()}));

// DOKWALLET-WALLET-WEB-1J: TRX Max right after a TRC20 send. The cached TRX
// balance still says 100; the energy that send burned left 80 on chain.
const trx = {
  _id: 'trx',
  chain_name: 'tron',
  chain_symbol: 'TRX',
  symbol: 'TRX',
  type: 'coin',
  totalAmount: '100',
};

const initial = currentTransferSlice.getInitialState();

const makeStore = () =>
  configureStore({
    reducer: {
      currentTransfer: currentTransferSlice.reducer,
      wallets: (state = {allWallets: []}) => state,
      cryptoProvider: (state = {}) => state,
    },
    preloadedState: {
      currentTransfer: {
        ...initial,
        transferData: {
          ...initial.transferData,
          currentCoin: trx,
          amount: '100',
          initialAmount: '100',
          isSendFunds: true,
        },
      },
    },
    middleware: getDefaultMiddleware =>
      getDefaultMiddleware({serializableCheck: false, immutableCheck: false}),
  });

const estimateWith = async estimate => {
  getNativeCoin.mockResolvedValue({
    getEstimateFee: jest.fn(async () => estimate),
  });
  const store = makeStore();
  await store.dispatch(
    calculateEstimateFee({
      fromAddress: 'from',
      toAddress: 'to',
      amount: '100',
      currentCoin: trx,
    }),
  );
  return store.getState().currentTransfer.transferData;
};

describe('calculateEstimateFee: sending the whole balance', () => {
  it('clamps to the live spendable balance the chain reports', async () => {
    const transfer = await estimateWith({fee: '0.5', spendableBalance: '80'});

    expect(transfer.amount).toBe('79.5');
    expect(transfer.isMax).toBe(true);
  });

  it('clamps to the cached balance when the chain reports none', async () => {
    const transfer = await estimateWith({fee: '0.5'});

    expect(transfer.amount).toBe('99.5');
    expect(transfer.isMax).toBe(true);
  });
});
