import {
  initWalletConnect,
  rejectSessionRequest,
} from 'dok-wallet-blockchain-networks/service/walletconnect';
import {logWalletConnectEvent} from 'utils/logger';

const mockWalletKit = {
  on: jest.fn(),
  respondSessionRequest: jest.fn(() => Promise.resolve()),
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

// DOKWALLET-WALLET-WEB-1T: rejecting a request nine minutes after it arrived.
const ID = 1795590787571795;
const RECORD_DELETED = `Missing or invalid. Record was recently deleted - request: ${ID}`;

beforeAll(async () => {
  await initWalletConnect({id: 'project', metadata: {}});
});

beforeEach(() => {
  jest.clearAllMocks();
});

describe('rejectSessionRequest', () => {
  it('answers the dApp with a user rejection', async () => {
    await rejectSessionRequest({id: ID, topic: 'topic-1'});

    expect(mockWalletKit.respondSessionRequest).toHaveBeenCalledWith({
      topic: 'topic-1',
      response: {
        id: ID,
        jsonrpc: '2.0',
        error: {code: 5000, message: 'User rejected.'},
      },
    });
  });

  it('settles and logs when WalletKit no longer holds the request', async () => {
    mockWalletKit.respondSessionRequest.mockRejectedValueOnce(
      new Error(RECORD_DELETED),
    );

    await expect(
      rejectSessionRequest({id: ID, topic: 'topic-1'}),
    ).resolves.toBeUndefined();
    expect(logWalletConnectEvent).toHaveBeenCalledWith(
      'warn',
      'session_request.reject_reply_failed',
      expect.objectContaining({requestId: ID, message: RECORD_DELETED}),
    );
  });
});
