/**
 * PolkadotChain endpoint selection: premium proxy first, public Asset Hub
 * endpoints as fallback, per-URL ApiPromise cache with eviction, and a
 * broadcast that happens exactly once.
 */

const PROXY_URL = 'https://api.test/rpc/polkadot';
const FREE_1 = 'https://free1.test';
const FREE_2 = 'https://free2.test';

jest.mock('@polkadot/api', () => ({
  ApiPromise: {create: jest.fn()},
  WsProvider: jest.fn(function WsProvider(url) {
    this.url = url;
    this.kind = 'ws';
  }),
}));

jest.mock(
  'dok-wallet-blockchain-networks/rpcUrls/polkadotHttpProvider',
  () => ({
    PolkadotHttpProvider: jest.fn(function PolkadotHttpProvider(url) {
      this.url = url;
      this.kind = 'http';
    }),
  }),
);

jest.mock('@polkadot/keyring', () => ({
  Keyring: jest.fn(() => ({
    addFromSeed: jest.fn(() => ({address: 'signer-address'})),
  })),
}));

jest.mock('@polkadot/util', () => ({
  u8aToHex: jest.fn(),
  stringToU8a: jest.fn(),
  u8aConcat: jest.fn(),
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
  getFreeRPCUrl: jest.fn(() => [FREE_1, FREE_2]),
}));

const {ApiPromise, WsProvider} = require('@polkadot/api');
const {
  PolkadotHttpProvider,
} = require('dok-wallet-blockchain-networks/rpcUrls/polkadotHttpProvider');
const {
  getFreeRPCUrl,
} = require('dok-wallet-blockchain-networks/rpcUrls/rpcUrls');

const PRIVATE_KEY = 'ab'.repeat(32);

/**
 * An ApiPromise test double covering only what PolkadotChain touches.
 * `free` is the receiver balance reported by query.system.account.
 */
const fakeApi = ({free = '5000000000', overrides = {}} = {}) => {
  const signedTx = {signed: true};
  const api = {
    query: {
      system: {
        account: jest.fn().mockResolvedValue({data: {free}}),
        ...(overrides.account ? {account: overrides.account} : {}),
      },
    },
    tx: {
      balances: {
        transferAllowDeath: jest.fn(() => ({
          paymentInfo: jest.fn().mockResolvedValue({partialFee: '1000'}),
          signAsync: jest.fn().mockResolvedValue(signedTx),
        })),
      },
    },
    rpc: {
      author: {
        submitExtrinsic: jest.fn().mockResolvedValue('0xhash'),
      },
    },
    registry: {
      signedExtensions: ['CheckNonce'],
      setSignedExtensions: jest.fn(),
      createType: jest.fn(() => ({sign: () => ({signature: '0xsig'})})),
    },
    disconnect: jest.fn().mockResolvedValue(undefined),
  };
  api.signedTx = signedTx;
  return api;
};

/**
 * Routes ApiPromise.create to a per-URL fake. A value of Error makes
 * create() reject for that endpoint (as it does with throwOnConnect).
 */
const routeCreate = byUrl => {
  ApiPromise.create.mockImplementation(async ({provider}) => {
    const entry = byUrl[provider.url];
    if (entry instanceof Error) {
      throw entry;
    }
    if (!entry) {
      throw new Error(`no fake api for ${provider.url}`);
    }
    return entry;
  });
};

// apiCache lives at module scope, so every test gets a fresh module.
const loadChain = () => {
  let PolkadotChain;
  jest.isolateModules(() => {
    ({
      PolkadotChain,
    } = require('dok-wallet-blockchain-networks/cryptoChain/chains/PolkadotChain'));
  });
  return PolkadotChain();
};

describe('PolkadotChain RPC selection', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(console, 'log').mockImplementation(() => {});
    jest.spyOn(console, 'error').mockImplementation(() => {});
    getFreeRPCUrl.mockReturnValue([FREE_1, FREE_2]);
  });

  afterEach(() => {
    console.log.mockRestore();
    console.error.mockRestore();
  });

  it('tries the premium proxy first through the app HTTP provider', async () => {
    const proxyApi = fakeApi({free: '123'});
    routeCreate({[PROXY_URL]: proxyApi});
    const chain = loadChain();

    await expect(chain.getBalance({address: 'addr'})).resolves.toBe('123');

    expect(ApiPromise.create).toHaveBeenCalledTimes(1);
    const [options] = ApiPromise.create.mock.calls[0];
    expect(options.provider).toBeInstanceOf(PolkadotHttpProvider);
    expect(PolkadotHttpProvider).toHaveBeenCalledTimes(1);
    expect(PolkadotHttpProvider).toHaveBeenCalledWith(PROXY_URL);
    expect(options).toEqual(
      expect.objectContaining({throwOnConnect: true, noInitWarn: true}),
    );
  });

  it('falls back to the first free endpoint when the proxy api fails to initialise', async () => {
    const freeApi = fakeApi({free: '456'});
    routeCreate({
      [PROXY_URL]: new Error('FATAL: Unable to initialize the API: [429]'),
      [FREE_1]: freeApi,
    });
    const chain = loadChain();

    await expect(chain.getBalance({address: 'addr'})).resolves.toBe('456');

    expect(ApiPromise.create).toHaveBeenCalledTimes(2);
    // Public endpoints use the same app transport as the proxy.
    expect(PolkadotHttpProvider).toHaveBeenCalledTimes(2);
    expect(PolkadotHttpProvider).toHaveBeenLastCalledWith(FREE_1);
    expect(WsProvider).not.toHaveBeenCalled();
  });

  it('evicts a cached api whose call fails and rotates to the next endpoint', async () => {
    const proxyApi = fakeApi({
      overrides: {
        account: jest
          .fn()
          .mockRejectedValue(new Error('[429]: Too Many Requests')),
      },
    });
    const freeApi = fakeApi({free: '789'});
    routeCreate({[PROXY_URL]: proxyApi, [FREE_1]: freeApi});
    const chain = loadChain();

    await expect(chain.getBalance({address: 'addr'})).resolves.toBe('789');
    expect(proxyApi.disconnect).toHaveBeenCalledTimes(1);
    expect(freeApi.disconnect).not.toHaveBeenCalled();

    // Eviction means the proxy is re-created on the next call.
    const proxyCreatesBefore = ApiPromise.create.mock.calls.filter(
      ([{provider}]) => provider.url === PROXY_URL,
    ).length;
    await chain.getBalance({address: 'addr'});
    const proxyCreatesAfter = ApiPromise.create.mock.calls.filter(
      ([{provider}]) => provider.url === PROXY_URL,
    ).length;
    expect(proxyCreatesBefore).toBe(1);
    expect(proxyCreatesAfter).toBe(2);
  });

  it('reuses the cached api across calls on a healthy endpoint', async () => {
    routeCreate({[PROXY_URL]: fakeApi()});
    const chain = loadChain();

    await chain.getBalance({address: 'addr'});
    await chain.getBalance({address: 'addr'});
    await chain.getEstimateFee({
      toAddress: 'to',
      fromAddress: 'from',
      amount: '2',
      privateKey: PRIVATE_KEY,
    });

    expect(ApiPromise.create).toHaveBeenCalledTimes(1);
  });

  it('rethrows business errors without evicting or rotating', async () => {
    const proxyApi = fakeApi({free: '0'});
    routeCreate({[PROXY_URL]: proxyApi, [FREE_1]: fakeApi({free: '0'})});
    const chain = loadChain();

    await expect(
      chain.getEstimateFee({
        toAddress: 'to',
        fromAddress: 'from',
        amount: '0.5',
        privateKey: PRIVATE_KEY,
      }),
    ).rejects.toThrow('polkadot_receiver_should_1_dot');

    expect(ApiPromise.create).toHaveBeenCalledTimes(1);
    expect(proxyApi.disconnect).not.toHaveBeenCalled();
    expect(PolkadotHttpProvider).toHaveBeenCalledTimes(1);
  });

  it('send signs inside the retry loop and broadcasts exactly once', async () => {
    const proxyApi = fakeApi();
    const freeApi = fakeApi();
    routeCreate({[PROXY_URL]: proxyApi, [FREE_1]: freeApi});
    const chain = loadChain();

    await expect(
      chain.send({
        to: 'to',
        from: 'from',
        amount: '2',
        privateKey: PRIVATE_KEY,
      }),
    ).resolves.toBe('0xhash');

    expect(proxyApi.rpc.author.submitExtrinsic).toHaveBeenCalledTimes(1);
    expect(proxyApi.rpc.author.submitExtrinsic).toHaveBeenCalledWith(
      proxyApi.signedTx,
    );
    expect(freeApi.rpc.author.submitExtrinsic).not.toHaveBeenCalled();
    expect(PolkadotHttpProvider).toHaveBeenCalledTimes(1);
  });

  it('send does not re-broadcast on another endpoint when the submit fails', async () => {
    const proxyApi = fakeApi();
    proxyApi.rpc.author.submitExtrinsic.mockRejectedValue(
      new Error('network down'),
    );
    const freeApi = fakeApi();
    routeCreate({[PROXY_URL]: proxyApi, [FREE_1]: freeApi});
    const chain = loadChain();

    await expect(
      chain.send({
        to: 'to',
        from: 'from',
        amount: '2',
        privateKey: PRIVATE_KEY,
      }),
    ).rejects.toThrow('network down');

    const submits =
      proxyApi.rpc.author.submitExtrinsic.mock.calls.length +
      freeApi.rpc.author.submitExtrinsic.mock.calls.length;
    expect(submits).toBe(1);
    expect(ApiPromise.create).toHaveBeenCalledTimes(1);
  });

  it('send rotates the signing step to a free endpoint when the proxy fails before broadcast', async () => {
    const freeApi = fakeApi();
    routeCreate({
      [PROXY_URL]: new Error('proxy down'),
      [FREE_1]: freeApi,
    });
    const chain = loadChain();

    await expect(
      chain.send({
        to: 'to',
        from: 'from',
        amount: '2',
        privateKey: PRIVATE_KEY,
      }),
    ).resolves.toBe('0xhash');
    expect(freeApi.rpc.author.submitExtrinsic).toHaveBeenCalledTimes(1);
  });

  it('returns the default response when every endpoint fails, and rejects when there is none', async () => {
    routeCreate({
      [PROXY_URL]: new Error('down'),
      [FREE_1]: new Error('down'),
      [FREE_2]: new Error('down'),
    });
    const chain = loadChain();

    await expect(chain.getBalance({address: 'addr'})).resolves.toBe('0');
    await expect(
      chain.getEstimateFee({
        toAddress: 'to',
        fromAddress: 'from',
        amount: '2',
        privateKey: PRIVATE_KEY,
      }),
    ).rejects.toThrow('down');
  });

  it('uses WsProvider for websocket endpoints and the app HTTP provider otherwise', async () => {
    getFreeRPCUrl.mockReturnValue(['wss://ws.test', FREE_1]);
    routeCreate({
      [PROXY_URL]: new Error('down'),
      'wss://ws.test': new Error('down'),
      [FREE_1]: fakeApi({free: '1'}),
    });
    const chain = loadChain();

    await expect(chain.getBalance({address: 'addr'})).resolves.toBe('1');
    expect(WsProvider).toHaveBeenCalledWith('wss://ws.test');
    expect(PolkadotHttpProvider).toHaveBeenCalledWith(PROXY_URL);
    expect(PolkadotHttpProvider).toHaveBeenCalledWith(FREE_1);
  });

  it('sendRawTransaction restores the registry signed extensions after signing', async () => {
    const proxyApi = fakeApi();
    routeCreate({[PROXY_URL]: proxyApi});
    const chain = loadChain();

    await expect(
      chain.sendRawTransaction({
        signTypeData: {
          transactionPayload: {signedExtensions: ['CheckMortality']},
        },
        privateKey: PRIVATE_KEY,
      }),
    ).resolves.toEqual({id: 1, signature: '0xsig'});

    expect(proxyApi.registry.setSignedExtensions).toHaveBeenNthCalledWith(1, [
      'CheckMortality',
    ]);
    expect(proxyApi.registry.setSignedExtensions).toHaveBeenNthCalledWith(2, [
      'CheckNonce',
    ]);
  });
});
