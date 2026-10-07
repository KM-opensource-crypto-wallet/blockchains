/**
 * walletConnect thunk: an approved eth_sendTransaction / eth_signTransaction
 * must be bound to the request the user reviewed (KIML-002). The thunk rebuilds
 * the canonical tx from the store's pending request and refuses when the
 * modal's digest or request id does not match; the executor only ever sees
 * that store-derived object.
 *
 *   npx jest dok-wallet-blockchain-networks/redux/wallets/walletsSlice.walletConnect.test.js
 */
import {thunk} from 'redux-thunk';
import configureMockStore from 'redux-mock-store';
import {walletConnect} from 'dok-wallet-blockchain-networks/redux/wallets/walletsSlice';
import {
  buildEvmWalletConnectTx,
  getEvmWalletConnectTxDigest,
} from 'dok-wallet-blockchain-networks/helper/evmTxReview';
import {getCoin} from 'dok-wallet-blockchain-networks/cryptoChain';
import {getWalletConnect} from 'dok-wallet-blockchain-networks/service/walletconnect';
import {showToast} from 'utils/toast';

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
}));
jest.mock('utils/toast', () => ({showToast: jest.fn()}));

const FROM = '0x2222222222222222222222222222222222222222';
const TO = '0x1111111111111111111111111111111111111111';
const CHAIN = 'eip155:1';
const REQUEST_ID = 1001;
const TOPIC = 'topic-1';

const params0 = {
  from: FROM,
  to: TO,
  data: '0x095ea7b3',
  value: '0x0',
  gas: '0x5208',
  gasPrice: '0x1',
};

const pendingRequest = (overrides = {}) => ({
  id: REQUEST_ID,
  topic: TOPIC,
  chainId: CHAIN,
  method: 'eth_sendTransaction',
  params: [params0],
  ...overrides,
});

const coin = {
  _id: 'eth',
  chain_name: 'ethereum',
  type: 'coin',
  address: FROM,
  symbol: 'ETH',
};
const wallet = {
  clientId: 'client1',
  phrase: 'x',
  coins: [coin],
  selectedCoin: 'eth',
};

const makeState = pending => ({
  walletConnect: {
    transactionRequestData: pending,
    transactionModalVisible: false,
  },
  wallets: {allWallets: [wallet], currentWalletClientId: 'client1'},
  settings: {localCurrency: 'USD'},
  currentTransfer: {},
});

const executor = {
  sendRawTransaction: jest.fn(async () => '0xhash'),
  signRawTransaction: jest.fn(async () => '0xraw'),
  personalSign: jest.fn(async () => '0xsig'),
};
const connector = {respondSessionRequest: jest.fn(async () => {})};

const reviewed = () => {
  const tx = buildEvmWalletConnectTx(params0, {chainId: CHAIN});
  return {tx, digest: getEvmWalletConnectTxDigest(tx)};
};

const basePayload = (overrides = {}) => ({
  chain_name: 'ethereum',
  chainId: CHAIN,
  id: REQUEST_ID,
  topic: TOPIC,
  method: 'eth_sendTransaction',
  walletAddress: FROM,
  privateKey: '0xkey',
  domain: 'https://dapp.test',
  ...overrides,
});

const errorReply = () =>
  connector.respondSessionRequest.mock.calls.map(c => c[0].response.error)[0];

describe('walletConnect thunk: review binding for EVM transactions', () => {
  let store;
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(console, 'error').mockImplementation(() => {});
    getWalletConnect.mockReturnValue(connector);
    getCoin.mockResolvedValue({
      chain: executor,
      waitForConfirmation: jest.fn(),
    });
    store = configureMockStore([thunk])(makeState(pendingRequest()));
  });
  afterEach(() => {
    console.error.mockRestore();
  });

  it('signs the store-derived canonical tx when the digest and id match', async () => {
    const {tx, digest} = reviewed();
    await store.dispatch(
      walletConnect(
        basePayload({
          // The modal's copy carries junk the signer must never see.
          transactionData: {...tx, gas: '0xdead', foo: 'bar'},
          reviewedTxDigest: digest,
          reviewedRequestId: REQUEST_ID,
        }),
      ),
    );
    expect(executor.sendRawTransaction).toHaveBeenCalledTimes(1);
    const {payload} = executor.sendRawTransaction.mock.calls[0][0];
    expect(payload.transactionData).toEqual(tx);
    expect(connector.respondSessionRequest).toHaveBeenCalledWith({
      topic: TOPIC,
      response: {id: REQUEST_ID, result: '0xhash', jsonrpc: '2.0'},
    });
    expect(store.getActions().map(a => a.type)).toContain(
      'walletConnect/clearWalletConnectTransactionData',
    );
  });

  it('refuses and replies 5000 when the digest does not match the pending request', async () => {
    const {tx} = reviewed();
    await store.dispatch(
      walletConnect(
        basePayload({
          transactionData: tx,
          reviewedTxDigest: '0x' + '00'.repeat(32),
          reviewedRequestId: REQUEST_ID,
        }),
      ),
    );
    expect(executor.sendRawTransaction).not.toHaveBeenCalled();
    expect(errorReply()).toEqual({
      code: 5000,
      message: 'Request changed after review',
    });
    expect(showToast).toHaveBeenCalledWith(
      expect.objectContaining({type: 'errorToast', title: 'Request changed'}),
    );
    expect(store.getActions().map(a => a.type)).toContain(
      'walletConnect/clearWalletConnectTransactionData',
    );
  });

  it('refuses when the pending request id is not the one that was reviewed', async () => {
    store = configureMockStore([thunk])(
      makeState(pendingRequest({id: REQUEST_ID + 1})),
    );
    const {tx, digest} = reviewed();
    await store.dispatch(
      walletConnect(
        basePayload({
          transactionData: tx,
          reviewedTxDigest: digest,
          reviewedRequestId: REQUEST_ID,
        }),
      ),
    );
    expect(executor.sendRawTransaction).not.toHaveBeenCalled();
    expect(errorReply().code).toBe(5000);
  });

  it('refuses when no digest was supplied for an EVM transaction', async () => {
    const {tx} = reviewed();
    await store.dispatch(walletConnect(basePayload({transactionData: tx})));
    expect(executor.sendRawTransaction).not.toHaveBeenCalled();
    expect(errorReply().code).toBe(5000);
  });

  it('refuses a tx whose from is not the connected account', async () => {
    const other = '0x3333333333333333333333333333333333333333';
    store = configureMockStore([thunk])(
      makeState(pendingRequest({params: [{...params0, from: other}]})),
    );
    const tx = buildEvmWalletConnectTx(
      {...params0, from: other},
      {chainId: CHAIN},
    );
    await store.dispatch(
      walletConnect(
        basePayload({
          transactionData: tx,
          reviewedTxDigest: getEvmWalletConnectTxDigest(tx),
          reviewedRequestId: REQUEST_ID,
        }),
      ),
    );
    expect(executor.sendRawTransaction).not.toHaveBeenCalled();
    expect(errorReply().code).toBe(5000);
    expect(showToast).toHaveBeenCalledWith(
      expect.objectContaining({title: 'Wrong account'}),
    );
  });

  it('leaves message signing untouched (no digest required)', async () => {
    store = configureMockStore([thunk])(
      makeState(
        pendingRequest({method: 'personal_sign', params: ['0xdead', FROM]}),
      ),
    );
    await store.dispatch(
      walletConnect(
        basePayload({
          method: 'personal_sign',
          signTypeData: '0xdead',
          expectedSignerAddress: FROM,
        }),
      ),
    );
    expect(executor.personalSign).toHaveBeenCalledTimes(1);
    expect(connector.respondSessionRequest).toHaveBeenCalledWith({
      topic: TOPIC,
      response: {id: REQUEST_ID, result: '0xsig', jsonrpc: '2.0'},
    });
  });
});
