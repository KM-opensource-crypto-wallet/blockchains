import {
  initWalletConnect,
  subscribeWalletConnectEvent,
} from 'dok-wallet-blockchain-networks/service/walletconnect';
import {store} from 'redux/store';
import {setWalletConnectTransactionData} from 'dok-wallet-blockchain-networks/redux/walletConnect/walletConnectSlice';
import {showToast} from 'utils/toast';
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

// The handler de-duplicates by request id, so every request needs its own.
let nextId = 42;
let lastId;
const sessionRequest = (method, params, chainId = 'stellar:testnet') => {
  lastId = nextId++;
  return {
    id: lastId,
    topic: 'topic-1',
    params: {chainId, request: {method, params}},
  };
};

describe('onSessionRequest: unsupported WalletConnect methods', () => {
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

  it('replies -32601 to the dApp, toasts, logs, and never opens the modal', async () => {
    await handlers.session_request(
      sessionRequest('stellar_signAuthEntry', {xdr: 'AAAA'}),
    );

    expect(mockWalletKit.respondSessionRequest).toHaveBeenCalledTimes(1);
    const {topic, response} =
      mockWalletKit.respondSessionRequest.mock.calls[0][0];
    expect(topic).toBe('topic-1');
    expect(response.id).toBe(lastId);
    expect(response.jsonrpc).toBe('2.0');
    expect(response.error.code).toBe(-32601);
    expect(response.error.message).toContain('stellar_signAuthEntry');
    expect(response.result).toBeUndefined();

    expect(setWalletConnectTransactionData).not.toHaveBeenCalled();
    expect(store.dispatch).not.toHaveBeenCalled();

    expect(showToast).toHaveBeenCalledTimes(1);
    expect(showToast.mock.calls[0][0].type).toBe('errorToast');
    expect(showToast.mock.calls[0][0].message).toContain(
      'stellar_signAuthEntry',
    );

    expect(logWalletConnectEvent).toHaveBeenCalledWith(
      'warn',
      'session_request.unsupported_method',
      expect.objectContaining({
        method: 'stellar_signAuthEntry',
        chainId: 'stellar:testnet',
        peerName: 'AppKit',
        requestId: lastId,
      }),
    );
  });

  it('routes a supported method to the transaction modal without any error reply', async () => {
    await handlers.session_request(
      sessionRequest('personal_sign', ['0xdead', '0xabc'], 'eip155:11155111'),
    );

    expect(mockWalletKit.respondSessionRequest).not.toHaveBeenCalled();
    expect(setWalletConnectTransactionData).toHaveBeenCalledTimes(1);
    expect(setWalletConnectTransactionData.mock.calls[0][0]).toMatchObject({
      method: 'personal_sign',
      chainId: 'eip155:11155111',
      topic: 'topic-1',
      id: lastId,
    });
    expect(store.dispatch).toHaveBeenCalledTimes(1);
    expect(showToast).not.toHaveBeenCalled();
    expect(logWalletConnectEvent).not.toHaveBeenCalled();
  });

  it('still auto-answers the special-cased wallet_getCapabilities', async () => {
    await handlers.session_request(
      sessionRequest(
        'wallet_getCapabilities',
        ['0xabc', ['0x1', '0xaa36a7']],
        'eip155:1',
      ),
    );

    expect(mockWalletKit.respondSessionRequest).toHaveBeenCalledTimes(1);
    const {response} = mockWalletKit.respondSessionRequest.mock.calls[0][0];
    expect(response.error).toBeUndefined();
    expect(response.result).toEqual({
      '0x1': {atomicBatch: {supported: true}},
      '0xaa36a7': {atomicBatch: {supported: true}},
    });
    expect(showToast).not.toHaveBeenCalled();
  });

  it('does not throw when the error reply itself fails, and logs it', async () => {
    mockWalletKit.respondSessionRequest.mockRejectedValueOnce(
      new Error('relay down'),
    );

    await expect(
      handlers.session_request(sessionRequest('stellar_signAuthEntry', {})),
    ).resolves.toBeUndefined();

    expect(logWalletConnectEvent).toHaveBeenCalledWith(
      'error',
      'session_request.handler_error',
      expect.objectContaining({
        method: 'stellar_signAuthEntry',
        requestId: lastId,
        message: 'relay down',
      }),
    );
  });
});
