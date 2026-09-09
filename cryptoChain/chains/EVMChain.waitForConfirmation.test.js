/**
 * EVMChain.waitForConfirmation: a transient RPC failure while waiting must not
 * be reported as 'pending' (which the send flow shows as "Transaction take too
 * long"). The whole time budget has to be used first, and a bare hash string
 * has to be polled, not looked up once.
 *
 * Runner: repo jest.config.js (RN preset):
 *   npx jest dok-wallet-blockchain-networks/cryptoChain/chains/EVMChain.waitForConfirmation.test.js
 */

const PROXY_URL = 'https://api.test/rpc/ethereum';
const FREE_1 = 'https://free1.test';

// url -> fake provider, filled per test.
const providers = {};

jest.mock('ethers', () => {
  class FetchRequest {
    constructor(url) {
      this.url = url;
    }
  }
  class JsonRpcProvider {
    constructor(fetchRequest) {
      const url = fetchRequest.url.split('?')[0];
      const fake = providers[url];
      if (!fake) {
        throw new Error(`no fake provider for ${url}`);
      }
      Object.assign(this, fake);
    }
  }
  return {
    ethers: {},
    FetchRequest,
    JsonRpcProvider,
    Transaction: {},
  };
});
jest.mock('ethers-decode-error', () => ({
  ErrorDecoder: {
    create: () => ({
      decode: async e => ({reason: e?.shortMessage ?? e?.message ?? null}),
    }),
  },
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
  getPremiumRPCUrl: jest.fn(() => PROXY_URL),
  getFreeRPCUrl: jest.fn(() => [FREE_1]),
}));
jest.mock('dok-wallet-blockchain-networks/rpcUrls/rpcSession', () => ({
  getRpcSessionHeaders: jest.fn(async () => null),
  isRpcProxyUrl: jest.fn(() => false),
  refreshSessionForReplay: jest.fn(async () => ''),
}));
jest.mock('dok-wallet-blockchain-networks/helper', () => ({
  convertToSmallAmount: jest.fn(),
  deleteItemAtIndex: jest.fn(),
  getExplorerTxUrl: jest.fn(),
  isEip1559NotSupported: jest.fn(() => false),
  isEip7702SupportedChain: jest.fn(() => false),
  isLayer2Chain: jest.fn(() => false),
  isSwapBlockingError: jest.fn(() => false),
  isValidEVMTransactionHash: hash => /^0x[0-9a-fA-F]{64}$/.test(hash || ''),
  parseBalance: jest.fn(),
  sleep: ms => new Promise(resolve => setTimeout(resolve, ms)),
  SWAP_QUOTE_EXPIRED_ERROR: 'SWAP_QUOTE_EXPIRED',
  validateNumber: jest.fn(),
}));

const HASH = '0x' + 'ab'.repeat(32);
const RECEIPT = {hash: HASH, status: 1, blockNumber: 100};

const rpcError = (message, code) => {
  const e = new Error(message);
  e.code = code;
  e.shortMessage = message;
  return e;
};
const serverError = () => rpcError('bad response (status=502)', 'SERVER_ERROR');
const timeoutError = () => rpcError('wait for transaction timeout', 'TIMEOUT');

const setProviders = ({proxy = {}, free = {}} = {}) => {
  providers[PROXY_URL] = {
    getTransactionReceipt: jest.fn(async () => null),
    getTransaction: jest.fn(async () => null),
    ...proxy,
  };
  providers[FREE_1] = {
    getTransactionReceipt: jest.fn(async () => null),
    getTransaction: jest.fn(async () => null),
    ...free,
  };
};

const loadChain = () => {
  let EVMChain;
  jest.isolateModules(() => {
    ({
      EVMChain,
    } = require('dok-wallet-blockchain-networks/cryptoChain/chains/EVMChain'));
  });
  return EVMChain('ethereum');
};

// Small budget so the "used the whole budget" cases stay fast.
const INTERVAL = 5;
const RETRIES = 4;
const BUDGET = INTERVAL * RETRIES;

const waitFor = (chain, transaction) =>
  chain.waitForConfirmation({
    transaction,
    interval: INTERVAL,
    retries: RETRIES,
  });

describe('EVMChain.waitForConfirmation', () => {
  let warn;
  beforeEach(() => {
    setProviders();
    warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    jest.spyOn(console, 'log').mockImplementation(() => {});
    jest.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('with a TransactionResponse', () => {
    it('returns the receipt when wait() resolves', async () => {
      const tx = {hash: HASH, wait: jest.fn(async () => RECEIPT)};
      await expect(waitFor(loadChain(), tx)).resolves.toBe(RECEIPT);
    });

    it('does not report pending on a single transient wait() failure', async () => {
      const tx = {
        hash: HASH,
        wait: jest
          .fn()
          .mockRejectedValueOnce(serverError())
          .mockResolvedValue(RECEIPT),
      };
      await expect(waitFor(loadChain(), tx)).resolves.toBe(RECEIPT);
      expect(tx.wait).toHaveBeenCalledTimes(2);
    });

    it('falls back to a receipt lookup on other RPC urls when wait() keeps failing', async () => {
      setProviders({
        proxy: {
          getTransactionReceipt: jest.fn(async () => {
            throw serverError();
          }),
        },
        free: {getTransactionReceipt: jest.fn(async () => RECEIPT)},
      });
      const tx = {hash: HASH, wait: jest.fn().mockRejectedValue(serverError())};
      await expect(waitFor(loadChain(), tx)).resolves.toBe(RECEIPT);
    });

    it('reports pending only once the whole budget is spent on transient failures', async () => {
      const tx = {hash: HASH, wait: jest.fn().mockRejectedValue(serverError())};
      const started = Date.now();
      await expect(waitFor(loadChain(), tx)).resolves.toBe('pending');
      expect(Date.now() - started).toBeGreaterThanOrEqual(BUDGET - 1);
      expect(tx.wait.mock.calls.length).toBeGreaterThan(1);
      expect(warn).toHaveBeenCalled();
    });

    it('reports pending on a wait() timeout', async () => {
      const tx = {
        hash: HASH,
        wait: jest.fn().mockRejectedValue(timeoutError()),
      };
      await expect(waitFor(loadChain(), tx)).resolves.toBe('pending');
      expect(tx.wait).toHaveBeenCalledTimes(1);
    });

    it('gives wait() the remaining budget, not a fixed 60s', async () => {
      const tx = {hash: HASH, wait: jest.fn(async () => RECEIPT)};
      await waitFor(loadChain(), tx);
      const [, timeout] = tx.wait.mock.calls[0];
      expect(timeout).toBeGreaterThan(0);
      expect(timeout).toBeLessThanOrEqual(BUDGET);
    });

    it('returns the replacement receipt when the tx was sped up', async () => {
      const replacement = {hash: '0x' + 'cd'.repeat(32), status: 1};
      const e = rpcError('transaction was replaced', 'TRANSACTION_REPLACED');
      e.cancelled = false;
      e.receipt = replacement;
      const tx = {hash: HASH, wait: jest.fn().mockRejectedValue(e)};
      await expect(waitFor(loadChain(), tx)).resolves.toBe(replacement);
    });

    it('throws when the tx was cancelled', async () => {
      const e = rpcError('transaction was replaced', 'TRANSACTION_REPLACED');
      e.cancelled = true;
      const tx = {hash: HASH, wait: jest.fn().mockRejectedValue(e)};
      await expect(waitFor(loadChain(), tx)).rejects.toThrow(
        'transaction was cancelled',
      );
    });

    it('normalises a reverted receipt to a failed status', async () => {
      const tx = {
        hash: HASH,
        wait: jest.fn(async () => ({hash: HASH, status: 0})),
      };
      await expect(waitFor(loadChain(), tx)).resolves.toEqual({
        status: 'failed',
        hash: HASH,
      });
    });

    it('normalises a CALL_EXCEPTION receipt to a failed status', async () => {
      const e = rpcError('transaction execution reverted', 'CALL_EXCEPTION');
      e.receipt = {hash: HASH, status: 0};
      const tx = {hash: HASH, wait: jest.fn().mockRejectedValue(e)};
      await expect(waitFor(loadChain(), tx)).resolves.toEqual({
        status: 'failed',
        hash: HASH,
      });
    });
  });

  describe('with a bare hash string', () => {
    it('polls for the receipt instead of looking it up once', async () => {
      const getTransactionReceipt = jest
        .fn()
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(null)
        .mockResolvedValue(RECEIPT);
      setProviders({proxy: {getTransactionReceipt}});
      await expect(waitFor(loadChain(), HASH)).resolves.toBe(RECEIPT);
      expect(getTransactionReceipt).toHaveBeenCalledTimes(3);
    });

    it('reports pending only once the budget is spent', async () => {
      const started = Date.now();
      await expect(waitFor(loadChain(), HASH)).resolves.toBe('pending');
      expect(Date.now() - started).toBeGreaterThanOrEqual(BUDGET - 1);
      expect(
        providers[PROXY_URL].getTransactionReceipt.mock.calls.length,
      ).toBeGreaterThan(1);
    });

    it('survives a transient receipt lookup failure', async () => {
      const getTransactionReceipt = jest
        .fn()
        .mockRejectedValueOnce(serverError())
        .mockResolvedValue(RECEIPT);
      setProviders({
        proxy: {getTransactionReceipt},
        free: {
          getTransactionReceipt: jest.fn(async () => {
            throw serverError();
          }),
        },
      });
      await expect(waitFor(loadChain(), HASH)).resolves.toBe(RECEIPT);
    });

    it('normalises a reverted receipt to a failed status', async () => {
      setProviders({
        proxy: {
          getTransactionReceipt: jest.fn(async () => ({hash: HASH, status: 0})),
        },
      });
      await expect(waitFor(loadChain(), HASH)).resolves.toEqual({
        status: 'failed',
        hash: HASH,
      });
    });
  });

  describe('with mempool candidate hashes', () => {
    it('waits on the first candidate that resolves to a transaction', async () => {
      const other = '0x' + 'ef'.repeat(32);
      const wait = jest.fn(async () => RECEIPT);
      setProviders({
        proxy: {
          getTransaction: jest.fn(async hash =>
            hash === HASH ? {hash, wait} : null,
          ),
        },
      });
      await expect(waitFor(loadChain(), [other, HASH])).resolves.toBe(RECEIPT);
    });

    it('reports pending only once the budget is spent', async () => {
      const started = Date.now();
      await expect(waitFor(loadChain(), [HASH])).resolves.toBe('pending');
      expect(Date.now() - started).toBeGreaterThanOrEqual(BUDGET - 1);
    });
  });
});
