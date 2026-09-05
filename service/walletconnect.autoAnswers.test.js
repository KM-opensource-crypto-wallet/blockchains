/**
 * session_request methods answered by the handler itself, without the
 * transaction modal: hedera_getNodeAddresses (HIP-820, read-only),
 * wallet_switchEthereumChain (EIP-3326), wallet_addEthereumChain (EIP-3085)
 * and wallet_getCapabilities. Same mock scaffold and runner as
 * walletconnect.unsupportedMethod.test.js.
 */
import {
  initWalletConnect,
  subscribeWalletConnectEvent,
} from 'dok-wallet-blockchain-networks/service/walletconnect';
import {store} from 'redux/store';
import {setWalletConnectTransactionData} from 'dok-wallet-blockchain-networks/redux/walletConnect/walletConnectSlice';
import {showToast} from 'utils/toast';
import {HederaChain} from 'dok-wallet-blockchain-networks/cryptoChain/chains/HederaChain';
import {CHAIN_ID} from 'dok-wallet-blockchain-networks/config/config';
import {logWalletConnectEvent} from 'utils/logger';

const HEDERA_EVM_KEY = `eip155:${CHAIN_ID.hedera}`;
const HEDERA_EVM_HEX = `0x${CHAIN_ID.hedera.toString(16)}`;

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
          peer: {metadata: {name: 'Hedera dApp', url: 'https://dapp.test'}},
          namespaces: {
            eip155: {
              chains: [HEDERA_EVM_KEY],
              accounts: [`${HEDERA_EVM_KEY}:0xabc`],
              methods: ['personal_sign', 'wallet_switchEthereumChain'],
              events: ['chainChanged'],
            },
          },
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
const mockGetNodeAddresses = jest.fn(async ({network}) => ({
  nodes: [`0.0.3-${network}`, `0.0.4-${network}`],
}));
jest.mock(
  'dok-wallet-blockchain-networks/cryptoChain/chains/HederaChain',
  () => ({
    HederaChain: jest.fn(() => ({getNodeAddresses: mockGetNodeAddresses})),
  }),
);

let nextId = 7;
let lastId;
const sessionRequest = (method, params, chainId) => {
  lastId = nextId++;
  return {
    id: lastId,
    topic: 'topic-1',
    params: {chainId, request: {method, params}},
  };
};

describe('onSessionRequest: hedera_getNodeAddresses', () => {
  beforeAll(async () => {
    await initWalletConnect({id: 'project', metadata: {}});
    subscribeWalletConnectEvent();
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('answers with the node list of the requested network without opening the modal', async () => {
    await handlers.session_request(
      sessionRequest('hedera_getNodeAddresses', undefined, 'hedera:testnet'),
    );

    expect(mockGetNodeAddresses).toHaveBeenCalledWith({network: 'testnet'});
    expect(mockWalletKit.respondSessionRequest).toHaveBeenCalledTimes(1);
    expect(mockWalletKit.respondSessionRequest.mock.calls[0][0]).toEqual({
      topic: 'topic-1',
      response: {
        id: lastId,
        jsonrpc: '2.0',
        result: {nodes: ['0.0.3-testnet', '0.0.4-testnet']},
      },
    });
    expect(setWalletConnectTransactionData).not.toHaveBeenCalled();
    expect(store.dispatch).not.toHaveBeenCalled();
    expect(showToast).not.toHaveBeenCalled();
  });

  it('replies with a JSON-RPC error when fetching the node list fails', async () => {
    mockGetNodeAddresses.mockRejectedValueOnce(new Error('mirror node down'));

    await handlers.session_request(
      sessionRequest('hedera_getNodeAddresses', undefined, 'hedera:testnet'),
    );

    expect(mockWalletKit.respondSessionRequest).toHaveBeenCalledTimes(1);
    expect(mockWalletKit.respondSessionRequest.mock.calls[0][0]).toEqual({
      topic: 'topic-1',
      response: {
        id: lastId,
        jsonrpc: '2.0',
        error: {
          code: -32603,
          message: 'mirror node down',
          data: {method: 'hedera_getNodeAddresses', chainId: 'hedera:testnet'},
        },
      },
    });
    expect(logWalletConnectEvent).toHaveBeenCalledWith(
      'error',
      'session_request.handler_error',
      expect.objectContaining({
        method: 'hedera_getNodeAddresses',
        requestId: lastId,
        message: 'mirror node down',
      }),
    );
    expect(setWalletConnectTransactionData).not.toHaveBeenCalled();
  });

  it('swallows a relay failure while sending that error reply, and logs it', async () => {
    mockGetNodeAddresses.mockRejectedValueOnce(new Error('mirror node down'));
    mockWalletKit.respondSessionRequest.mockRejectedValueOnce(
      new Error('relay down'),
    );

    await expect(
      handlers.session_request(
        sessionRequest('hedera_getNodeAddresses', undefined, 'hedera:testnet'),
      ),
    ).resolves.toBeUndefined();

    expect(mockWalletKit.respondSessionRequest).toHaveBeenCalledTimes(1);
    expect(logWalletConnectEvent).toHaveBeenCalledWith(
      'error',
      'session_request.error_reply_failed',
      expect.objectContaining({
        method: 'hedera_getNodeAddresses',
        requestId: lastId,
        message: 'relay down',
      }),
    );
  });

  it('does not send an error reply for modal-bound methods that fail before the modal opens', async () => {
    store.dispatch.mockImplementationOnce(() => {
      throw new Error('store exploded');
    });

    await handlers.session_request(
      sessionRequest(
        'hedera_signMessage',
        {signerAccountId: 'hedera:testnet:0.0.5', message: 'hi'},
        'hedera:testnet',
      ),
    );

    expect(mockWalletKit.respondSessionRequest).not.toHaveBeenCalled();
    expect(logWalletConnectEvent).toHaveBeenCalledWith(
      'error',
      'session_request.handler_error',
      expect.objectContaining({method: 'hedera_signMessage'}),
    );
  });

  it('still routes signer-bound hedera methods to the transaction modal', async () => {
    await handlers.session_request(
      sessionRequest(
        'hedera_signMessage',
        {signerAccountId: 'hedera:testnet:0.0.5', message: 'hi'},
        'hedera:testnet',
      ),
    );

    expect(mockWalletKit.respondSessionRequest).not.toHaveBeenCalled();
    expect(setWalletConnectTransactionData).toHaveBeenCalledTimes(1);
    expect(setWalletConnectTransactionData.mock.calls[0][0]).toMatchObject({
      method: 'hedera_signMessage',
      chainId: 'hedera:testnet',
      id: lastId,
    });
    expect(HederaChain).not.toHaveBeenCalled();
  });

  it('routes the newly supported hedera_signAndExecuteQuery to the modal instead of -32601', async () => {
    await handlers.session_request(
      sessionRequest(
        'hedera_signAndExecuteQuery',
        {signerAccountId: 'hedera:testnet:0.0.5', query: 'AA=='},
        'hedera:testnet',
      ),
    );

    expect(mockWalletKit.respondSessionRequest).not.toHaveBeenCalled();
    expect(setWalletConnectTransactionData).toHaveBeenCalledTimes(1);
  });
});

describe('onSessionRequest: EVM chain switching (EIP-3326 / EIP-3085)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  const lastResponse = () =>
    mockWalletKit.respondSessionRequest.mock.calls[0][0].response;

  it('switches to a chain the session was approved for with a null result', async () => {
    await handlers.session_request(
      sessionRequest(
        'wallet_switchEthereumChain',
        [{chainId: HEDERA_EVM_HEX}],
        HEDERA_EVM_KEY,
      ),
    );

    expect(mockWalletKit.respondSessionRequest).toHaveBeenCalledTimes(1);
    expect(lastResponse()).toEqual({id: lastId, jsonrpc: '2.0', result: null});
    expect(setWalletConnectTransactionData).not.toHaveBeenCalled();
    expect(showToast).not.toHaveBeenCalled();
  });

  it('answers 4902 for a chain outside the session instead of -32601', async () => {
    await handlers.session_request(
      sessionRequest(
        'wallet_switchEthereumChain',
        [{chainId: '0x1'}],
        HEDERA_EVM_KEY,
      ),
    );

    expect(lastResponse().error).toMatchObject({code: 4902});
    expect(setWalletConnectTransactionData).not.toHaveBeenCalled();
  });

  it('accepts wallet_addEthereumChain only for chains this wallet serves', async () => {
    await handlers.session_request(
      sessionRequest(
        'wallet_addEthereumChain',
        [{chainId: HEDERA_EVM_HEX, chainName: 'Hedera Testnet'}],
        HEDERA_EVM_KEY,
      ),
    );
    expect(lastResponse()).toEqual({id: lastId, jsonrpc: '2.0', result: null});

    jest.clearAllMocks();
    await handlers.session_request(
      sessionRequest(
        'wallet_addEthereumChain',
        [{chainId: '0x539', chainName: 'Localhost'}],
        HEDERA_EVM_KEY,
      ),
    );
    expect(lastResponse().error).toMatchObject({code: -32602});
  });

  it('logs every incoming session_request so delivery can be checked from the logs', async () => {
    await handlers.session_request(
      sessionRequest('personal_sign', ['0xdead', '0xabc'], HEDERA_EVM_KEY),
    );

    expect(logWalletConnectEvent).toHaveBeenCalledWith(
      'info',
      'session_request.received',
      expect.objectContaining({
        method: 'personal_sign',
        chainId: HEDERA_EVM_KEY,
        topic: 'topic-1',
        requestId: lastId,
      }),
    );
  });
});

describe('onSessionRequest: wallet_getCapabilities', () => {
  it('only claims atomic batching for chains that have a batch contract', async () => {
    await handlers.session_request(
      sessionRequest(
        'wallet_getCapabilities',
        ['0xabc', ['0x1', '0x127']],
        'eip155:1',
      ),
    );

    const {response} = mockWalletKit.respondSessionRequest.mock.calls[0][0];
    expect(response.result['0x1']).toEqual({atomic: {status: 'supported'}});
    // 0x127 = 295, Hedera's relay: no batch contract there.
    expect(response.result['0x127']).toEqual({
      atomic: {status: 'unsupported'},
    });
  });
});
