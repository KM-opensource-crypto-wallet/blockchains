/**
 * Runner: this suite loads the real @hiero-ledger/sdk (CJS build), which the
 * React Native jest preset resolves to an untransformed ESM entry. Run it with
 * a plain node environment: testEnvironment "node", testMatch pointing at this
 * file, and a moduleNameMapper sending image imports to
 * dok-wallet-blockchain-networks/__mocks__/fileMock.js.
 */
import {
  HederaChain,
  __resetHederaAccountCache,
  resolveHederaAccountId,
  toMirrorTransactionId,
} from 'dok-wallet-blockchain-networks/cryptoChain/chains/HederaChain';
import {HEDERA} from 'dok-wallet-blockchain-networks/service/Hedera';
import {createWallet} from 'myWallet/wallet.service';
import {
  HEDERA_KEY_MISMATCH_MESSAGE,
  HEDERA_UNACTIVATED_MESSAGE,
} from 'dok-wallet-blockchain-networks/helper';

jest.mock('dok-wallet-blockchain-networks/service/Hedera', () => ({
  HEDERA: {
    getAccountByEvmAddress: jest.fn(),
    getAccountInfo: jest.fn(),
    getExchangeFee: jest.fn(),
    getTransactions: jest.fn(),
    getTransaction: jest.fn(),
  },
}));

jest.mock('myWallet/wallet.service', () => ({createWallet: jest.fn()}));

// helper/index.js drags in react-native through utils/common; only these
// exports are used here.
jest.mock('dok-wallet-blockchain-networks/helper', () => ({
  getExplorerTxUrl: jest.fn((chain, hash) => `https://hashscan.test/${hash}`),
  HEDERA_UNACTIVATED_MESSAGE: 'Your Hedera account is not active yet.',
  HEDERA_KEY_MISMATCH_MESSAGE: 'This Hedera account is bound to another key.',
}));

// Real AccountId / Hbar / PrivateKey / AccountCreateTransaction; only the
// network surface (client, transfer submit, fee estimator) is faked.
jest.mock('@hiero-ledger/sdk', () => {
  const actual = jest.requireActual('@hiero-ledger/sdk');
  const execute = jest.fn();
  const estimate = jest.fn();
  const fakeClient = {
    setOperator: jest.fn(function () {
      return this;
    }),
    close: jest.fn(),
  };
  class FakeTransferTransaction {
    constructor() {
      this.transfers = [];
    }
    addHbarTransfer(accountId, amount) {
      this.transfers.push({accountId, amount});
      return this;
    }
    setTransactionMemo(memo) {
      this.memo = memo;
      return this;
    }
    setMaxTransactionFee(fee) {
      this.maxFee = fee;
      return this;
    }
    setTransactionId(id) {
      this.transactionId = id;
      return this;
    }
    setNodeAccountIds(ids) {
      this.nodeAccountIds = ids;
      return this;
    }
    freeze() {
      this.frozen = true;
      return this;
    }
    execute(client) {
      return execute(this, client);
    }
  }
  class FakeFeeEstimateQuery {
    setTransaction(transaction) {
      this.transaction = transaction;
      return this;
    }
    setMode(mode) {
      this.mode = mode;
      return this;
    }
    execute(client) {
      return estimate(this.transaction, this.mode, client);
    }
  }
  return {
    ...actual,
    Client: {
      forTestnet: jest.fn(() => fakeClient),
      forMainnet: jest.fn(() => fakeClient),
    },
    TransferTransaction: FakeTransferTransaction,
    FeeEstimateQuery: FakeFeeEstimateQuery,
    __execute: execute,
    __estimate: estimate,
    __fakeClient: fakeClient,
  };
});

const sdk = require('@hiero-ledger/sdk');

const PRIVATE_KEY = `0x${'a'.repeat(64)}`;
const OUR_PUBLIC_KEY =
  sdk.PrivateKey.fromStringECDSA(PRIVATE_KEY).publicKey.toStringRaw();
const OTHER_PUBLIC_KEY = sdk.PrivateKey.fromStringECDSA(
  `0x${'b'.repeat(64)}`,
).publicKey.toStringRaw();
const EVM_CHECKSUMMED = '0xAb5801a7D398351b8bE11C439e05C5B3259aeC9B';
const EVM = EVM_CHECKSUMMED.toLowerCase();
const ACCOUNT_ID = '0.0.4459557';

const tinycents = value => ({total: {toString: () => String(value)}});
const TRANSFER_TINYCENTS = 1_000_000; // $0.0001
const CREATE_TINYCENTS = 500_000_000; // $0.05

const accountWithKey = key => ({status: 200, data: {account: ACCOUNT_ID, key}});

describe('HederaChain', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // mockResolvedValue outlives clearAllMocks; start every test from
    // "network returns nothing" so a key or estimate mock cannot leak.
    Object.values(HEDERA).forEach(fn => fn.mockReset());
    sdk.__execute.mockReset();
    sdk.__estimate.mockReset();
    __resetHederaAccountCache();
    jest.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => {
    console.error.mockRestore();
  });

  describe('wallet creation', () => {
    it('returns the lowercase EVM address without touching the network', async () => {
      createWallet.mockResolvedValue({
        address: EVM_CHECKSUMMED,
        privateKey: PRIVATE_KEY,
      });
      const wallet = await HederaChain().createHederaWallet({
        mnemonic: 'seed',
      });
      expect(wallet).toEqual({address: EVM, privateKey: PRIVATE_KEY});
      expect(HEDERA.getAccountByEvmAddress).not.toHaveBeenCalled();
      expect(sdk.__execute).not.toHaveBeenCalled();
    });

    it('derives the same shape from a raw private key', async () => {
      const wallet = await HederaChain().createWalletByPrivateKey({
        privateKey: PRIVATE_KEY,
      });
      expect(wallet.address).toMatch(/^0x[0-9a-f]{40}$/);
      expect(wallet.privateKey).toBe(PRIVATE_KEY);
    });
  });

  describe('resolveHederaAccountId', () => {
    it('passes account ids through without a lookup', async () => {
      await expect(resolveHederaAccountId(ACCOUNT_ID)).resolves.toBe(
        ACCOUNT_ID,
      );
      expect(HEDERA.getAccountByEvmAddress).not.toHaveBeenCalled();
    });

    it('resolves a funded EVM address once and caches it', async () => {
      HEDERA.getAccountByEvmAddress.mockResolvedValue(ACCOUNT_ID);
      await expect(resolveHederaAccountId(EVM_CHECKSUMMED)).resolves.toBe(
        ACCOUNT_ID,
      );
      await expect(resolveHederaAccountId(EVM)).resolves.toBe(ACCOUNT_ID);
      expect(HEDERA.getAccountByEvmAddress).toHaveBeenCalledTimes(1);
      expect(HEDERA.getAccountByEvmAddress).toHaveBeenCalledWith(EVM);
    });

    it('returns null for an unfunded address and backs off re-checking', async () => {
      HEDERA.getAccountByEvmAddress.mockResolvedValue(null);
      await expect(resolveHederaAccountId(EVM)).resolves.toBeNull();
      await expect(resolveHederaAccountId(EVM)).resolves.toBeNull();
      expect(HEDERA.getAccountByEvmAddress).toHaveBeenCalledTimes(1);
      __resetHederaAccountCache();
      await resolveHederaAccountId(EVM);
      expect(HEDERA.getAccountByEvmAddress).toHaveBeenCalledTimes(2);
    });

    it('propagates a mirror-node failure without caching it as a miss', async () => {
      HEDERA.getAccountByEvmAddress.mockRejectedValueOnce(
        new Error('Network Error'),
      );
      await expect(resolveHederaAccountId(EVM)).rejects.toThrow(
        'Network Error',
      );
      HEDERA.getAccountByEvmAddress.mockResolvedValue(ACCOUNT_ID);
      await expect(resolveHederaAccountId(EVM)).resolves.toBe(ACCOUNT_ID);
      expect(HEDERA.getAccountByEvmAddress).toHaveBeenCalledTimes(2);
    });

    it('returns null for anything that is neither form', async () => {
      await expect(resolveHederaAccountId('0.0.abc')).resolves.toBeNull();
      await expect(resolveHederaAccountId(undefined)).resolves.toBeNull();
    });
  });

  describe('attachAccountId', () => {
    it('adds the account id next to a funded EVM address', async () => {
      HEDERA.getAccountByEvmAddress.mockResolvedValue(ACCOUNT_ID);
      const wallet = {address: EVM, privateKey: PRIVATE_KEY};
      await expect(HederaChain().attachAccountId(wallet)).resolves.toEqual({
        address: EVM,
        privateKey: PRIVATE_KEY,
        accountId: ACCOUNT_ID,
      });
    });

    it('leaves an unfunded wallet untouched', async () => {
      HEDERA.getAccountByEvmAddress.mockResolvedValue(null);
      const fresh = {address: EVM, privateKey: PRIVATE_KEY};
      await expect(HederaChain().attachAccountId(fresh)).resolves.toBe(fresh);
    });

    it('leaves the wallet untouched when the mirror node is down', async () => {
      HEDERA.getAccountByEvmAddress.mockRejectedValue(new Error('timeout'));
      const fresh = {address: EVM, privateKey: PRIVATE_KEY};
      await expect(HederaChain().attachAccountId(fresh)).resolves.toBe(fresh);
    });

    it('skips the lookup when the id is already known', async () => {
      const known = {
        address: EVM,
        privateKey: PRIVATE_KEY,
        accountId: ACCOUNT_ID,
      };
      await expect(HederaChain().attachAccountId(known)).resolves.toBe(known);
      expect(HEDERA.getAccountByEvmAddress).not.toHaveBeenCalled();
    });

    it('migrates a legacy 0.0.N wallet to its EVM address once', async () => {
      const legacy = {address: ACCOUNT_ID, privateKey: PRIVATE_KEY};
      const migrated = await HederaChain().attachAccountId(legacy);
      expect(migrated.accountId).toBe(ACCOUNT_ID);
      expect(migrated.address).toMatch(/^0x[0-9a-f]{40}$/);
      expect(migrated.privateKey).toBe(PRIVATE_KEY);
      expect(HEDERA.getAccountByEvmAddress).not.toHaveBeenCalled();
      // Without a key there is nothing to derive from; leave it alone.
      const keyless = {address: ACCOUNT_ID};
      await expect(HederaChain().attachAccountId(keyless)).resolves.toBe(
        keyless,
      );
    });
  });

  describe('lookupAddressIdentifiers', () => {
    it('resolves a funded EVM address to its account id', async () => {
      HEDERA.getAccountByEvmAddress.mockResolvedValue(ACCOUNT_ID);
      await expect(
        HederaChain().lookupAddressIdentifiers({address: EVM_CHECKSUMMED}),
      ).resolves.toEqual({
        inputType: 'evmAddress',
        accountId: ACCOUNT_ID,
        evmAddress: EVM,
        exists: true,
      });
    });

    it('flags an unfunded EVM address as new', async () => {
      HEDERA.getAccountByEvmAddress.mockResolvedValue(null);
      await expect(
        HederaChain().lookupAddressIdentifiers({address: EVM}),
      ).resolves.toEqual({
        inputType: 'evmAddress',
        accountId: null,
        evmAddress: EVM,
        exists: false,
      });
    });

    it('returns the EVM address of an existing 0.0.N account', async () => {
      HEDERA.getAccountInfo.mockResolvedValue({
        data: {account: ACCOUNT_ID, evm_address: EVM_CHECKSUMMED},
      });
      await expect(
        HederaChain().lookupAddressIdentifiers({address: ` ${ACCOUNT_ID} `}),
      ).resolves.toEqual({
        inputType: 'accountId',
        accountId: ACCOUNT_ID,
        evmAddress: EVM,
        exists: true,
      });
    });

    it('reports a missing 0.0.N account and ignores garbage', async () => {
      HEDERA.getAccountInfo.mockResolvedValue({status: 404, data: null});
      await expect(
        HederaChain().lookupAddressIdentifiers({address: ACCOUNT_ID}),
      ).resolves.toMatchObject({
        inputType: 'accountId',
        accountId: ACCOUNT_ID,
        exists: false,
      });
      await expect(
        HederaChain().lookupAddressIdentifiers({address: 'hello'}),
      ).resolves.toEqual({
        inputType: 'unknown',
        accountId: null,
        evmAddress: null,
        exists: false,
      });
    });
  });

  describe('getAccountIdentifiers', () => {
    it('derives the EVM address for a legacy 0.0.N wallet', async () => {
      const ids = await HederaChain().getAccountIdentifiers({
        address: ACCOUNT_ID,
        privateKey: PRIVATE_KEY,
      });
      expect(ids.accountId).toBe(ACCOUNT_ID);
      expect(ids.evmAddress).toMatch(/^0x[0-9a-f]{40}$/);
      expect(ids.isActivated).toBe(true);
    });

    it('reports an unfunded EVM wallet as not activated', async () => {
      HEDERA.getAccountByEvmAddress.mockResolvedValue(null);
      const ids = await HederaChain().getAccountIdentifiers({address: EVM});
      expect(ids).toEqual({
        evmAddress: EVM,
        accountId: null,
        isActivated: false,
      });
    });
  });

  describe('isValidAddress', () => {
    const chain = HederaChain();
    it.each([ACCOUNT_ID, EVM, EVM_CHECKSUMMED, '0.0.1'])(
      'accepts %s',
      address => {
        expect(chain.isValidAddress({address})).toBe(true);
      },
    );
    it.each(['', 'hello', '0x1234', 'abc.def.ghi'])('rejects %s', address => {
      expect(chain.isValidAddress({address})).toBe(false);
    });
  });

  describe('getBalance', () => {
    it('reads zero for an address with no account and does not throw', async () => {
      HEDERA.getAccountInfo.mockResolvedValue({status: 404, data: null});
      await expect(HederaChain().getBalance({address: EVM})).resolves.toBe('0');
      HEDERA.getAccountInfo.mockRejectedValue(new Error('timeout'));
      await expect(HederaChain().getBalance({address: EVM})).resolves.toBe('0');
    });
  });

  describe('getTransactions', () => {
    const mirrorTx = (transfers, extra = {}) => ({
      transaction_id: '0.0.4459557-1700000000-000000001',
      consensus_timestamp: '1700000000.000000001',
      result: 'SUCCESS',
      charged_tx_fee: 5,
      transfers,
      ...extra,
    });

    it('returns nothing for a wallet with no account yet', async () => {
      HEDERA.getAccountByEvmAddress.mockResolvedValue(null);
      await expect(
        HederaChain().getTransactions({address: EVM}),
      ).resolves.toEqual([]);
      expect(HEDERA.getTransactions).not.toHaveBeenCalled();
    });

    it('queries by account id but reports our side as the stored address', async () => {
      HEDERA.getAccountByEvmAddress.mockResolvedValue(ACCOUNT_ID);
      HEDERA.getTransactions.mockResolvedValue({
        data: [
          mirrorTx([
            {account: '0.0.98', amount: 5},
            {account: ACCOUNT_ID, amount: -105},
            {account: '0.0.900', amount: 100},
          ]),
          mirrorTx([
            {account: '0.0.98', amount: 3},
            {account: '0.0.777', amount: -53},
            {account: ACCOUNT_ID, amount: 50},
          ]),
        ],
      });
      const list = await HederaChain().getTransactions({address: EVM});
      expect(HEDERA.getTransactions).toHaveBeenCalledWith(ACCOUNT_ID);
      expect(list[0]).toMatchObject({
        from: EVM,
        to: '0.0.900',
        amount: '100',
        status: 'SUCCESS',
        date: 1700000000000,
        link: '0.0.4459557-1700000000-000000001',
        transactionType: 'regular',
      });
      expect(list[1]).toMatchObject({from: '0.0.777', to: EVM, amount: '50'});
    });

    it('keeps 0.0.N as the self side for legacy wallets', async () => {
      HEDERA.getTransactions.mockResolvedValue({
        data: [
          mirrorTx([
            {account: '0.0.98', amount: 3},
            {account: '0.0.777', amount: -53},
            {account: ACCOUNT_ID, amount: 50},
          ]),
        ],
      });
      const list = await HederaChain().getTransactions({address: ACCOUNT_ID});
      expect(list[0]).toMatchObject({from: '0.0.777', to: ACCOUNT_ID});
      expect(HEDERA.getAccountByEvmAddress).not.toHaveBeenCalled();
    });
  });

  describe('getTransaction', () => {
    it('picks the parties out of the transfer list instead of fixed indexes', async () => {
      HEDERA.getTransaction.mockResolvedValue({
        data: {
          consensus_timestamp: '1700000000.5',
          result: 'SUCCESS',
          charged_tx_fee: 5,
          transfers: [
            {account: '0.0.3', amount: 2},
            {account: '0.0.98', amount: 3},
            {account: '0.0.900', amount: 100},
            {account: ACCOUNT_ID, amount: -105},
          ],
        },
      });
      const {data} = await HederaChain().getTransaction({
        txHash: 'x',
        address: ACCOUNT_ID,
      });
      expect(data).toMatchObject({
        from: ACCOUNT_ID,
        to: '0.0.900',
        amount: '100',
        link: 'x',
        status: 'SUCCESS',
        date: 1700000000000,
      });
    });

    it('reports a transaction the mirror node has not indexed yet as missing', async () => {
      HEDERA.getTransaction.mockResolvedValue({status: 404, data: null});
      await expect(
        HederaChain().getTransaction({txHash: 'x', address: ACCOUNT_ID}),
      ).resolves.toEqual({data: null});
    });
  });

  describe('getEstimateFee', () => {
    beforeEach(() => {
      // 1 HBAR = $0.12
      HEDERA.getExchangeFee.mockResolvedValue({
        data: {current_rate: {cent_equivalent: 12, hbar_equivalent: 1}},
      });
      sdk.__estimate.mockImplementation(async transaction =>
        transaction instanceof sdk.AccountCreateTransaction
          ? tinycents(CREATE_TINYCENTS)
          : tinycents(TRANSFER_TINYCENTS),
      );
    });

    it('prices the transfer with the fee estimator and caps the max fee above it', async () => {
      const fee = await HederaChain().getEstimateFee({
        toAddress: ACCOUNT_ID,
        privateKey: PRIVATE_KEY,
        memo: 'hi',
      });
      // $0.0001 at $0.12/HBAR, rounded up to 8 decimals
      expect(fee.estimatedFee).toBe('0.00083334');
      expect(fee.fee).toBe('0.00125001');
      expect(fee.transactionFee).toBe(fee.fee);
      expect(sdk.__estimate).toHaveBeenCalledTimes(1);
      const [transaction, mode] = sdk.__estimate.mock.calls[0];
      expect(mode).toBe(sdk.FeeEstimateMode.INTRINSIC);
      expect(transaction.frozen).toBe(true);
      expect(transaction.transfers[1].accountId).toBe(ACCOUNT_ID);
      expect(transaction.memo).toBe('hi');
      expect(HEDERA.getAccountByEvmAddress).not.toHaveBeenCalled();
      expect(sdk.__fakeClient.close).toHaveBeenCalled();
    });

    it('adds the estimated account creation cost for an unfunded EVM recipient', async () => {
      HEDERA.getAccountByEvmAddress.mockResolvedValue(null);
      const fee = await HederaChain().getEstimateFee({
        toAddress: EVM_CHECKSUMMED,
        privateKey: PRIVATE_KEY,
      });
      expect(Number(fee.estimatedFee)).toBeCloseTo((0.0001 + 0.05) / 0.12, 7);
      expect(sdk.__estimate).toHaveBeenCalledTimes(2);
      const [create] = sdk.__estimate.mock.calls[1];
      expect(create).toBeInstanceOf(sdk.AccountCreateTransaction);
      expect(create.alias.toString()).toBe(EVM.slice(2));
      expect(create.key.toStringRaw()).toBe(OUR_PUBLIC_KEY);
    });

    it('does not add it when the EVM recipient already has an account', async () => {
      HEDERA.getAccountByEvmAddress.mockResolvedValue('0.0.900');
      const fee = await HederaChain().getEstimateFee({toAddress: EVM});
      expect(fee.estimatedFee).toBe('0.00083334');
      expect(sdk.__estimate).toHaveBeenCalledTimes(1);
    });

    it('fails instead of guessing when the estimator or the rate is unavailable', async () => {
      sdk.__estimate.mockRejectedValueOnce(
        new Error('Failed to estimate fees'),
      );
      await expect(
        HederaChain().getEstimateFee({toAddress: ACCOUNT_ID}),
      ).rejects.toThrow('Failed to estimate fees');
      HEDERA.getExchangeFee.mockResolvedValue(undefined);
      await expect(
        HederaChain().getEstimateFee({toAddress: ACCOUNT_ID}),
      ).rejects.toThrow('Invalid HBAR exchange rate');
      expect(sdk.__fakeClient.close).toHaveBeenCalledTimes(2);
    });
  });

  describe('send', () => {
    const sendFrom = (from = EVM) =>
      HederaChain().send({
        to: ACCOUNT_ID,
        from,
        amount: '1',
        privateKey: PRIVATE_KEY,
      });

    beforeEach(() => {
      sdk.__execute.mockResolvedValue({
        transactionId: {toString: () => `${ACCOUNT_ID}@1700000000.5`},
        transactionHash: new Uint8Array([1, 2, 255]),
      });
    });

    it('refuses to send from a wallet that has no account yet', async () => {
      HEDERA.getAccountByEvmAddress.mockResolvedValue(null);
      await expect(sendFrom()).rejects.toThrow(HEDERA_UNACTIVATED_MESSAGE);
      expect(sdk.__execute).not.toHaveBeenCalled();
    });

    it('signs as the resolved account id and returns a mirror-style transaction id', async () => {
      HEDERA.getAccountByEvmAddress.mockResolvedValue(ACCOUNT_ID);
      HEDERA.getAccountInfo.mockResolvedValue(
        accountWithKey({_type: 'ECDSA_SECP256K1', key: OUR_PUBLIC_KEY}),
      );
      const result = await HederaChain().send({
        to: EVM,
        from: EVM,
        amount: '1.123456789',
        privateKey: PRIVATE_KEY,
        memo: 'hi',
        transactionFee: '0.0175',
      });
      expect(HEDERA.getAccountInfo).toHaveBeenCalledWith(ACCOUNT_ID);
      expect(sdk.__fakeClient.setOperator).toHaveBeenCalledWith(
        ACCOUNT_ID,
        expect.anything(),
      );
      const [tx] = sdk.__execute.mock.calls[0];
      expect(tx.transfers[0].accountId).toBe(ACCOUNT_ID);
      expect(tx.transfers[0].amount.toTinybars().toString()).toBe('-112345678');
      expect(tx.transfers[1].accountId).toBe(EVM);
      expect(tx.transfers[1].amount.toTinybars().toString()).toBe('112345678');
      expect(tx.maxFee.toTinybars().toString()).toBe('1750000');
      expect(tx.memo).toBe('hi');
      expect(result.transactionId).toBe(`${ACCOUNT_ID}-1700000000-000000005`);
      expect(result.transactionHash).toBe('0102ff');
      expect(sdk.__fakeClient.close).toHaveBeenCalled();
    });

    it('refuses to sign for an account bound to another ECDSA key', async () => {
      HEDERA.getAccountInfo.mockResolvedValue(
        accountWithKey({_type: 'ECDSA_SECP256K1', key: OTHER_PUBLIC_KEY}),
      );
      await expect(sendFrom(ACCOUNT_ID)).rejects.toThrow(
        HEDERA_KEY_MISMATCH_MESSAGE,
      );
      expect(sdk.__fakeClient.setOperator).not.toHaveBeenCalled();
      expect(sdk.__execute).not.toHaveBeenCalled();
    });

    it('refuses to sign for an account bound to an ED25519 key', async () => {
      HEDERA.getAccountInfo.mockResolvedValue(
        accountWithKey({_type: 'ED25519', key: 'c'.repeat(64)}),
      );
      await expect(sendFrom(ACCOUNT_ID)).rejects.toThrow(
        HEDERA_KEY_MISMATCH_MESSAGE,
      );
      expect(sdk.__execute).not.toHaveBeenCalled();
    });

    it('signs for a hollow account, a threshold key and when the mirror node is down', async () => {
      HEDERA.getAccountInfo.mockResolvedValueOnce(accountWithKey(null));
      await expect(sendFrom(ACCOUNT_ID)).resolves.toBeTruthy();
      HEDERA.getAccountInfo.mockResolvedValueOnce(
        accountWithKey({_type: 'ProtobufEncoded', key: '2a...'}),
      );
      await expect(sendFrom(ACCOUNT_ID)).resolves.toBeTruthy();
      HEDERA.getAccountInfo.mockRejectedValueOnce(new Error('timeout'));
      await expect(sendFrom(ACCOUNT_ID)).resolves.toBeTruthy();
      expect(sdk.__execute).toHaveBeenCalledTimes(3);
    });

    it('propagates SDK failures instead of resolving undefined', async () => {
      sdk.__execute.mockRejectedValue(new Error('INSUFFICIENT_TX_FEE'));
      await expect(sendFrom(ACCOUNT_ID)).rejects.toThrow('INSUFFICIENT_TX_FEE');
      expect(sdk.__fakeClient.close).toHaveBeenCalled();
    });
  });

  describe('sendRawTransaction', () => {
    it('refuses to sign a WalletConnect transaction for an account bound to another key', async () => {
      HEDERA.getAccountInfo.mockResolvedValue(
        accountWithKey({_type: 'ECDSA_SECP256K1', key: OTHER_PUBLIC_KEY}),
      );
      await expect(
        HederaChain().sendRawTransaction({
          signTypeData: {
            signerAccountId: `hedera:testnet:${ACCOUNT_ID}`,
            transactionList: 'AA==',
          },
          privateKey: PRIVATE_KEY,
        }),
      ).rejects.toThrow(HEDERA_KEY_MISMATCH_MESSAGE);
      expect(HEDERA.getAccountInfo).toHaveBeenCalledWith(ACCOUNT_ID);
      expect(sdk.__fakeClient.setOperator).not.toHaveBeenCalled();
    });
  });

  describe('waitForConfirmation', () => {
    it('reads the receipt with a keyless client and returns the send result', async () => {
      const getReceipt = jest
        .fn()
        .mockResolvedValue({status: sdk.Status.Success});
      const sent = {transactionId: 'x', response: {getReceipt}};
      await expect(
        HederaChain().waitForConfirmation({transaction: sent}),
      ).resolves.toBe(sent);
      expect(getReceipt).toHaveBeenCalledWith(sdk.__fakeClient);
      expect(sdk.__fakeClient.setOperator).not.toHaveBeenCalled();
    });
  });

  it('formats SDK transaction ids the way the mirror node does', () => {
    expect(toMirrorTransactionId('0.0.5@1700000000.000000042')).toBe(
      '0.0.5-1700000000-000000042',
    );
    expect(toMirrorTransactionId('0.0.5@1700000000.7?scheduled')).toBe(
      '0.0.5-1700000000-000000007',
    );
  });
});
