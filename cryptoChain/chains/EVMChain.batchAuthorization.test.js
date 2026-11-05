/**
 * EIP-7702 authorizations: EVMChain signs them only with the chain's own id
 * (never 0) and only to the chain's batch contract or the zero address.
 *
 *   npx jest dok-wallet-blockchain-networks/cryptoChain/chains/EVMChain.batchAuthorization.test.js
 */

const RPC_URL = 'https://free1.test';
const FROM = '0x2222222222222222222222222222222222222222';
const TO = '0x1111111111111111111111111111111111111111';
const BATCH = '0x03203E5a57f568aca9C83d28a79Af3981BA54434';
const ZERO = '0x0000000000000000000000000000000000000000';
const CHAIN_ID = 11155111;

const provider = {};
const authorizeCalls = [];
const contractCalls = {estimate: [], populate: []};

jest.mock('ethers', () => {
  class FetchRequest {
    constructor(url) {
      this.url = url;
    }
  }
  class JsonRpcProvider {
    constructor() {
      Object.assign(this, provider);
    }
  }
  class Wallet {
    constructor() {
      this.address = '0x2222222222222222222222222222222222222222';
    }
    connect(p) {
      this.provider = p;
      return this;
    }
    async authorize(auth) {
      authorizeCalls.push(auth);
      return {...auth, signature: '0xsig'};
    }
    async populateTransaction(tx) {
      return tx;
    }
    async signTransaction() {
      return '0xsigned';
    }
    async sendTransaction(tx) {
      return {hash: '0x' + 'cd'.repeat(32), tx};
    }
  }
  class Contract {
    constructor() {
      this['execute((address,uint256,bytes)[])'] = {
        estimateGas: async (calls, options) => {
          contractCalls.estimate.push(options);
          return 100000n;
        },
        populateTransaction: async (calls, options) => {
          contractCalls.populate.push(options);
          return {to: FROM, data: '0x3f707e6b', ...options};
        },
      };
    }
  }
  return {
    ethers: {
      Wallet,
      Contract,
      ZeroAddress: '0x0000000000000000000000000000000000000000',
    },
    FetchRequest,
    JsonRpcProvider,
    Transaction: {from: () => ({hash: '0x' + 'ab'.repeat(32)})},
  };
});
jest.mock('ethers-decode-error', () => ({
  ErrorDecoder: {
    create: () => ({decode: async e => ({reason: e?.message ?? null})}),
  },
}));
jest.mock('dok-wallet-blockchain-networks/config/config', () => ({
  ...jest.requireActual('dok-wallet-blockchain-networks/config/config'),
  BATCH_TRANSACTION_CONTRACT_ADDRESS: {
    ethereum: '0x03203E5a57f568aca9C83d28a79Af3981BA54434',
    optimism: '0x03203E5a57f568aca9C83d28a79Af3981BA54434',
  },
  CHAIN_ID: {ethereum: 11155111, base: 84532},
}));
jest.mock('@metamask/eth-sig-util', () => ({signTypedData: jest.fn()}));
jest.mock('utils/toast', () => ({showToast: jest.fn()}));
jest.mock('dok-wallet-blockchain-networks/service/evmServices', () => ({
  EvmServices: {},
}));
jest.mock('dok-wallet-blockchain-networks/service/stakingProvider', () => ({
  EvmStakingProvider: {},
}));
jest.mock('dok-wallet-blockchain-networks/rpcUrls/rpcUrls', () => ({
  getPremiumRPCUrl: jest.fn(() => null),
  getFreeRPCUrl: jest.fn(() => ['https://free1.test']),
}));
jest.mock('dok-wallet-blockchain-networks/rpcUrls/rpcSession', () => ({
  getRpcSessionHeaders: jest.fn(async () => null),
  isRpcProxyUrl: jest.fn(() => false),
  refreshSessionForReplay: jest.fn(async () => ''),
}));
jest.mock('dok-wallet-blockchain-networks/helper', () => ({
  isEip1559NotSupported: jest.fn(() => false),
  isEip7702SupportedChain: jest.fn(() => true),
  isLayer2Chain: jest.fn(() => false),
  isSwapBlockingError: jest.fn(() => false),
  sleep: jest.fn(() => Promise.resolve()),
}));

const loadChain = chainName => {
  let EVMChain;
  jest.isolateModules(() => {
    ({
      EVMChain,
    } = require('dok-wallet-blockchain-networks/cryptoChain/chains/EVMChain'));
  });
  return EVMChain(chainName, undefined, RPC_URL);
};

const calls = [{to: TO, value: 1n, data: '0x'}];
const sendBatch = chain =>
  chain.sendBatchTransaction({
    calls,
    privateKey: '0xkey',
    estimateGas: 100000n,
    gasFee: 10n,
    maxPriorityFeePerGas: 1n,
    nonce: 7,
  });

describe('EVMChain EIP-7702 authorizations', () => {
  beforeEach(() => {
    authorizeCalls.length = 0;
    contractCalls.estimate.length = 0;
    contractCalls.populate.length = 0;
    Object.assign(provider, {
      getTransactionCount: jest.fn(async () => 7),
      broadcastTransaction: jest.fn(async () => ({
        hash: '0x' + 'ab'.repeat(32),
      })),
    });
    jest.spyOn(console, 'error').mockImplementation(() => {});
    jest.spyOn(console, 'log').mockImplementation(() => {});
  });
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('delegates a new account to the batch contract with the chain id', async () => {
    await sendBatch(loadChain('ethereum'));

    expect(authorizeCalls).toEqual([
      {address: BATCH, nonce: 8, chainId: CHAIN_ID},
    ]);
    expect(contractCalls.populate[0]).toMatchObject({
      type: 4,
      authorizationList: [expect.objectContaining({chainId: CHAIN_ID})],
    });
  });

  it('signs one authorization for both the estimate and the send', async () => {
    await loadChain('ethereum').sendBatchTransaction({
      calls,
      privateKey: '0xkey',
      gasFee: 10n,
      maxPriorityFeePerGas: 1n,
      nonce: 7,
    });

    expect(authorizeCalls).toHaveLength(1);
    expect(contractCalls.estimate[0].authorizationList).toEqual(
      contractCalls.populate[0].authorizationList,
    );
  });

  // Fee calculation is not stubbed here; only the estimate options matter.
  it('estimates with an authorization to the batch contract', async () => {
    await loadChain('ethereum')
      .getEstimateFeeForBatchTransaction({
        calls,
        privateKey: '0xkey',
        existingNonce: 7,
      })
      .catch(() => {});

    expect(authorizeCalls).toEqual([
      {address: BATCH, nonce: 8, chainId: CHAIN_ID},
    ]);
    expect(contractCalls.estimate[0]).toMatchObject({type: 4});
  });

  it('refuses to sign on a chain without a batch contract', async () => {
    await expect(sendBatch(loadChain('base'))).rejects.toThrow(
      'Refusing to sign this delegation',
    );
    expect(authorizeCalls).toHaveLength(0);
  });

  it('refuses to sign without a chain id', async () => {
    await expect(sendBatch(loadChain('optimism'))).rejects.toThrow(
      'Refusing to sign this delegation',
    );
    expect(authorizeCalls).toHaveLength(0);
  });

  // The authorization is signed before the (unstubbed) fee lookup.
  it('revokes with the zero address and the chain id', async () => {
    await loadChain('base')
      .revokeDelegation({privateKey: '0xkey'})
      .catch(() => {});

    expect(authorizeCalls).toEqual([{address: ZERO, nonce: 8, chainId: 84532}]);
  });
});
