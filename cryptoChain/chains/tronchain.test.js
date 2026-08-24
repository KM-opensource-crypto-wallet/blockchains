import {TronChain} from 'dok-wallet-blockchain-networks/cryptoChain/chains/TronChain';
import {TronWeb} from 'tronweb';
import {TronScan} from 'dok-wallet-blockchain-networks/service/tronScan';

// TronChain builds its provider list from these. Tests that need failover
// override getPremiumRPCUrl to add a second, earlier provider.
jest.mock('dok-wallet-blockchain-networks/rpcUrls/rpcUrls', () => ({
  getPremiumRPCUrl: jest.fn(() => []),
  getRPCUrl: jest.fn(key =>
    key === 'tron_full_host' ? 'http://tron.test' : null,
  ),
}));

jest.mock('dok-wallet-blockchain-networks/service/tronScan', () => ({
  TronScan: {getTransactionByHash: jest.fn()},
}));

jest.mock('tronweb', () => ({TronWeb: jest.fn()}));

const {
  getPremiumRPCUrl,
} = require('dok-wallet-blockchain-networks/rpcUrls/rpcUrls');

/**
 * A TronWeb test double. Only the surface TronChain actually touches is
 * implemented; overrides are merged in per test.
 *
 * NB: getAccount results deliberately carry no `address` field. TronChain
 * caches account info at module scope for 10s and busts that cache by
 * comparing `accountInfo.address` against the requested address — leaving it
 * undefined keeps every call a real fetch, so tests stay order-independent.
 */
const fakeTronWeb = (overrides = {}) => ({
  trx: {
    getAccount: jest.fn().mockResolvedValue({balance: 1000000}),
    sign: jest.fn(async txn => ({...txn, signature: ['sig'], txID: 'txid1'})),
    sendRawTransaction: jest.fn().mockResolvedValue({result: true}),
    getTransactionInfo: jest.fn().mockResolvedValue({id: 'testTransactionId'}),
    ...(overrides.trx || {}),
  },
  transactionBuilder: {
    sendTrx: jest.fn().mockResolvedValue({raw_data: {}, txID: 'txid1'}),
    triggerSmartContract: jest
      .fn()
      .mockResolvedValue({transaction: {raw_data: {}, txID: 'txid1'}}),
    addUpdateData: jest.fn(txn => txn),
    ...(overrides.transactionBuilder || {}),
  },
  contract: jest.fn(() => ({
    at: jest.fn().mockResolvedValue({}),
    balanceOf: () => ({call: jest.fn().mockResolvedValue(5000000)}),
    name: () => ({call: jest.fn().mockResolvedValue('Tether')}),
    symbol: () => ({call: jest.fn().mockResolvedValue('USDT')}),
    decimals: () => ({call: jest.fn().mockResolvedValue(6)}),
    ...(overrides.contract || {}),
  })),
  fullNode: {
    request: jest.fn().mockResolvedValue({data: []}),
    ...(overrides.fullNode || {}),
  },
  setAddress: jest.fn(),
  toSun: jest.fn(amount => amount),
  toUtf8: jest.fn(value => value),
  isAddress: jest.fn(() => true),
  address: {
    fromPrivateKey: jest.fn(() => 'addressFromPrivateKey'),
    toHex: jest.fn(() => 'hexAddress'),
    fromHex: jest.fn(hex => `from:${hex}`),
  },
  ...overrides,
});

// Every provider attempt gets the same double unless a test says otherwise.
const useTronWeb = instance => TronWeb.mockImplementation(() => instance);

describe('TronChain', () => {
  let tronWeb;
  let instance;

  beforeEach(() => {
    jest.clearAllMocks();
    getPremiumRPCUrl.mockReturnValue([]);
    tronWeb = fakeTronWeb();
    useTronWeb(tronWeb);
    instance = TronChain();
  });

  it('should get icon name', async () => {
    await expect(instance.getIconName()).resolves.toEqual('TRX');
  });

  it('propagates a TronWeb construction failure', () => {
    const error = new Error('TronWeb creation error');
    TronWeb.mockImplementationOnce(() => {
      throw error;
    });
    expect(() => TronChain()).toThrow(error);
  });

  describe('getBalance', () => {
    it('returns the account balance as a string', async () => {
      await expect(instance.getBalance({address: 'address'})).resolves.toEqual(
        '1000000',
      );
    });

    it('returns 0 when the account has no balance', async () => {
      tronWeb.trx.getAccount.mockResolvedValue({balance: 0});
      await expect(instance.getBalance({address: 'address'})).resolves.toEqual(
        '0',
      );
    });

    it('returns 0 for an account the node does not know', async () => {
      tronWeb.trx.getAccount.mockResolvedValue({});
      await expect(
        instance.getBalance({address: 'unknown_address'}),
      ).resolves.toEqual('0');
    });

    // retryFunc falls back to its default rather than surfacing the error,
    // so a dead provider set reads as a zero balance, not a crash.
    it('falls back to 0 when every provider fails', async () => {
      tronWeb.trx.getAccount.mockRejectedValue(new Error('node down'));
      await expect(instance.getBalance({address: 'address'})).resolves.toEqual(
        '0',
      );
    });

    it('falls through to the next provider when the first one fails', async () => {
      // Two providers: a premium one first, then the trongrid fallback.
      getPremiumRPCUrl.mockReturnValue(['http://premium.test']);
      const dead = fakeTronWeb();
      dead.trx.getAccount.mockRejectedValue(new Error('node down'));
      const healthy = fakeTronWeb();
      healthy.trx.getAccount.mockResolvedValue({balance: 4242});

      TronWeb.mockImplementationOnce(() => dead) // constructed by TronChain()
        .mockImplementationOnce(() => dead) // provider 0 — fails
        .mockImplementationOnce(() => healthy); // provider 1 — succeeds
      instance = TronChain();

      await expect(instance.getBalance({address: 'address'})).resolves.toEqual(
        '4242',
      );
    });
  });

  describe('getTokenBalance', () => {
    it('reads balanceOf from the trc20 contract', async () => {
      await expect(
        instance.getTokenBalance({
          address: 'address',
          contractAddress: 'contractAddress',
        }),
      ).resolves.toEqual('5000000');
    });

    it('falls back to 0 when the contract call fails', async () => {
      tronWeb.contract.mockImplementation(() => ({
        balanceOf: () => ({
          call: jest.fn().mockRejectedValue(new Error('reverted')),
        }),
      }));
      await expect(
        instance.getTokenBalance({
          address: 'address',
          contractAddress: 'contractAddressNotOwned',
        }),
      ).resolves.toEqual('0');
    });
  });

  describe('getContract', () => {
    it('returns name, symbol and decimals', async () => {
      await expect(
        instance.getContract({contractAddress: 'contractAddress'}),
      ).resolves.toEqual({name: 'Tether', symbol: 'USDT', decimals: 6});
    });

    // The `at` lookup resolves to a contract with no name, and TronChain
    // retries through the local trc20 ABI before giving up.
    it('returns empty fields when the contract exposes no metadata', async () => {
      tronWeb.contract.mockImplementation(() => ({
        at: jest.fn().mockResolvedValue({}),
      }));
      await expect(
        instance.getContract({contractAddress: 'contractAddress'}),
      ).resolves.toEqual({name: '', symbol: '', decimals: ''});
    });

    it('falls back to an empty object when every provider fails', async () => {
      tronWeb.contract.mockImplementation(() => {
        throw new Error('Mocked error');
      });
      await expect(
        instance.getContract({contractAddress: null}),
      ).resolves.toEqual({});
    });
  });

  describe('getTransactions', () => {
    it('maps a TRX transfer into the wallet transaction shape', async () => {
      tronWeb.fullNode.request.mockResolvedValue({
        data: [
          {
            txID: 'txID123',
            blockNumber: 10,
            ret: [{contractRet: 'SUCCESS', fee: 10}],
            raw_data: {
              timestamp: 1700000000000,
              contract: [
                {
                  type: 'TransferContract',
                  parameter: {
                    value: {
                      owner_address: 'ownerHex',
                      to_address: 'toHex',
                      amount: 5000000,
                    },
                  },
                },
              ],
            },
          },
        ],
      });

      const transactions = await instance.getTransactions({address: 'address'});

      expect(transactions).toHaveLength(1);
      expect(transactions[0]).toMatchObject({
        amount: '5000000',
        link: 'txID123',
        status: 'SUCCESS',
        blockNumber: 10,
        transactionType: 'regular',
        from: 'from:ownerHex',
        to: 'from:toHex',
      });
    });
  });

  describe('send', () => {
    it('signs once and returns the broadcast result', async () => {
      const result = await instance.send({
        to: 'to',
        from: 'from',
        privateKey: 'privateKey',
        amount: '1.0',
      });

      expect(result).toMatchObject({result: true, txid: 'txid1'});
      expect(tronWeb.transactionBuilder.sendTrx).toHaveBeenCalledWith(
        'to',
        '1.0',
        'from',
      );
      // The idempotency contract: build+sign happen exactly once, so a
      // broadcast retry can never produce a second txID.
      expect(tronWeb.trx.sign).toHaveBeenCalledTimes(1);
    });

    it('strips a 0x prefix from the private key before signing', async () => {
      await instance.send({
        to: 'to',
        from: 'from',
        privateKey: '0xPRIVATEKEY',
        amount: '1.0',
      });
      expect(tronWeb.trx.sign).toHaveBeenCalledWith(
        expect.anything(),
        'PRIVATEKEY',
      );
    });

    it('treats a duplicate broadcast as success', async () => {
      tronWeb.trx.sendRawTransaction.mockResolvedValue({
        code: 'DUP_TRANSACTION_ERROR',
      });
      await expect(
        instance.send({
          to: 'to',
          from: 'from',
          privateKey: 'privateKey',
          amount: '1.0',
        }),
      ).resolves.toMatchObject({result: true, txid: 'txid1', duplicated: true});
    });

    it('rejects when the build step fails on every provider', async () => {
      const error = new Error('Mocked error');
      tronWeb.transactionBuilder.sendTrx.mockRejectedValue(error);
      await expect(
        instance.send({
          to: 'to',
          from: 'from',
          privateKey: 'privateKey',
          amount: '1.0',
        }),
      ).rejects.toThrow(error);
    });
  });

  describe('sendToken', () => {
    it('returns the broadcast result', async () => {
      await expect(
        instance.sendToken({
          contractAddress: 'contractAddress',
          to: 'to',
          from: 'from',
          amount: '1.0',
          privateKey: 'privateKey',
          decimal: 6,
        }),
      ).resolves.toMatchObject({result: true, txid: 'txid1'});
      expect(
        tronWeb.transactionBuilder.triggerSmartContract,
      ).toHaveBeenCalledTimes(1);
      expect(tronWeb.trx.sign).toHaveBeenCalledTimes(1);
    });

    it('rejects when the build step fails on every provider', async () => {
      const error = new Error('Mocked error');
      tronWeb.transactionBuilder.triggerSmartContract.mockRejectedValue(error);
      await expect(
        instance.sendToken({
          contractAddress: 'contractAddress',
          to: 'to',
          from: 'from',
          amount: '1.0',
          privateKey: 'privateKey',
          decimal: 6,
        }),
      ).rejects.toThrow(error);
    });
  });

  describe('waitForConfirmation', () => {
    it('resolves once TronScan reports SUCCESS', async () => {
      TronScan.getTransactionByHash.mockResolvedValue({data: 'SUCCESS'});
      await expect(
        instance.waitForConfirmation({
          transaction: {txid: 'txid1'},
          interval: 1,
          retries: 5,
        }),
      ).resolves.toEqual({data: 'SUCCESS'});
    });

    it('resolves to null when the transaction has no id', async () => {
      await expect(
        instance.waitForConfirmation({
          transaction: {},
          interval: 1,
          retries: 1,
        }),
      ).resolves.toBeNull();
    });
  });
});
