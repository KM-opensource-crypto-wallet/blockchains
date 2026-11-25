import {TronChain} from 'dok-wallet-blockchain-networks/cryptoChain/chains/TronChain';
import {TronWeb} from 'tronweb';
import {TronScan} from 'dok-wallet-blockchain-networks/service/tronScan';

// TronChain builds its provider list from these. getPremiumRPCUrl returns a
// URL string ('' when the chain has no proxy); tests that need failover
// override it to add a second, earlier provider.
jest.mock('dok-wallet-blockchain-networks/rpcUrls/rpcUrls', () => ({
  getPremiumRPCUrl: jest.fn(() => ''),
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
    // Full-node (latest block) reads. getAccount / getTransactionInfo above
    // are the solidity node, about 19 blocks behind the head.
    getUnconfirmedAccount: jest.fn().mockResolvedValue({balance: 1000000}),
    getUnconfirmedTransactionInfo: jest.fn().mockResolvedValue({}),
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
  // withRpcSession swaps the axios adapter on both HTTP providers.
  fullNode: {
    request: jest.fn().mockResolvedValue({data: []}),
    instance: {defaults: {}},
    ...(overrides.fullNode || {}),
  },
  solidityNode: {
    instance: {defaults: {}},
    ...(overrides.solidityNode || {}),
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
    getPremiumRPCUrl.mockReturnValue('');
    tronWeb = fakeTronWeb();
    useTronWeb(tronWeb);
    instance = TronChain();
  });

  it('should get icon name', async () => {
    await expect(instance.getIconName()).resolves.toEqual('TRX');
  });

  // The default instance is created lazily on first offline use, so
  // TronChain() itself never constructs TronWeb.
  it('constructs TronWeb lazily and propagates a construction failure', () => {
    expect(TronWeb).not.toHaveBeenCalled();
    const error = new Error('TronWeb creation error');
    TronWeb.mockImplementationOnce(() => {
      throw error;
    });
    expect(() => instance.isValidAddress({address: 'address'})).toThrow(error);
  });

  describe('getBalance', () => {
    it('returns the account balance as a string', async () => {
      await expect(instance.getBalance({address: 'address'})).resolves.toEqual(
        '1000000',
      );
    });

    it('returns 0 when the account has no balance', async () => {
      tronWeb.trx.getUnconfirmedAccount.mockResolvedValue({balance: 0});
      await expect(instance.getBalance({address: 'address'})).resolves.toEqual(
        '0',
      );
    });

    it('returns 0 for an account the node does not know', async () => {
      tronWeb.trx.getUnconfirmedAccount.mockResolvedValue({});
      await expect(
        instance.getBalance({address: 'unknown_address'}),
      ).resolves.toEqual('0');
    });

    it('reads the latest block, not the solidified state', async () => {
      // Right after a send the solidity node still has the old balance for
      // ~19 blocks; the coin screen must show the new one.
      tronWeb.trx.getAccount.mockResolvedValue({balance: 5000000});
      tronWeb.trx.getUnconfirmedAccount.mockResolvedValue({balance: 3000000});
      await expect(instance.getBalance({address: 'address'})).resolves.toEqual(
        '3000000',
      );
    });

    it('answers a refresh right after a send with the new balance, not a cached one', async () => {
      // An address the cache can match (other tests leave `address` unset).
      tronWeb.address.toHex.mockReturnValue('cacheTestHex');
      tronWeb.trx.getUnconfirmedAccount.mockResolvedValue({
        address: 'cacheTestHex',
        balance: 3000000,
      });
      await instance.getBalance({address: 'address'});

      tronWeb.trx.getUnconfirmedAccount.mockResolvedValue({
        address: 'cacheTestHex',
        balance: 2000000,
      });
      await expect(instance.getBalance({address: 'address'})).resolves.toEqual(
        '2000000',
      );
    });

    // retryFunc falls back to its default rather than surfacing the error,
    // so a dead provider set reads as a zero balance, not a crash.
    it('falls back to 0 when every provider fails', async () => {
      tronWeb.trx.getUnconfirmedAccount.mockRejectedValue(
        new Error('node down'),
      );
      await expect(instance.getBalance({address: 'address'})).resolves.toEqual(
        '0',
      );
    });

    it('falls through to the next provider when the first one fails', async () => {
      // Two providers: a premium one first, then the trongrid fallback.
      getPremiumRPCUrl.mockReturnValue('http://premium.test');
      const dead = fakeTronWeb();
      dead.trx.getUnconfirmedAccount.mockRejectedValue(new Error('node down'));
      const healthy = fakeTronWeb();
      healthy.trx.getUnconfirmedAccount.mockResolvedValue({balance: 4242});

      TronWeb.mockImplementationOnce(() => dead) // provider 0 — fails
        .mockImplementationOnce(() => healthy); // provider 1 — succeeds

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

  describe('approve', () => {
    // The swap waits for the approval to be in a block, like
    // EVMChain.approve. trx.getTransactionInfo reads the solidity node, which
    // answers only ~19 blocks (~57 s) later, after the 15 x 3 s polling window
    // has run out (DOKWALLET-WALLET-WEB-1E).
    beforeEach(() => {
      jest.useFakeTimers();
      tronWeb.trx.getTransactionInfo.mockResolvedValue({});
    });
    afterEach(() => {
      jest.useRealTimers();
    });

    const approve = () =>
      instance.approve({
        spenderAddress: 'spender',
        contractAddress: 'usdtContract',
        amountInWei: '100',
        allowance: '0',
        from: 'from',
        privateKey: 'privateKey',
      });

    // Lets the whole 15 x 3 s receipt window elapse.
    const runPollingWindow = () => jest.advanceTimersByTimeAsync(15 * 3000);

    it('confirms from the full node as soon as the approval is in a block', async () => {
      tronWeb.trx.getUnconfirmedTransactionInfo = jest
        .fn()
        .mockResolvedValue({id: 'txid1', receipt: {result: 'SUCCESS'}});

      const result = approve();
      await runPollingWindow();

      await expect(result).resolves.toMatchObject({
        confirmTransaction: {result: true, txid: 'txid1'},
      });
    });

    it('fails when the approval reverted on-chain', async () => {
      tronWeb.trx.getUnconfirmedTransactionInfo = jest
        .fn()
        .mockResolvedValue({id: 'txid1', receipt: {result: 'OUT_OF_ENERGY'}});

      const result = approve();
      const settled = expect(result).rejects.toThrow(
        'Tron approve failed: OUT_OF_ENERGY',
      );
      await runPollingWindow();
      await settled;
    });
  });

  describe('getEstimateFee', () => {
    // Chain parameters in sun, as the node reports them.
    const chainParameters = [
      {key: 'getCreateAccountFee', value: 100000},
      {key: 'getCreateNewAccountFeeInSystemContract', value: 1000000},
      {key: 'getTransactionFee', value: 1000},
      {key: 'getEnergyFee', value: 210},
      {key: 'getMemoFee', value: 1000000},
    ];
    // Latest block: the sender holds 25 TRX and the recipient has never been
    // activated. The solidified state lags: it still shows 30 TRX (before the
    // last fee burn), so reading it would overstate what can be sent.
    const SENDER_SUN = 25000000;
    const STALE_SENDER_SUN = 30000000;

    beforeEach(() => {
      tronWeb.trx.getChainParameters = jest
        .fn()
        .mockResolvedValue(chainParameters);
      tronWeb.trx.getUnconfirmedAccount.mockImplementation(async address =>
        address === 'to' ? {} : {balance: SENDER_SUN, create_time: 1},
      );
      tronWeb.trx.getAccount.mockImplementation(async address =>
        address === 'to' ? {} : {balance: STALE_SENDER_SUN, create_time: 1},
      );
      TronWeb.fromSun = jest.fn(sun => String(Number(sun) / 1e6));
    });
    afterEach(() => {
      delete TronWeb.fromSun;
    });

    const estimate = memo =>
      instance.getEstimateFee({
        fromAddress: 'from',
        toAddress: 'to',
        amount: '10',
        privateKey: 'privateKey',
        memo,
      });

    it('charges activation and account creation for a new recipient', async () => {
      await expect(estimate()).resolves.toMatchObject({fee: '1.1'});
    });

    it('treats a recipient activated in the latest blocks as existing', async () => {
      // Activated a few blocks ago: the head knows it, the solidity node not
      // yet. With 600 free bandwidth the transfer itself costs nothing.
      tronWeb.trx.getUnconfirmedAccount.mockImplementation(async () => ({
        balance: SENDER_SUN,
        create_time: 1,
      }));
      tronWeb.trx.getAccountResources = jest
        .fn()
        .mockResolvedValue({freeNetLimit: 600, freeNetUsed: 0});
      tronWeb.transactionBuilder.sendTrx.mockResolvedValue({
        raw_data: {},
        raw_data_hex: 'ab'.repeat(100),
        txID: 'txid1',
      });

      await expect(estimate()).resolves.toMatchObject({fee: '0'});
    });

    it('adds the memo fee for a new recipient too', async () => {
      // 1 TRX activation + 0.1 TRX account creation + 1 TRX memo.
      await expect(estimate('invoice 42')).resolves.toMatchObject({
        fee: '2.1',
      });
    });

    it("reports the sender's live liquid balance, so Max never uses a stale cached one", async () => {
      // DOKWALLET-WALLET-WEB-1J: a TRC20 send burned TRX for energy, the
      // cached TRX balance was read before that, and Max overshot.
      await expect(estimate()).resolves.toMatchObject({
        spendableBalance: '25',
      });
    });
  });

  describe('waitForConfirmation', () => {
    // A transfer counts as done once it is in a block (~3 s), read from the
    // full node on web and mobile alike; the solidity node only answers ~19
    // blocks later and TronScan is no longer asked.
    const confirm = (retries = 5) =>
      instance.waitForConfirmation({
        transaction: {txid: 'txid1'},
        interval: 1,
        retries,
      });

    it('resolves once the transaction is in a block', async () => {
      tronWeb.trx.getTransactionInfo.mockResolvedValue({});
      tronWeb.trx.getUnconfirmedTransactionInfo
        .mockResolvedValueOnce({})
        .mockResolvedValue({id: 'txid1', blockNumber: 88313173});

      await expect(confirm()).resolves.toMatchObject({id: 'txid1'});
      expect(TronScan.getTransactionByHash).not.toHaveBeenCalled();
    });

    it('rejects with the receipt result when the contract call failed', async () => {
      tronWeb.trx.getUnconfirmedTransactionInfo.mockResolvedValue({
        id: 'txid1',
        receipt: {result: 'OUT_OF_ENERGY'},
      });

      await expect(confirm()).rejects.toBe('OUT_OF_ENERGY');
    });

    it('resolves pending when the transaction never shows up', async () => {
      tronWeb.trx.getUnconfirmedTransactionInfo.mockResolvedValue({});

      await expect(confirm(3)).resolves.toBe('pending');
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
