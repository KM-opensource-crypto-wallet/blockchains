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
import {
  checkBatchDelegation,
  revokeDelegation,
  walletConnect,
} from 'dok-wallet-blockchain-networks/redux/wallets/walletsSlice';
import {
  BATCH_DELEGATION_NOTICE_ADDRESSES,
  BATCH_TRANSACTION_CONTRACT_ADDRESS,
} from 'dok-wallet-blockchain-networks/config/config';
import {
  buildEvmWalletConnectTx,
  getEvmWalletConnectTxDigest,
} from 'dok-wallet-blockchain-networks/helper/evmTxReview';
import {getCoin} from 'dok-wallet-blockchain-networks/cryptoChain';
import {
  getWalletConnect,
  recordIssuedBatch,
} from 'dok-wallet-blockchain-networks/service/walletconnect';
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
  recordIssuedBatch: jest.fn(),
}));
jest.mock('utils/toast', () => ({showToast: jest.fn()}));

const FROM = '0x2222222222222222222222222222222222222222';
const TO = '0x1111111111111111111111111111111111111111';
const CHAIN = 'eip155:1';
const REQUEST_ID = 1001;
const TOPIC = 'topic-1';
const BATCH_HASH = '0x' + 'ab'.repeat(32);

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
  getEstimateFeeForBatchTransaction: jest.fn(async () => ({nonce: 1})),
  sendBatchTransaction: jest.fn(async () => BATCH_HASH),
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

  it('answers the dApp with an error and clears the request when the native coin cannot be loaded', async () => {
    getCoin.mockResolvedValue(null);
    const {tx, digest} = reviewed();
    const result = await store.dispatch(
      walletConnect(
        basePayload({
          transactionData: tx,
          reviewedTxDigest: digest,
          reviewedRequestId: REQUEST_ID,
        }),
      ),
    );
    expect(result.type).toBe('wallets/walletConnect/rejected');
    expect(executor.sendRawTransaction).not.toHaveBeenCalled();
    expect(connector.respondSessionRequest).toHaveBeenCalledTimes(1);
    expect(errorReply()).toEqual({
      code: expect.any(Number),
      message: 'Unable to load the ethereum coin for signing',
    });
    expect(store.getActions().map(a => a.type)).toContain(
      'walletConnect/clearWalletConnectTransactionData',
    );
  });
});

// wallet_getCallsStatus answers only for batch ids recorded here, so the
// record has to exist before the dApp can receive the id.
describe('walletConnect thunk: wallet_sendCalls batch record', () => {
  const sendCalls = () =>
    walletConnect(
      basePayload({
        method: 'wallet_sendCalls',
        transactionData: {batchCalls: [{to: TO, value: '0x0', data: '0x'}]},
      }),
    );

  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(console, 'error').mockImplementation(() => {});
    getWalletConnect.mockReturnValue(connector);
  });
  afterEach(() => {
    console.error.mockRestore();
  });

  it('records the batch hash for the session, chain and wallet before replying with it', async () => {
    getCoin.mockResolvedValue({
      chain: executor,
      waitForConfirmation: jest.fn(async () => ({status: 1})),
    });
    const store = configureMockStore([thunk])(makeState(null));

    await store.dispatch(sendCalls());

    // The signing wallet: its custom RPC (if any) sent the batch, so status
    // polls must read through it too.
    expect(recordIssuedBatch).toHaveBeenCalledWith({
      topic: TOPIC,
      chainId: CHAIN,
      id: BATCH_HASH,
      walletClientId: 'client1',
    });
    expect(connector.respondSessionRequest).toHaveBeenCalledWith({
      topic: TOPIC,
      response: {id: REQUEST_ID, result: BATCH_HASH, jsonrpc: '2.0'},
    });
    expect(recordIssuedBatch.mock.invocationCallOrder[0]).toBeLessThan(
      connector.respondSessionRequest.mock.invocationCallOrder[0],
    );
  });

  it('records nothing when the batch reverted', async () => {
    getCoin.mockResolvedValue({
      chain: executor,
      waitForConfirmation: jest.fn(async () => ({status: 'failed'})),
    });
    const store = configureMockStore([thunk])(makeState(null));

    await store.dispatch(sendCalls());

    expect(recordIssuedBatch).not.toHaveBeenCalled();
    expect(errorReply()).toBeDefined();
  });

  it('records nothing for other methods', async () => {
    getCoin.mockResolvedValue({
      chain: executor,
      waitForConfirmation: jest.fn(),
    });
    const store = configureMockStore([thunk])(
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
    expect(recordIssuedBatch).not.toHaveBeenCalled();
  });
});

describe('checkBatchDelegation (Home notice)', () => {
  const LISTED = BATCH_DELEGATION_NOTICE_ADDRESSES[0];
  const OURS = BATCH_TRANSACTION_CONTRACT_ADDRESS.ethereum;
  let nextClient = 1;
  const storeFor = (address, cleared = {}) => {
    const clientId = `w${nextClient++}`;
    const ethCoin = {
      _id: 'eth-coin',
      chain_name: 'ethereum',
      type: 'coin',
      address,
      chain_symbol: 'ETH',
      currencyRate: '2000',
    };
    return configureMockStore([thunk])({
      ...makeState(null),
      wallets: {
        allWallets: [{...wallet, clientId, coins: [ethCoin]}],
        currentWalletClientId: clientId,
        batchDelegationCleared: cleared,
      },
    });
  };
  const chainCoin = delegation => ({
    checkDelegation: jest.fn(async () => delegation),
    estimateRevokeDelegationFee: jest.fn(async () => ({
      fee: '0.0002',
      estimatedFee: '0.0001',
    })),
  });
  const types = store => store.getActions().map(a => a.type);

  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(console, 'warn').mockImplementation(() => {});
  });
  afterEach(() => {
    console.warn.mockRestore();
  });

  it('makes no RPC call for an address that is not listed', async () => {
    const store = storeFor('0x' + '12'.repeat(20));
    expect(await store.dispatch(checkBatchDelegation()).unwrap()).toBeNull();
    expect(getCoin).not.toHaveBeenCalled();
  });

  it('makes no RPC call for a listed address already cleared', async () => {
    const store = storeFor(LISTED, {[LISTED.toLowerCase()]: true});
    expect(await store.dispatch(checkBatchDelegation()).unwrap()).toBeNull();
    expect(getCoin).not.toHaveBeenCalled();
  });

  it('returns the notice for a listed address still delegated to our contract', async () => {
    getCoin.mockResolvedValue(
      chainCoin({isDelegated: true, contractAddress: OURS}),
    );
    const store = storeFor(LISTED);
    expect(await store.dispatch(checkBatchDelegation()).unwrap()).toEqual({
      coinId: 'eth-coin',
      address: LISTED.toLowerCase(),
      chain_symbol: 'ETH',
      currencyRate: '2000',
      estimatedFee: '0.0001',
    });
  });

  it('checks a wallet at most once per 10 minutes unless forced', async () => {
    getCoin.mockResolvedValue(
      chainCoin({isDelegated: true, contractAddress: OURS}),
    );
    const store = storeFor(LISTED);
    await store.dispatch(checkBatchDelegation());
    expect(await store.dispatch(checkBatchDelegation()).unwrap()).toBeNull();
    expect(getCoin).toHaveBeenCalledTimes(1);
    await store.dispatch(checkBatchDelegation({force: true}));
    expect(getCoin).toHaveBeenCalledTimes(2);
  });

  it('marks the address cleared once the chain shows it is no longer delegated', async () => {
    getCoin.mockResolvedValue(
      chainCoin({isDelegated: false, contractAddress: null}),
    );
    const store = storeFor(LISTED);
    expect(await store.dispatch(checkBatchDelegation()).unwrap()).toBeNull();
    expect(store.getActions()).toContainEqual({
      type: 'wallets/markBatchDelegationCleared',
      payload: LISTED.toLowerCase(),
    });
  });

  it('marks nothing when the delegation could not be read', async () => {
    getCoin.mockResolvedValue(
      chainCoin({isDelegated: false, contractAddress: null, error: true}),
    );
    const store = storeFor(LISTED);
    expect(await store.dispatch(checkBatchDelegation()).unwrap()).toBeNull();
    expect(types(store)).not.toContain('wallets/markBatchDelegationCleared');
  });
});

describe('revokeDelegation', () => {
  const baseCoin = {...coin, _id: 'other-eth'};
  const storeWithCoins = () =>
    configureMockStore([thunk])({
      ...makeState(null),
      wallets: {
        allWallets: [{...wallet, coins: [coin, baseCoin]}],
        currentWalletClientId: 'client1',
      },
    });

  beforeEach(() => jest.clearAllMocks());

  it('revokes with the coin given by coinId and reports confirmation', async () => {
    getCoin.mockResolvedValue({
      revokeDelegation: jest.fn(async () => ({hash: '0x' + '01'.repeat(32)})),
      waitForConfirmation: jest.fn(async () => ({status: 1})),
    });
    const result = await storeWithCoins()
      .dispatch(revokeDelegation({coinId: 'other-eth'}))
      .unwrap();
    expect(result).toEqual({status: 'confirmed'});
    expect(getCoin.mock.calls[0][1]).toBe(baseCoin);
  });

  it('rejects when the transaction failed on the network', async () => {
    getCoin.mockResolvedValue({
      revokeDelegation: jest.fn(async () => ({hash: '0x' + '01'.repeat(32)})),
      waitForConfirmation: jest.fn(async () => ({status: 'failed'})),
    });
    await expect(
      storeWithCoins().dispatch(revokeDelegation()).unwrap(),
    ).rejects.toEqual(
      expect.objectContaining({
        message: 'The transaction failed on the network.',
      }),
    );
  });
});

describe('walletConnect thunk: 32-byte message from a listed delegated account', () => {
  const LISTED = BATCH_DELEGATION_NOTICE_ADDRESSES[0];
  const HASH = '0x' + '5a'.repeat(32);
  const storeFor = (address, cleared = {}) =>
    configureMockStore([thunk])({
      ...makeState(null),
      wallets: {
        allWallets: [{...wallet, coins: [{...coin, address}]}],
        currentWalletClientId: 'client1',
        batchDelegationCleared: cleared,
      },
    });
  const personalSign = (address, message) =>
    walletConnect(
      basePayload({
        method: 'personal_sign',
        signTypeData: message,
        expectedSignerAddress: address,
        walletAddress: address,
      }),
    );

  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(console, 'error').mockImplementation(() => {});
    getWalletConnect.mockReturnValue(connector);
    getCoin.mockResolvedValue({
      chain: executor,
      waitForConfirmation: jest.fn(),
    });
  });
  afterEach(() => {
    console.error.mockRestore();
  });

  it('refuses with 5000 and never reaches the signer', async () => {
    const store = storeFor(LISTED);
    await store.dispatch(personalSign(LISTED, HASH));

    expect(executor.personalSign).not.toHaveBeenCalled();
    expect(errorReply().code).toBe(5000);
    expect(store.getActions().map(a => a.type)).toContain(
      'walletConnect/clearWalletConnectTransactionData',
    );
  });

  it('signs once the account has been cleared', async () => {
    const store = storeFor(LISTED, {[LISTED.toLowerCase()]: true});
    await store.dispatch(personalSign(LISTED, HASH));
    expect(executor.personalSign).toHaveBeenCalledTimes(1);
  });

  it('signs for an account that is not listed', async () => {
    await storeFor(FROM).dispatch(personalSign(FROM, HASH));
    expect(executor.personalSign).toHaveBeenCalledTimes(1);
  });

  it('signs a listed account message of another length', async () => {
    await storeFor(LISTED).dispatch(personalSign(LISTED, '0x48656c6c6f'));
    expect(executor.personalSign).toHaveBeenCalledTimes(1);
  });
});
