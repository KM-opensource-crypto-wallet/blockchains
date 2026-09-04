/**
 * PolkadotChain.waitForConfirmation: finds the submitted extrinsic by hash
 * and reports that extrinsic's own outcome, instead of the first successful
 * event in the head block (inherents always succeed, so that was always true).
 *
 * Runner: repo jest.config.js (RN preset), same as PolkadotChain.rpc.test.js.
 */

const PROXY_URL = 'https://api.test/rpc/polkadot';
const FREE_1 = 'https://free1.test';

jest.mock('@polkadot/api', () => ({
  ApiPromise: {create: jest.fn()},
  WsProvider: jest.fn(),
}));

jest.mock(
  'dok-wallet-blockchain-networks/rpcUrls/polkadotHttpProvider',
  () => ({
    PolkadotHttpProvider: jest.fn(function PolkadotHttpProvider(url) {
      this.url = url;
    }),
  }),
);

jest.mock('@polkadot/keyring', () => ({Keyring: jest.fn()}));
jest.mock('@polkadot/util', () => ({
  u8aToHex: jest.fn(),
  u8aToU8a: jest.fn(),
  u8aWrapBytes: jest.fn(),
}));
jest.mock('@polkadot/util-crypto', () => ({
  decodeAddress: jest.fn(),
  encodeAddress: jest.fn(),
}));
jest.mock('dok-wallet-blockchain-networks/helper', () => ({
  convertToSmallAmount: jest.fn(value => value),
  parseBalance: jest.fn(value => value),
  getExplorerTxUrl: jest.fn(),
}));
jest.mock('dok-wallet-blockchain-networks/service/PolkadotScan', () => ({
  PolkadotScan: {},
}));
jest.mock('dok-wallet-blockchain-networks/rpcUrls/rpcUrls', () => ({
  getPremiumRPCUrl: jest.fn(() => PROXY_URL),
  getFreeRPCUrl: jest.fn(() => [FREE_1]),
}));

const {ApiPromise} = require('@polkadot/api');

const TX = '0x' + 'aa'.repeat(32);
const OTHER = '0x' + 'bb'.repeat(32);

const ext = hash => ({hash: {eq: other => other === hash}});
const blockHashOf = n => ({n, toHex: () => `0xblock${n}`});

const success = index => ({
  phase: {isApplyExtrinsic: true, asApplyExtrinsic: {eq: i => i === index}},
  event: {kind: 'success'},
});
const failed = (index, dispatchError) => ({
  phase: {isApplyExtrinsic: true, asApplyExtrinsic: {eq: i => i === index}},
  event: {kind: 'failed', data: [dispatchError]},
});

/**
 * Fake ApiPromise. `heads` is the head block number returned on successive
 * getHeader() calls (the last one repeats). `blocks` maps block number to
 * {extrinsics: [hash...], events: [records...]}.
 */
const fakeApi = ({heads, blocks, overrides = {}}) => {
  let headCall = 0;
  const api = {
    rpc: {
      chain: {
        getHeader: jest.fn(async () => {
          const head = heads[Math.min(headCall, heads.length - 1)];
          headCall += 1;
          return {number: {toNumber: () => head}};
        }),
        getBlockHash: jest.fn(async n => blockHashOf(n)),
        getBlock: jest.fn(async blockHash => ({
          block: {
            extrinsics: (blocks[blockHash.n]?.extrinsics ?? []).map(ext),
          },
        })),
        ...overrides.chain,
      },
    },
    at: jest.fn(async blockHash => ({
      query: {
        system: {events: async () => blocks[blockHash.n]?.events ?? []},
      },
    })),
    events: {
      system: {
        ExtrinsicSuccess: {is: e => e.kind === 'success'},
        ExtrinsicFailed: {is: e => e.kind === 'failed'},
      },
    },
    registry: {
      findMetaError: jest.fn(() => ({
        section: 'balances',
        name: 'InsufficientBalance',
      })),
    },
    disconnect: jest.fn().mockResolvedValue(undefined),
  };
  return api;
};

const routeCreate = byUrl => {
  ApiPromise.create.mockImplementation(async ({provider}) => {
    const entry = byUrl[provider.url];
    if (!entry) {
      throw new Error(`no fake api for ${provider.url}`);
    }
    return entry;
  });
};

const loadChain = () => {
  let PolkadotChain;
  jest.isolateModules(() => {
    ({
      PolkadotChain,
    } = require('dok-wallet-blockchain-networks/cryptoChain/chains/PolkadotChain'));
  });
  return PolkadotChain();
};

// An inherent (timestamp.set) that always succeeds sits at index 0 of every
// block, exactly the event the old implementation mistook for confirmation.
const INHERENT = '0x' + '00'.repeat(32);

describe('PolkadotChain.waitForConfirmation', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(console, 'log').mockImplementation(() => {});
    jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('reports our extrinsic as failed even though the block has a successful inherent', async () => {
    const api = fakeApi({
      heads: [100],
      blocks: {
        99: {extrinsics: [INHERENT], events: [success(0)]},
        100: {
          extrinsics: [INHERENT, OTHER, TX],
          events: [success(0), success(1), failed(2, {isModule: true})],
        },
      },
    });
    routeCreate({[PROXY_URL]: api});

    const result = await loadChain().waitForConfirmation({
      transaction: TX,
      interval: 0,
      retries: 3,
    });
    expect(result).toEqual({
      status: 'failed',
      err: 'balances.InsufficientBalance',
    });
    // Events were read for the block that holds our tx, not just the head.
    expect(api.at).toHaveBeenCalledWith(expect.objectContaining({n: 100}));
  });

  it('keeps polling until the tx lands in a later block and returns its hash', async () => {
    const api = fakeApi({
      heads: [100, 100, 101],
      blocks: {
        99: {extrinsics: [INHERENT], events: [success(0)]},
        100: {extrinsics: [INHERENT, OTHER], events: [success(0), success(1)]},
        101: {extrinsics: [INHERENT, TX], events: [success(0), success(1)]},
      },
    });
    routeCreate({[PROXY_URL]: api});

    // submitExtrinsic returns an H256 codec: `.hash` is NOT the tx hash.
    const codec = {toHex: () => TX, hash: 'not-the-tx-hash'};
    const result = await loadChain().waitForConfirmation({
      transaction: codec,
      interval: 0,
      retries: 5,
    });
    expect(result).toEqual({hash: TX, blockHash: '0xblock101'});
    // Blocks 99..101 fetched once each, no re-scan of already checked blocks.
    expect(api.rpc.chain.getBlock.mock.calls.map(([h]) => h.n)).toEqual([
      99, 100, 101,
    ]);
  });

  it("resolves 'pending' when the tx is not included within retries", async () => {
    const api = fakeApi({
      heads: [100],
      blocks: {
        99: {extrinsics: [INHERENT], events: [success(0)]},
        100: {extrinsics: [INHERENT, OTHER], events: [success(0), success(1)]},
      },
    });
    routeCreate({[PROXY_URL]: api});

    const result = await loadChain().waitForConfirmation({
      transaction: TX,
      interval: 0,
      retries: 3,
    });
    expect(result).toBe('pending');
    expect(api.rpc.chain.getHeader).toHaveBeenCalledTimes(3);
  });

  it('decodes non-module dispatch errors with toString', async () => {
    const api = fakeApi({
      heads: [7],
      blocks: {
        6: {extrinsics: [INHERENT], events: [success(0)]},
        7: {
          extrinsics: [INHERENT, TX],
          events: [
            success(0),
            failed(1, {isModule: false, toString: () => 'BadOrigin'}),
          ],
        },
      },
    });
    routeCreate({[PROXY_URL]: api});

    await expect(
      loadChain().waitForConfirmation({transaction: TX, interval: 0}),
    ).resolves.toEqual({status: 'failed', err: 'BadOrigin'});
  });

  it('resumes the block scan on the next endpoint after an RPC failure', async () => {
    const blocks = {
      99: {extrinsics: [INHERENT], events: [success(0)]},
      100: {extrinsics: [INHERENT, TX], events: [success(0), success(1)]},
    };
    const broken = fakeApi({heads: [100], blocks});
    broken.rpc.chain.getBlock.mockRejectedValue(new Error('socket closed'));
    const healthy = fakeApi({heads: [100], blocks});
    routeCreate({[PROXY_URL]: broken, [FREE_1]: healthy});

    const result = await loadChain().waitForConfirmation({
      transaction: TX,
      interval: 0,
      retries: 2,
    });
    expect(result).toEqual({hash: TX, blockHash: '0xblock100'});
    // Failed on 99 at the proxy, so the fallback starts at 99, not at head.
    expect(healthy.rpc.chain.getBlock.mock.calls.map(([h]) => h.n)).toEqual([
      99, 100,
    ]);
  });

  it('returns null without touching the RPC when there is no transaction', async () => {
    const api = fakeApi({heads: [1], blocks: {}});
    routeCreate({[PROXY_URL]: api});
    await expect(loadChain().waitForConfirmation({})).resolves.toBeNull();
    expect(api.rpc.chain.getHeader).not.toHaveBeenCalled();
  });
});
