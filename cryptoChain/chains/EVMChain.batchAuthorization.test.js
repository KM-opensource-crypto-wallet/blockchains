/**
 * EIP-7702 authorizations: EVMChain signs them only with the chain's own id
 * (never 0) and only to the chain's batch contract or the zero address. The
 * fee estimate signs nothing with the user's key.
 *
 *   npx jest dok-wallet-blockchain-networks/cryptoChain/chains/EVMChain.batchAuthorization.test.js
 */

const RPC_URL = 'https://free1.test';
const FROM = '0x2222222222222222222222222222222222222222';
const TO = '0x1111111111111111111111111111111111111111';
const BATCH = '0x03203E5a57f568aca9C83d28a79Af3981BA54434';
const ZERO = '0x0000000000000000000000000000000000000000';
const CHAIN_ID = 11155111;
const THROWAWAY = '0x3333333333333333333333333333333333333333';
// eth_blockNumber's answer: both batch gas estimates are pinned to it.
const BLOCK = '0x1234';
// An RPC that answers eth_blockNumber with BLOCK and every estimate with gas().
const rpcSend = gas =>
  jest.fn(async (method, params) =>
    method === 'eth_blockNumber' ? BLOCK : gas(params?.[0]),
  );

const provider = {};
const authorizeCalls = [];
const authorizeSigners = [];
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
    constructor(key) {
      this.address =
        key === '0xthrowawaykey'
          ? '0x3333333333333333333333333333333333333333'
          : '0x2222222222222222222222222222222222222222';
    }
    connect(p) {
      this.provider = p;
      return this;
    }
    async authorize(auth) {
      authorizeCalls.push(auth);
      authorizeSigners.push(this.address);
      return {...auth, signature: {yParity: 1, r: '0xr', s: '0xs'}};
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
  class Interface {
    encodeFunctionData(name, [batchCalls]) {
      return `0x${name}:${batchCalls.length}`;
    }
  }
  return {
    ethers: {
      Wallet,
      Contract,
      Interface,
      ZeroAddress: '0x0000000000000000000000000000000000000000',
      randomBytes: () => new Uint8Array(32),
      hexlify: () => '0xthrowawaykey',
      toQuantity: value => `0x${BigInt(value).toString(16)}`,
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
    authorizeSigners.length = 0;
    contractCalls.estimate.length = 0;
    contractCalls.populate.length = 0;
    Object.assign(provider, {
      getTransactionCount: jest.fn(async () => 7),
      send: rpcSend(() => '0x186a0'),
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

  // Fee calculation is not stubbed here; only the estimate request matters.
  it('estimates without signing anything with the user key', async () => {
    await loadChain('ethereum')
      .getEstimateFeeForBatchTransaction({
        calls,
        privateKey: '0xkey',
        existingNonce: 7,
      })
      .catch(() => {});

    expect(authorizeSigners).toEqual([THROWAWAY]);
    expect(authorizeCalls).toEqual([
      {address: BATCH, nonce: 0, chainId: CHAIN_ID},
    ]);
    expect(contractCalls.estimate).toHaveLength(0);
    expect(provider.send).toHaveBeenCalledWith('eth_estimateGas', [
      {
        type: '0x4',
        from: FROM,
        to: FROM,
        data: '0xexecute((address,uint256,bytes)[]):1',
        authorizationList: [
          {
            chainId: '0xaa36a7',
            address: BATCH,
            nonce: '0x0',
            yParity: '0x1',
            r: '0xr',
            s: '0xs',
          },
        ],
      },
      BLOCK,
      {
        [FROM]: {code: '0xef0100' + BATCH.slice(2)},
        [THROWAWAY]: {balance: '0x1'},
      },
    ]);
  });

  // eth.drpc.org drops authorizationList and answers the execution cost
  // alone, so mainnet batch 0x8bc3b0d1… was sent ~25k gas short and ran out
  // of gas.
  it('refuses an estimate from a node that ignores the authorization', async () => {
    provider.send = rpcSend(() => '0x10d0e');

    await expect(
      loadChain('ethereum').getEstimateFeeForBatchTransaction({
        calls,
        privateKey: '0xkey',
        existingNonce: 7,
      }),
    ).rejects.toThrow(/did not price the batch authorization/);
    expect(provider.send).toHaveBeenCalledWith('eth_estimateGas', [
      {from: FROM, to: FROM, data: '0xexecute((address,uint256,bytes)[]):1'},
      BLOCK,
      {
        [FROM]: {code: '0xef0100' + BATCH.slice(2)},
        [THROWAWAY]: {balance: '0x1'},
      },
    ]);
  });

  it('keeps an estimate that prices the authorization', async () => {
    provider.send = rpcSend(tx =>
      tx.authorizationList ? '0x16e5a' : '0x10d0e',
    );

    const error = await loadChain('ethereum')
      .getEstimateFeeForBatchTransaction({
        calls,
        privateKey: '0xkey',
        existingNonce: 7,
      })
      .then(
        () => null,
        e => e,
      );

    // Fee calculation is not stubbed, so it may still fail after the estimate.
    expect(error?.message ?? '').not.toMatch(
      /did not price the batch authorization/,
    );
  });

  // With 'latest' a load-balanced RPC can answer the two estimates from
  // different blocks, and the comparison would then measure a state change
  // instead of the authorization's cost.
  it('runs both estimates on the same block', async () => {
    await loadChain('ethereum')
      .getEstimateFeeForBatchTransaction({
        calls,
        privateKey: '0xkey',
        existingNonce: 7,
      })
      .catch(() => {});

    const blocks = provider.send.mock.calls
      .filter(([method]) => method === 'eth_estimateGas')
      .map(([, params]) => params[1]);
    expect(blocks).toEqual([BLOCK, BLOCK]);
  });

  it('refuses a batch over the contract limit before any RPC call', async () => {
    await expect(
      loadChain('ethereum').getEstimateFeeForBatchTransaction({
        calls: Array(33).fill(calls[0]),
        privateKey: '0xkey',
        existingNonce: 7,
      }),
    ).rejects.toThrow(
      'The batch has 33 calls; at most 32 can be sent together. Remove some and try again.',
    );
    expect(provider.send).not.toHaveBeenCalled();
    expect(authorizeCalls).toHaveLength(0);
  });

  it('does not estimate on a chain without a batch contract', async () => {
    await expect(
      loadChain('base').getEstimateFeeForBatchTransaction({
        calls,
        privateKey: '0xkey',
        existingNonce: 7,
      }),
    ).rejects.toThrow('Batch sending is not available on this chain');
    expect(provider.send).not.toHaveBeenCalled();
    expect(authorizeCalls).toHaveLength(0);
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
