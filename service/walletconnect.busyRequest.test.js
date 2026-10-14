import {
  initWalletConnect,
  subscribeWalletConnectEvent,
} from 'dok-wallet-blockchain-networks/service/walletconnect';
import {store} from 'redux/store';
import {setWalletConnectTransactionData} from 'dok-wallet-blockchain-networks/redux/walletConnect/walletConnectSlice';
import {logWalletConnectEvent} from 'utils/logger';

const handlers = {};
const mockWalletKit = {
  on: jest.fn((event, cb) => {
    handlers[event] = cb;
  }),
  respondSessionRequest: jest.fn(() => Promise.resolve()),
  engine: {
    signClient: {
      session: {
        get: jest.fn(() => ({
          pairingTopic: 'pairing-1',
          peer: {metadata: {name: 'AppKit', url: 'https://lab.reown.com'}},
        })),
      },
    },
  },
};

jest.mock('redux/store', () => ({
  store: {dispatch: jest.fn(), getState: jest.fn(() => ({}))},
}));
jest.mock('@walletconnect/core', () => ({Core: jest.fn()}));
jest.mock('@reown/walletkit', () => ({
  WalletKit: {init: jest.fn(() => Promise.resolve(mockWalletKit))},
}));
jest.mock('@walletconnect/utils', () => ({
  getSdkError: jest.fn(key => ({code: 0, message: key})),
}));
jest.mock(
  'dok-wallet-blockchain-networks/redux/walletConnect/walletConnectSlice',
  () => ({
    resetWalletConnect: jest.fn(() => ({type: 'reset'})),
    setWalletConnectRequestData: jest.fn(p => ({type: 'requestData', p})),
    setWalletConnectRequestModal: jest.fn(p => ({type: 'requestModal', p})),
    setWalletConnectTransactionData: jest.fn(p => ({type: 'txData', p})),
  }),
);
jest.mock('dok-wallet-blockchain-networks/redux/wallets/walletsSlice', () => ({
  removeWalletConnectSession: jest.fn(),
}));
jest.mock('utils/toast', () => ({showToast: jest.fn()}), {virtual: true});
jest.mock('utils/logger', () => ({logWalletConnectEvent: jest.fn()}), {
  virtual: true,
});

let nextId = 100;
let lastId;
const sessionRequest = (method, params, chainId = 'eip155:137') => {
  lastId = nextId++;
  return {
    id: lastId,
    topic: 'topic-1',
    params: {chainId, request: {method, params}},
  };
};

const busy = () => ({walletConnect: {transactionModalVisible: true}});
const idle = () => ({walletConnect: {transactionModalVisible: false}});

describe('onSessionRequest: a request arriving while one is on screen', () => {
  beforeAll(async () => {
    await initWalletConnect({id: 'project', metadata: {}});
    subscribeWalletConnectEvent();
  });

  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    console.error.mockRestore();
  });

  it('replies -32002, logs, and never replaces the pending request', async () => {
    store.getState.mockImplementation(busy);
    await handlers.session_request(
      sessionRequest('eth_sendTransaction', [{from: '0xa', to: '0xb'}]),
    );

    expect(mockWalletKit.respondSessionRequest).toHaveBeenCalledTimes(1);
    const {topic, response} =
      mockWalletKit.respondSessionRequest.mock.calls[0][0];
    expect(topic).toBe('topic-1');
    expect(response).toMatchObject({
      id: lastId,
      jsonrpc: '2.0',
      error: {code: -32002},
    });
    expect(response.error.message).toMatch(/pending/i);
    expect(setWalletConnectTransactionData).not.toHaveBeenCalled();
    expect(store.dispatch).not.toHaveBeenCalled();
    expect(logWalletConnectEvent).toHaveBeenCalledWith(
      'warn',
      'session_request.busy_rejected',
      expect.objectContaining({
        method: 'eth_sendTransaction',
        chainId: 'eip155:137',
        requestId: lastId,
        peerName: 'AppKit',
      }),
    );
  });

  it('still auto-answers wallet_getCapabilities while busy', async () => {
    store.getState.mockImplementation(busy);
    await handlers.session_request(
      sessionRequest('wallet_getCapabilities', ['0xabc', ['0x1']], 'eip155:1'),
    );

    expect(mockWalletKit.respondSessionRequest).toHaveBeenCalledTimes(1);
    const {response} = mockWalletKit.respondSessionRequest.mock.calls[0][0];
    expect(response.error).toBeUndefined();
    expect(response.result).toEqual({'0x1': {atomic: {status: 'supported'}}});
  });

  it('still rejects unsupported methods with -32601 while busy', async () => {
    store.getState.mockImplementation(busy);
    await handlers.session_request(
      sessionRequest('stellar_signAuthEntry', {}, 'stellar:testnet'),
    );

    const {response} = mockWalletKit.respondSessionRequest.mock.calls[0][0];
    expect(response.error.code).toBe(-32601);
  });

  it('routes the request to the modal when nothing is pending', async () => {
    store.getState.mockImplementation(idle);
    await handlers.session_request(
      sessionRequest('eth_sendTransaction', [{from: '0xa', to: '0xb'}]),
    );

    expect(mockWalletKit.respondSessionRequest).not.toHaveBeenCalled();
    expect(setWalletConnectTransactionData).toHaveBeenCalledTimes(1);
    expect(setWalletConnectTransactionData.mock.calls[0][0]).toMatchObject({
      method: 'eth_sendTransaction',
      id: lastId,
    });
  });

  it('tolerates a store without the walletConnect slice', async () => {
    store.getState.mockImplementation(() => ({}));
    await handlers.session_request(
      sessionRequest('eth_sendTransaction', [{from: '0xa', to: '0xb'}]),
    );

    expect(mockWalletKit.respondSessionRequest).not.toHaveBeenCalled();
    expect(setWalletConnectTransactionData).toHaveBeenCalledTimes(1);
  });

  it('does not throw when the busy reply itself fails, and logs it', async () => {
    store.getState.mockImplementation(busy);
    mockWalletKit.respondSessionRequest.mockRejectedValueOnce(
      new Error('relay down'),
    );

    await expect(
      handlers.session_request(
        sessionRequest('eth_sendTransaction', [{from: '0xa', to: '0xb'}]),
      ),
    ).resolves.toBeUndefined();

    expect(logWalletConnectEvent).toHaveBeenCalledWith(
      'error',
      'session_request.handler_error',
      expect.objectContaining({requestId: lastId, message: 'relay down'}),
    );
  });
});
