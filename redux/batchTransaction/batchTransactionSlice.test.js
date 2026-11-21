/**
 * The in-app batch is one execute() call per chain and address, and the batch
 * contract takes at most BATCH_MAX_CALLS calls, so a 33rd transfer is refused
 * when it is added rather than failing later at the fee estimate.
 *
 *   npx jest dok-wallet-blockchain-networks/redux/batchTransaction/batchTransactionSlice.test.js
 */
import {addBatchTransaction} from 'dok-wallet-blockchain-networks/redux/batchTransaction/batchTransactionSlice';
import {getNativeCoin} from 'dok-wallet-blockchain-networks/service/wallet.service';
import {showToast} from 'utils/toast';

jest.mock('dok-wallet-blockchain-networks/service/wallet.service', () => ({
  fetchBatchTransactionBalances: jest.fn(),
  getNativeCoin: jest.fn(),
}));
jest.mock(
  'dok-wallet-blockchain-networks/redux/wallets/walletsSelector',
  () => ({
    selectCurrentWallet: () => ({clientId: 'w1'}),
  }),
);
jest.mock('dok-wallet-blockchain-networks/service/coinMarketCap', () => ({
  getPrice: jest.fn(),
}));
jest.mock(
  'dok-wallet-blockchain-networks/redux/settings/settingsSelectors',
  () => ({getLocalCurrency: () => 'USD'}),
);
jest.mock('dok-wallet-blockchain-networks/helper', () => ({
  createBalanceKey: jest.fn(),
  getCustomizePublicAddress: jest.fn(),
}));
jest.mock('utils/toast', () => ({showToast: jest.fn()}));

const ADDRESS = '0x2222222222222222222222222222222222222222';
const OTHER_ADDRESS = '0x4444444444444444444444444444444444444444';
const CALL = {to: '0x1111111111111111111111111111111111111111', value: 1n};

const queued = (count, {chain_name = 'ethereum', address = ADDRESS} = {}) =>
  Array.from({length: count}, (_, i) => ({
    transactionId: `${chain_name}-${address}-${i}`,
    coinInfo: {chain_name, address},
  }));

const add = existing =>
  addBatchTransaction({
    transactionId: 'new',
    selectedCoin: {chain_name: 'ethereum', address: ADDRESS},
    transferData: {amount: '1'},
  })(
    jest.fn(),
    () => ({batchTransaction: {transactions: {w1: existing}}}),
    undefined,
  );

describe('addBatchTransaction batch size', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    getNativeCoin.mockResolvedValue({createCall: jest.fn(async () => CALL)});
    jest.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('refuses a 33rd transfer for the same chain and address', async () => {
    const action = await add(queued(32));

    expect(action.payload).toBe('Batch is full');
    expect(getNativeCoin).not.toHaveBeenCalled();
    expect(showToast).toHaveBeenCalledWith({
      type: 'errorToast',
      title: 'Batch is full',
      message:
        'This batch already has 32 transfers; at most 32 can be sent together. Send it first, then add more.',
    });
  });

  it('adds up to the limit', async () => {
    const action = await add(queued(31));

    expect(action.payload.transaction.calls).toBe(CALL);
    expect(showToast).not.toHaveBeenCalled();
  });

  it('counts only the batch the transfer joins', async () => {
    const action = await add([
      ...queued(32, {address: OTHER_ADDRESS}),
      ...queued(32, {chain_name: 'base'}),
    ]);

    expect(action.payload.transaction.calls).toBe(CALL);
  });
});
