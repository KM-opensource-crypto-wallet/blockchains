/**
 * HIP-820 WalletConnect methods, checked against the wire shapes the reference
 * wallet (@hashgraph/hedera-wallet-connect HIP820Wallet) produces.
 *
 * Runner: same as HederaChain.test.js (node env, image moduleNameMapper).
 * Keys, transactions, queries and protobuf encoding are real; only the network
 * calls (`execute`) and the mirror-node lookups are faked.
 */
import {
  AccountBalance,
  AccountBalanceQuery,
  AccountId,
  Client,
  Hbar,
  PrecheckStatusError,
  PrivateKey,
  Query,
  Status,
  Transaction,
  TransactionId,
  TransactionResponse,
  TransferTransaction,
} from '@hiero-ledger/sdk';
import {proto} from '@hiero-ledger/proto';
import {Buffer} from 'buffer';
import {HederaChain} from 'dok-wallet-blockchain-networks/cryptoChain/chains/HederaChain';
import {HEDERA} from 'dok-wallet-blockchain-networks/service/Hedera';
import {EVMChain} from 'dok-wallet-blockchain-networks/cryptoChain/chains/EVMChain';

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
jest.mock('dok-wallet-blockchain-networks/helper', () => ({
  getExplorerTxUrl: jest.fn(),
  HEDERA_UNACTIVATED_MESSAGE: 'Your Hedera account is not active yet.',
  HEDERA_KEY_MISMATCH_MESSAGE: 'This Hedera account is bound to another key.',
}));
jest.mock('dok-wallet-blockchain-networks/cryptoChain/chains/EVMChain', () => ({
  EVMChain: jest.fn((chain_name, phrase, customRpcUrl) => ({
    chain_name,
    phrase,
    customRpcUrl,
  })),
}));

// Real clients (node lists, freezing) with the network surface recorded.
const clients = [];
jest.mock('@hiero-ledger/sdk', () => {
  const actual = jest.requireActual('@hiero-ledger/sdk');
  const makeClient = network => {
    const client = actual.Client.forName(network || 'testnet');
    client.setOperator = jest.fn(client.setOperator.bind(client));
    client.close = jest.fn(client.close.bind(client));
    clients.push(client);
    return client;
  };
  return {
    ...actual,
    Client: {
      forName: jest.fn(makeClient),
      forTestnet: jest.fn(() => makeClient('testnet')),
      forMainnet: jest.fn(() => makeClient('mainnet')),
    },
  };
});

const key = PrivateKey.generateECDSA();
const privateKey = key.toStringRaw();
const SIGNER = 'hedera:testnet:0.0.1234';
const ACCOUNT_ID = '0.0.1234';

const b64 = bytes => Buffer.from(bytes).toString('base64');
const decodeSignatureMap = signatureMap =>
  proto.SignatureMap.decode(Buffer.from(signatureMap, 'base64'));

const sampleResponse = () =>
  new TransactionResponse({
    nodeId: new AccountId(3),
    transactionHash: new Uint8Array([1, 2, 255]),
    transactionId: TransactionId.fromString('0.0.1234@1700000000.000000001'),
  });

const precheckError = () =>
  new PrecheckStatusError({
    status: Status.InsufficientPayerBalance,
    transactionId: TransactionId.fromString('0.0.1234@1700000000.000000001'),
    nodeId: new AccountId(3),
    contractFunctionResult: null,
  });

const unfrozenTransfer = () =>
  new TransferTransaction()
    .addHbarTransfer(ACCOUNT_ID, new Hbar(-1))
    .addHbarTransfer('0.0.3', new Hbar(1))
    .setTransactionMemo('wc');

// A dApp-side freeze: explicit payer transaction id, keyless client.
const frozenTransfer = () =>
  unfrozenTransfer()
    .setTransactionId(TransactionId.generate(ACCOUNT_ID))
    .freezeWith(Client.forName('testnet'));

let executeSpy;
let queryExecuteSpy;

beforeEach(() => {
  jest.clearAllMocks();
  clients.length = 0;
  jest.spyOn(console, 'error').mockImplementation(() => {});
  executeSpy = jest.spyOn(Transaction.prototype, 'execute');
  queryExecuteSpy = jest.spyOn(Query.prototype, 'execute');
  // Our key controls the account (the operator-key guard reads this).
  HEDERA.getAccountInfo.mockResolvedValue({
    data: {key: {_type: 'ECDSA_SECP256K1', key: key.publicKey.toStringRaw()}},
  });
});

afterEach(() => {
  console.error.mockRestore();
  executeSpy.mockRestore();
  queryExecuteSpy.mockRestore();
  // Real clients hold gRPC channels; close them so jest can exit.
  clients.forEach(client => {
    try {
      client.close();
    } catch (e) {
      // already closed
    }
  });
});

describe('hedera_signMessage → signMessage', () => {
  it('signs the HIP-820 prefixed message and returns a protobuf SignatureMap', async () => {
    const message = 'Hello Future';
    const {signatureMap} = await HederaChain().signMessage({
      signTypeData: {signerAccountId: SIGNER, message},
      privateKey,
    });

    const {sigPair} = decodeSignatureMap(signatureMap);
    expect(sigPair).toHaveLength(1);
    expect(Buffer.from(sigPair[0].pubKeyPrefix)).toEqual(
      Buffer.from(key.publicKey.toBytesRaw()),
    );
    const prefixed = Buffer.from(
      `\x19Hedera Signed Message:\n${message.length}${message}`,
    );
    expect(key.publicKey.verify(prefixed, sigPair[0].ECDSASecp256k1)).toBe(
      true,
    );
    // The raw message must not verify: the prefix is what prevents a dApp
    // from smuggling transaction bytes through signMessage.
    expect(
      key.publicKey.verify(Buffer.from(message), sigPair[0].ECDSASecp256k1),
    ).toBe(false);
  });

  it('prefixes non-ASCII messages with the JS string length, matching @hashgraph/hedera-wallet-connect', async () => {
    // 'é' is 1 char / 2 bytes, '漢' is 1 char / 3 bytes, '😀' is 2 UTF-16
    // code units / 4 bytes, so string length (5) and byte length (10) differ.
    const message = 'é漢😀!';
    expect(message.length).not.toBe(Buffer.byteLength(message, 'utf8'));
    const {signatureMap} = await HederaChain().signMessage({
      signTypeData: {signerAccountId: SIGNER, message},
      privateKey,
    });
    const {sigPair} = decodeSignatureMap(signatureMap);

    // Same construction as verifyMessageSignature in the reference library.
    const referencePrefixed = Buffer.from(
      `\x19Hedera Signed Message:\n${message.length}${message}`,
    );
    expect(
      key.publicKey.verify(referencePrefixed, sigPair[0].ECDSASecp256k1),
    ).toBe(true);

    // A byte-length prefix must NOT verify, or dApps would reject us.
    const byteLengthPrefixed = Buffer.from(
      `\x19Hedera Signed Message:\n${Buffer.byteLength(
        message,
        'utf8',
      )}${message}`,
    );
    expect(
      key.publicKey.verify(byteLengthPrefixed, sigPair[0].ECDSASecp256k1),
    ).toBe(false);
  });

  it('rejects a non-string message', async () => {
    await expect(
      HederaChain().signMessage({
        signTypeData: {signerAccountId: SIGNER, message: {text: 'x'}},
        privateKey,
      }),
    ).rejects.toThrow(/message/);
  });
});

describe('hedera_signTransaction → signRawTransaction', () => {
  const bodyBytes = () => {
    const tx = frozenTransfer();
    return proto.TransactionBody.encode(
      tx._makeTransactionBody(tx.nodeAccountIds[0]),
    ).finish();
  };

  it('signs the raw TransactionBody bytes and returns a protobuf SignatureMap', async () => {
    const bytes = bodyBytes();
    const {signatureMap} = await HederaChain().signRawTransaction({
      signTypeData: {signerAccountId: SIGNER, transactionBody: b64(bytes)},
      privateKey,
    });

    const {sigPair} = decodeSignatureMap(signatureMap);
    expect(sigPair).toHaveLength(1);
    expect(key.publicKey.verify(bytes, sigPair[0].ECDSASecp256k1)).toBe(true);
    expect(executeSpy).not.toHaveBeenCalled();
  });

  it('rejects the pre-HIP-820 transactionList shape with a pointer to transactionBody', async () => {
    await expect(
      HederaChain().signRawTransaction({
        signTypeData: {
          signerAccountId: SIGNER,
          transactionList: b64(unfrozenTransfer().toBytes()),
        },
        privateKey,
      }),
    ).rejects.toThrow(/transactionBody/);
  });

  it('rejects bytes that are not a TransactionBody', async () => {
    await expect(
      HederaChain().signRawTransaction({
        signTypeData: {signerAccountId: SIGNER, transactionBody: 'bm9wZQ=='},
        privateKey,
      }),
    ).rejects.toThrow();
  });
});

describe('hedera_signAndExecuteTransaction → sendRawTransaction', () => {
  it('freezes an unfrozen transaction, signs it, executes it and returns TransactionResponse.toJSON()', async () => {
    const response = sampleResponse();
    let executed;
    executeSpy.mockImplementation(async function () {
      executed = this;
      return response;
    });

    const result = await HederaChain().sendRawTransaction({
      signTypeData: {
        signerAccountId: SIGNER,
        transactionList: b64(unfrozenTransfer().toBytes()),
      },
      privateKey,
    });

    expect(result).toEqual(response.toJSON());
    expect(result.transactionHash).toBe('0102ff');
    expect(executed.isFrozen()).toBe(true);
    expect(executed.nodeAccountIds.length).toBeGreaterThan(0);
    expect(executed._signerPublicKeys.has(key.publicKey.toStringRaw())).toBe(
      true,
    );
    expect(HEDERA.getAccountInfo).toHaveBeenCalledWith(ACCOUNT_ID);
    const [client] = clients;
    expect(client.setOperator).toHaveBeenCalledTimes(1);
    expect(String(client.setOperator.mock.calls[0][0])).toBe(ACCOUNT_ID);
    expect(client.close).toHaveBeenCalled();
  });

  it('executes an already frozen transaction without re-freezing it', async () => {
    const response = sampleResponse();
    let executed;
    executeSpy.mockImplementation(async function () {
      executed = this;
      return response;
    });
    const frozen = frozenTransfer();
    const nodeIds = frozen.nodeAccountIds.map(String);

    await HederaChain().sendRawTransaction({
      signTypeData: {
        signerAccountId: SIGNER,
        transactionList: b64(frozen.toBytes()),
      },
      privateKey,
    });

    expect(executed.nodeAccountIds.map(String)).toEqual(nodeIds);
  });

  it('turns a precheck failure into a HIP-820 JSON-RPC error (code 9000, status code as data)', async () => {
    executeSpy.mockRejectedValue(precheckError());

    let error;
    try {
      await HederaChain().sendRawTransaction({
        signTypeData: {
          signerAccountId: SIGNER,
          transactionList: b64(unfrozenTransfer().toBytes()),
        },
        privateKey,
      });
    } catch (e) {
      error = e;
    }

    expect(error).toBeInstanceOf(PrecheckStatusError);
    expect(error.jsonRpcError).toEqual({
      code: 9000,
      message: expect.stringContaining('INSUFFICIENT_PAYER_BALANCE'),
      data: '10',
    });
  });

  it('leaves other failures without a jsonRpcError so the generic reply is used', async () => {
    executeSpy.mockRejectedValue(new Error('network down'));

    let error;
    try {
      await HederaChain().sendRawTransaction({
        signTypeData: {
          signerAccountId: SIGNER,
          transactionList: b64(unfrozenTransfer().toBytes()),
        },
        privateKey,
      });
    } catch (e) {
      error = e;
    }

    expect(error.message).toBe('network down');
    expect(error.jsonRpcError).toBeUndefined();
  });
});

describe('hedera_executeTransaction → executeTransaction', () => {
  it('submits the already signed bytes with a keyless client and returns toJSON()', async () => {
    const response = sampleResponse();
    let executed;
    executeSpy.mockImplementation(async function () {
      executed = this;
      return response;
    });
    const signed = await frozenTransfer().sign(key);
    clients.length = 0;

    const result = await HederaChain().executeTransaction({
      signTypeData: {transactionList: b64(signed.toBytes())},
      privateKey,
    });

    expect(result).toEqual(response.toJSON());
    expect(executed._signerPublicKeys.has(key.publicKey.toStringRaw())).toBe(
      true,
    );
    expect(clients).toHaveLength(1);
    expect(clients[0].setOperator).not.toHaveBeenCalled();
    expect(clients[0].close).toHaveBeenCalled();
  });

  it('maps precheck failures to code 9000', async () => {
    executeSpy.mockRejectedValue(precheckError());
    const signed = await frozenTransfer().sign(key);

    await expect(
      HederaChain().executeTransaction({
        signTypeData: {transactionList: b64(signed.toBytes())},
        privateKey,
      }),
    ).rejects.toMatchObject({jsonRpcError: {code: 9000, data: '10'}});
  });
});

describe('hedera_signAndExecuteQuery → signAndExecuteQuery', () => {
  const balanceQueryBytes = () =>
    b64(new AccountBalanceQuery().setAccountId(ACCOUNT_ID).toBytes());

  it('executes the query with the signer as operator and returns the base64 result bytes', async () => {
    const balance = new AccountBalance({
      hbars: new Hbar(5),
      tokens: null,
      tokenDecimals: null,
    });
    let executed;
    queryExecuteSpy.mockImplementation(async function () {
      executed = this;
      return balance;
    });

    const result = await HederaChain().signAndExecuteQuery({
      signTypeData: {signerAccountId: SIGNER, query: balanceQueryBytes()},
      privateKey,
    });

    expect(result).toEqual({response: b64(balance.toBytes())});
    expect(executed).toBeInstanceOf(AccountBalanceQuery);
    const [client] = clients;
    expect(String(client.setOperator.mock.calls[0][0])).toBe(ACCOUNT_ID);
    expect(client.close).toHaveBeenCalled();
  });

  it('joins array results (AccountRecordsQuery) with commas like the reference wallet', async () => {
    const a = new Uint8Array([1, 2]);
    const b = new Uint8Array([3]);
    queryExecuteSpy.mockResolvedValue([{toBytes: () => a}, {toBytes: () => b}]);

    const result = await HederaChain().signAndExecuteQuery({
      signTypeData: {signerAccountId: SIGNER, query: balanceQueryBytes()},
      privateKey,
    });

    expect(result).toEqual({response: `${b64(a)},${b64(b)}`});
  });

  it('maps precheck failures to code 9000', async () => {
    queryExecuteSpy.mockRejectedValue(precheckError());

    await expect(
      HederaChain().signAndExecuteQuery({
        signTypeData: {signerAccountId: SIGNER, query: balanceQueryBytes()},
        privateKey,
      }),
    ).rejects.toMatchObject({jsonRpcError: {code: 9000, data: '10'}});
  });
});

describe('hedera_getNodeAddresses → getNodeAddresses', () => {
  it('lists the consensus node account ids of the requested network', async () => {
    const result = await HederaChain().getNodeAddresses({network: 'testnet'});

    expect(Client.forName).toHaveBeenCalledWith('testnet');
    expect(result.nodes).toEqual(expect.arrayContaining(['0.0.3']));
    result.nodes.forEach(node => expect(node).toMatch(/^\d+\.\d+\.\d+$/));
    expect(clients[0].close).toHaveBeenCalled();
  });
});

describe('EVM executor for the eip155 namespace', () => {
  it('lazily builds an EVMChain for hedera with the same phrase and custom RPC', () => {
    const chain = HederaChain('hedera', 'seed words', 'https://rpc.example');
    expect(EVMChain).not.toHaveBeenCalled();

    const evm = chain.evm;

    expect(EVMChain).toHaveBeenCalledTimes(1);
    expect(EVMChain).toHaveBeenCalledWith(
      'hedera',
      'seed words',
      'https://rpc.example',
    );
    expect(evm).toEqual({
      chain_name: 'hedera',
      phrase: 'seed words',
      customRpcUrl: 'https://rpc.example',
    });
    expect(chain.evm).toBe(evm);
    expect(EVMChain).toHaveBeenCalledTimes(1);
  });
});
