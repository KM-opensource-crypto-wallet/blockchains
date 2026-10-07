/**
 * EVMChain WalletConnect signers (eth_signTransaction / eth_sendTransaction)
 * must sign exactly the canonical, allow-listed transaction the user reviewed
 * (KIML-002): chainId and EIP-1559 fees carried through, stray fields dropped,
 * and eth_signTransaction populated so the raw tx it returns is broadcastable.
 *
 * Runner: repo jest.config.js (RN preset):
 *   npx jest dok-wallet-blockchain-networks/cryptoChain/chains/EVMChain.walletConnectSign.test.js
 */

const PROXY_URL = 'https://api.test/rpc/ethereum';
const FREE_1 = 'https://free1.test';
const FROM = '0x2222222222222222222222222222222222222222';
const TO = '0x1111111111111111111111111111111111111111';
const HASH = '0x' + 'ab'.repeat(32);
const SIGNED = '0xf86c_signed';

const providers = {};
// Exposed so tests can inspect what the Wallet was asked to populate / sign.
const walletCalls = {populate: [], sign: []};

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
  class Wallet {
    constructor(privateKey) {
      this.privateKey = privateKey;
      this.address = '0x2222222222222222222222222222222222222222';
    }
    connect(provider) {
      this.provider = provider;
      return this;
    }
    async populateTransaction(tx) {
      walletCalls.populate.push(tx);
      return {
        ...tx,
        nonce: tx.nonce ?? 7,
        gasLimit: tx.gasLimit ?? '0x5208',
        chainId: tx.chainId ?? 1,
      };
    }
    async signTransaction(tx) {
      walletCalls.sign.push(tx);
      return '0xf86c_signed';
    }
  }
  return {
    ethers: {Wallet},
    FetchRequest,
    JsonRpcProvider,
    Transaction: {from: () => ({hash: '0x' + 'ab'.repeat(32)})},
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
  sleep: jest.fn(() => Promise.resolve()),
  SWAP_QUOTE_EXPIRED_ERROR: 'SWAP_QUOTE_EXPIRED',
  validateNumber: jest.fn(),
}));

const loadChain = () => {
  let EVMChain;
  jest.isolateModules(() => {
    ({
      EVMChain,
    } = require('dok-wallet-blockchain-networks/cryptoChain/chains/EVMChain'));
  });
  return EVMChain('ethereum');
};

const canonicalTx = {
  from: FROM,
  to: TO,
  data: '0x095ea7b3',
  value: '0x0',
  gasLimit: '0x5208',
  maxFeePerGas: '0x3b9aca00',
  maxPriorityFeePerGas: '0x3b9aca00',
  type: 2,
  chainId: 1,
};

describe('EVMChain WalletConnect signers', () => {
  beforeEach(() => {
    walletCalls.populate.length = 0;
    walletCalls.sign.length = 0;
    providers[PROXY_URL] = {
      broadcastTransaction: jest.fn(async () => ({hash: HASH})),
    };
    providers[FREE_1] = {
      broadcastTransaction: jest.fn(async () => ({hash: HASH})),
    };
    jest.spyOn(console, 'error').mockImplementation(() => {});
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    jest.spyOn(console, 'log').mockImplementation(() => {});
  });
  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('signRawTransaction (eth_signTransaction)', () => {
    it('populates then signs the canonical tx with chainId and 1559 fees intact', async () => {
      const chain = loadChain();
      const raw = await chain.signRawTransaction({
        payload: {transactionData: canonicalTx},
        privateKey: '0xkey',
      });
      expect(raw).toBe(SIGNED);
      expect(walletCalls.populate).toHaveLength(1);
      expect(walletCalls.populate[0]).toEqual({
        from: FROM,
        to: TO,
        data: '0x095ea7b3',
        value: '0x0',
        nonce: undefined,
        gasLimit: '0x5208',
        gasPrice: undefined,
        maxFeePerGas: '0x3b9aca00',
        maxPriorityFeePerGas: '0x3b9aca00',
        type: 2,
        chainId: 1,
      });
      // The signed object is the populated one (nonce filled in), not the input.
      expect(walletCalls.sign[0]).toMatchObject({nonce: 7, chainId: 1});
    });

    it('never forwards fields outside the allow-list to the signer', async () => {
      const chain = loadChain();
      await chain.signRawTransaction({
        payload: {
          transactionData: {
            ...canonicalTx,
            gas: '0xdead',
            authorizationList: [{}],
            accessList: [],
          },
        },
        privateKey: '0xkey',
      });
      expect(walletCalls.populate[0]).not.toHaveProperty('gas');
      expect(walletCalls.populate[0]).not.toHaveProperty('authorizationList');
      expect(walletCalls.populate[0]).not.toHaveProperty('accessList');
    });
  });

  describe('sendRawTransaction (eth_sendTransaction)', () => {
    it('populates, signs once, broadcasts the canonical tx and returns the tx hash string', async () => {
      // broadcastTransaction resolves an ethers TransactionResponse; the
      // JSON-RPC result for eth_sendTransaction must be the bare hash, or the
      // dApp (viem/wagmi) gets a serialised object where it expects 0x… .
      const txResponse = {
        _type: 'TransactionResponse',
        hash: HASH,
        nonce: 7,
        chainId: 1n,
      };
      providers[PROXY_URL].broadcastTransaction = jest.fn(
        async () => txResponse,
      );
      const chain = loadChain();
      const res = await chain.sendRawTransaction({
        payload: {transactionData: canonicalTx},
        privateKey: '0xkey',
      });
      expect(res).toBe(HASH);
      expect(walletCalls.populate[0]).toMatchObject({
        chainId: 1,
        maxFeePerGas: '0x3b9aca00',
        gasLimit: '0x5208',
      });
      expect(walletCalls.populate[0]).not.toHaveProperty('gas');
      expect(walletCalls.sign).toHaveLength(1);
      expect(providers[PROXY_URL].broadcastTransaction).toHaveBeenCalledWith(
        SIGNED,
      );
    });

    it('returns the hash string when the tx is already in the mempool', async () => {
      // Every node says "already known": createSendTransaction then looks the
      // tx up by its canonical hash, which also yields a TransactionResponse.
      const alreadyKnown = jest.fn(async () => {
        throw new Error('already known');
      });
      const existing = {_type: 'TransactionResponse', hash: HASH, nonce: 7};
      providers[PROXY_URL].broadcastTransaction = alreadyKnown;
      providers[PROXY_URL].getTransaction = jest.fn(async () => existing);
      providers[FREE_1].broadcastTransaction = alreadyKnown;
      providers[FREE_1].getTransaction = jest.fn(async () => existing);
      const chain = loadChain();
      const res = await chain.sendRawTransaction({
        payload: {transactionData: canonicalTx},
        privateKey: '0xkey',
      });
      expect(res).toBe(HASH);
    });
  });
});
