import {configureStore} from '@reduxjs/toolkit';
import {
  walletConnect,
  walletsSlice,
} from 'dok-wallet-blockchain-networks/redux/wallets/walletsSlice';
import {walletConnectSlice} from 'dok-wallet-blockchain-networks/redux/walletConnect/walletConnectSlice';
import {getCoin} from 'dok-wallet-blockchain-networks/cryptoChain';
import {getWalletConnect} from 'dok-wallet-blockchain-networks/service/walletconnect';
import {showToast} from 'utils/toast';

// Web-runnable sibling of walletsSlice.walletConnect.test.js (that suite needs
// redux-mock-store and the mobile notification shim). Here a real store runs
// the thunk; the chain executor and the WalletKit connector are the doubles.
jest.mock('dok-wallet-blockchain-networks/cryptoChain', () => ({
  getChain: jest.fn(),
  getCoin: jest.fn(),
  getHashString: jest.fn(v => v),
}));
jest.mock('myWallet/wallet.service', () => ({
  addCustomDeriveAddressToWallet: jest.fn(),
  addDeriveAddresses: jest.fn(),
  generateMnemonics: jest.fn(),
}));
jest.mock('dok-wallet-blockchain-networks/service/dokApi', () => ({
  fetchCoinByChainAPI: jest.fn(),
  fetchCurrenciesAPI: jest.fn(),
  registerUserAPI: jest.fn(() => Promise.resolve()),
  reportExchangeTransactionHash: jest.fn(),
}));
jest.mock('dok-wallet-blockchain-networks/service/coinMarketCap', () => ({
  getPrice: jest.fn(() => Promise.resolve({})),
}));
jest.mock('dok-wallet-blockchain-networks/service/walletconnect', () => ({
  getWalletConnect: jest.fn(),
  recordIssuedBatch: jest.fn(),
}));
jest.mock('utils/toast', () => ({showToast: jest.fn(() => 'toast-1')}));

// DOKWALLET-WALLET-WEB-1T: a DFlow solana_signTransaction the user acted on
// nine minutes after it arrived.
const CHAIN = 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp';
const ADDRESS = '7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU';
const REQUEST_ID = 1795590787571795;
const TOPIC = 'topic-1';
const RECORD_DELETED = `Missing or invalid. Record was recently deleted - request: ${REQUEST_ID}`;

const EVM_ADDRESS = '0x2222222222222222222222222222222222222222';

const wallet = {
  clientId: 'client1',
  walletName: 'Main',
  phrase: 'x',
  coins: [
    {
      _id: 'sol',
      chain_name: 'solana',
      type: 'coin',
      address: ADDRESS,
      symbol: 'SOL',
    },
    {
      _id: 'eth',
      chain_name: 'ethereum',
      type: 'coin',
      address: EVM_ADDRESS,
      symbol: 'ETH',
    },
  ],
};

const nowSeconds = () => Math.floor(Date.now() / 1000);

// WalletKit's pending-request record (PendingRequestTypes.Struct).
const pendingRecord = expiryTimestamp => ({
  id: REQUEST_ID,
  topic: TOPIC,
  params: {
    chainId: CHAIN,
    request: {method: 'solana_signTransaction', params: {}, expiryTimestamp},
  },
  verifyContext: {verified: {validation: 'VALID'}},
});

const executor = {signRawTransaction: jest.fn(async () => 'signed-tx')};
let connector;

const makeStore = () =>
  configureStore({
    reducer: {
      wallets: walletsSlice.reducer,
      walletConnect: walletConnectSlice.reducer,
    },
    preloadedState: {
      wallets: {
        ...walletsSlice.getInitialState(),
        allWallets: [wallet],
        currentWalletClientId: 'client1',
      },
      walletConnect: {
        ...walletConnectSlice.getInitialState(),
        transactionRequestData: {
          id: REQUEST_ID,
          topic: TOPIC,
          chainId: CHAIN,
          method: 'solana_signTransaction',
        },
      },
    },
    middleware: getDefaultMiddleware =>
      getDefaultMiddleware({serializableCheck: false, immutableCheck: false}),
  });

const approve = store =>
  store.dispatch(
    walletConnect({
      chain_name: 'solana',
      chainId: CHAIN,
      id: REQUEST_ID,
      topic: TOPIC,
      method: 'solana_signTransaction',
      walletAddress: ADDRESS,
      privateKey: 'key',
      domain: 'https://dflow.net',
      transactionData: {},
    }),
  );

const toastTypes = () => showToast.mock.calls.map(([options]) => options.type);
const pendingOnScreen = store =>
  store.getState().walletConnect.transactionRequestData;

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(console, 'error').mockImplementation(() => {});
  connector = {
    getPendingSessionRequests: jest.fn(() => [
      pendingRecord(nowSeconds() + 300),
    ]),
    respondSessionRequest: jest.fn(async () => {}),
  };
  getWalletConnect.mockImplementation(() => connector);
  getCoin.mockResolvedValue({chain: executor});
});

afterEach(() => {
  console.error.mockRestore();
});

describe('walletConnect thunk: request liveness', () => {
  it('signs and answers a request that is still live', async () => {
    const store = makeStore();

    const action = await approve(store);

    expect(action.meta.requestStatus).toBe('fulfilled');
    expect(executor.signRawTransaction).toHaveBeenCalledTimes(1);
    expect(connector.respondSessionRequest).toHaveBeenCalledWith({
      topic: TOPIC,
      response: {id: REQUEST_ID, result: 'signed-tx', jsonrpc: '2.0'},
    });
    expect(pendingOnScreen(store)).toBeNull();
  });

  it('refuses a request WalletKit no longer holds, before signing or replying', async () => {
    connector.getPendingSessionRequests.mockReturnValue([]);
    const store = makeStore();

    const action = await approve(store);

    expect(action.meta.requestStatus).toBe('rejected');
    expect(action.payload).toBe('request_expired');
    expect(executor.signRawTransaction).not.toHaveBeenCalled();
    expect(connector.respondSessionRequest).not.toHaveBeenCalled();
    expect(toastTypes()).toEqual(['errorToast']);
    expect(pendingOnScreen(store)).toBeNull();
  });

  it('refuses a request past its expiry even while still listed (relay was offline)', async () => {
    connector.getPendingSessionRequests.mockReturnValue([
      pendingRecord(nowSeconds() - 1),
    ]);
    const store = makeStore();

    const action = await approve(store);

    expect(action.payload).toBe('request_expired');
    expect(executor.signRawTransaction).not.toHaveBeenCalled();
    expect(connector.respondSessionRequest).not.toHaveBeenCalled();
  });

  it('refuses to sign a request that expired while the coin was loading', async () => {
    // Live when the thunk starts, gone by the time it is ready to sign.
    connector.getPendingSessionRequests
      .mockReturnValueOnce([pendingRecord(nowSeconds() + 300)])
      .mockReturnValue([]);
    const store = makeStore();

    const action = await approve(store);

    expect(action.payload).toBe('request_expired');
    expect(executor.signRawTransaction).not.toHaveBeenCalled();
    expect(connector.respondSessionRequest).not.toHaveBeenCalled();
    // The expiry message replaces the "Please wait" progress toast.
    expect(
      showToast.mock.calls.map(([options]) => [options.type, options.toastId]),
    ).toEqual([
      ['progressToast', undefined],
      ['errorToast', 'toast-1'],
    ]);
    expect(pendingOnScreen(store)).toBeNull();
  });

  it('refuses to broadcast a batch whose request expired during fee estimation', async () => {
    const batchChain = {
      getEstimateFeeForBatchTransaction: jest.fn(async () => {
        connector.getPendingSessionRequests.mockReturnValue([]);
        return {nonce: 1, gasFee: '1', estimateGas: '21000'};
      }),
      sendBatchTransaction: jest.fn(async () => '0xbatch'),
    };
    getCoin.mockResolvedValue({
      chain: batchChain,
      waitForConfirmation: jest.fn(),
    });
    const store = makeStore();

    const action = await store.dispatch(
      walletConnect({
        chain_name: 'ethereum',
        chainId: 'eip155:1',
        id: REQUEST_ID,
        topic: TOPIC,
        method: 'wallet_sendCalls',
        walletAddress: EVM_ADDRESS,
        privateKey: 'key',
        domain: 'https://dapp.test',
        transactionData: {
          batchCalls: [
            {
              to: '0x1111111111111111111111111111111111111111',
              value: '0x0',
              data: '0x',
            },
          ],
        },
      }),
    );

    expect(action.payload).toBe('request_expired');
    expect(batchChain.getEstimateFeeForBatchTransaction).toHaveBeenCalledTimes(
      1,
    );
    expect(batchChain.sendBatchTransaction).not.toHaveBeenCalled();
    expect(connector.respondSessionRequest).not.toHaveBeenCalled();
  });

  it('proceeds as before when the connector cannot list pending requests', async () => {
    delete connector.getPendingSessionRequests;
    const store = makeStore();

    const action = await approve(store);

    expect(action.meta.requestStatus).toBe('fulfilled');
    expect(executor.signRawTransaction).toHaveBeenCalledTimes(1);
  });
});

describe('walletConnect thunk: failed replies', () => {
  it('reports the work as done when only the reply fails, never "Transaction failed"', async () => {
    // Expired between the check and the reply: what was signed or sent is
    // already out, so retrying could send twice.
    connector.respondSessionRequest.mockRejectedValue(
      new Error(RECORD_DELETED),
    );
    const store = makeStore();

    const action = await approve(store);

    expect(action.meta.requestStatus).toBe('fulfilled');
    expect(connector.respondSessionRequest).toHaveBeenCalledTimes(1);
    expect(toastTypes()).toEqual(['progressToast', 'warningToast']);
    expect(pendingOnScreen(store)).toBeNull();
  });

  it('still shows the failure when the error reply itself fails', async () => {
    executor.signRawTransaction.mockRejectedValueOnce(new Error('boom'));
    connector.respondSessionRequest.mockRejectedValue(
      new Error(RECORD_DELETED),
    );
    const store = makeStore();

    const action = await approve(store);

    expect(action.meta.requestStatus).toBe('rejected');
    expect(action.payload).toBe('boom');
    expect(showToast).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'errorToast',
        title: 'Transaction failed',
      }),
    );
    expect(pendingOnScreen(store)).toBeNull();
  });
});
