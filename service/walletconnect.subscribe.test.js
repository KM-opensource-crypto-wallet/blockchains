/**
 * subscribeWalletConnectEvent must register the WalletKit listeners once per
 * client. It is called on every pairing and once per restored session, and
 * duplicate handlers used to deliver the same session_request several times;
 * with the one-request-at-a-time rule that meant the request on screen was
 * busy-rejected by its own duplicates and the dApp saw a failure.
 *
 *   npx jest dok-wallet-blockchain-networks/service/walletconnect.subscribe.test.js
 */
import {
  initWalletConnect,
  subscribeWalletConnectEvent,
} from 'dok-wallet-blockchain-networks/service/walletconnect';
import {store} from 'redux/store';
import {setWalletConnectTransactionData} from 'dok-wallet-blockchain-networks/redux/walletConnect/walletConnectSlice';
import {logWalletConnectEvent} from 'utils/logger';
import {WalletKit} from '@reown/walletkit';

const makeWalletKit = () => {
  const handlers = {};
  const kit = {
    handlers,
    // A real emitter keeps every listener, so duplicates must show up here.
    on: jest.fn((event, cb) => {
      handlers[event] = [...(handlers[event] || []), cb];
    }),
    off: jest.fn((event, cb) => {
      handlers[event] = (handlers[event] || []).filter(h => h !== cb);
    }),
    emit: async (event, payload) => {
      for (const handler of handlers[event] || []) {
        await handler(payload);
      }
    },
    respondSessionRequest: jest.fn(() => Promise.resolve()),
    engine: {
      signClient: {
        session: {
          get: jest.fn(() => ({
            pairingTopic: 'pairing-1',
            peer: {
              metadata: {
                name: 'PancakeSwap',
                url: 'https://pancakeswap.finance',
              },
            },
          })),
        },
      },
    },
  };
  return kit;
};
let currentKit;

jest.mock('redux/store', () => ({
  store: {dispatch: jest.fn(), getState: jest.fn(() => ({}))},
}));
jest.mock('@walletconnect/core', () => ({Core: jest.fn()}));
jest.mock('@reown/walletkit', () => ({
  WalletKit: {init: jest.fn()},
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

let nextId = 500;
const sessionRequest = id => ({
  id,
  topic: 'topic-1',
  params: {
    chainId: 'eip155:97',
    request: {
      method: 'eth_sendTransaction',
      params: [{from: '0xa', to: '0xb'}],
    },
  },
});

describe('subscribeWalletConnectEvent', () => {
  beforeEach(async () => {
    jest.clearAllMocks();
    jest.spyOn(console, 'error').mockImplementation(() => {});
    currentKit = makeWalletKit();
    WalletKit.init.mockResolvedValue(currentKit);
    await initWalletConnect({id: 'project', metadata: {}});
  });
  afterEach(() => {
    console.error.mockRestore();
  });

  it('registers each event once however often it is called for the same client', () => {
    subscribeWalletConnectEvent();
    subscribeWalletConnectEvent(); // a pairing
    subscribeWalletConnectEvent(); // a restored session
    expect(currentKit.on).toHaveBeenCalledTimes(3);
    expect(currentKit.on.mock.calls.map(c => c[0]).sort()).toEqual([
      'session_delete',
      'session_proposal',
      'session_request',
    ]);
  });

  it('delivers one session_request to the modal exactly once after repeated subscribes', async () => {
    subscribeWalletConnectEvent();
    subscribeWalletConnectEvent();
    store.getState.mockImplementation(() => ({
      walletConnect: {
        transactionModalVisible: false,
        transactionRequestData: null,
      },
    }));
    const id = nextId++;
    await currentKit.emit('session_request', sessionRequest(id));
    expect(setWalletConnectTransactionData).toHaveBeenCalledTimes(1);
    expect(store.dispatch).toHaveBeenCalledTimes(1);
    expect(currentKit.respondSessionRequest).not.toHaveBeenCalled();
  });

  it('ignores a redelivery of the request that is already on screen', async () => {
    subscribeWalletConnectEvent();
    const id = nextId++;
    store.getState.mockImplementation(() => ({
      walletConnect: {
        transactionModalVisible: true,
        transactionRequestData: {id, method: 'eth_sendTransaction'},
      },
    }));
    await currentKit.emit('session_request', sessionRequest(id));
    expect(currentKit.respondSessionRequest).not.toHaveBeenCalled();
    expect(setWalletConnectTransactionData).not.toHaveBeenCalled();
    expect(logWalletConnectEvent).not.toHaveBeenCalledWith(
      'warn',
      'session_request.busy_rejected',
      expect.anything(),
    );
  });

  it('still busy-rejects a different request while one is on screen', async () => {
    subscribeWalletConnectEvent();
    const onScreen = nextId++;
    store.getState.mockImplementation(() => ({
      walletConnect: {
        transactionModalVisible: true,
        transactionRequestData: {id: onScreen, method: 'eth_sendTransaction'},
      },
    }));
    await currentKit.emit('session_request', sessionRequest(nextId++));
    expect(currentKit.respondSessionRequest).toHaveBeenCalledTimes(1);
    expect(
      currentKit.respondSessionRequest.mock.calls[0][0].response.error.code,
    ).toBe(-32002);
  });

  it('moves the listeners when the client is re-initialised', async () => {
    subscribeWalletConnectEvent();
    const oldKit = currentKit;
    currentKit = makeWalletKit();
    WalletKit.init.mockResolvedValue(currentKit);
    await initWalletConnect({id: 'project', metadata: {}});
    subscribeWalletConnectEvent();
    expect(oldKit.off).toHaveBeenCalledTimes(3);
    expect(Object.values(oldKit.handlers).flat()).toHaveLength(0);
    expect(Object.values(currentKit.handlers).flat()).toHaveLength(3);
    expect(currentKit.on).toHaveBeenCalledTimes(3);
  });
});
