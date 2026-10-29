/**
 * SolanaChain broadcast pipeline (send → signAndBroadcastMessage): the signed
 * bytes go to every RPC at once with a preflight check, a round every RPC
 * refused for "Blockhash not found" is re-signed once, the same bytes are
 * re-sent until they land or expire, and waitForConfirmation reports a
 * transaction whose blockhash died unseen as dropped instead of pending.
 * Also the fee inputs: the priority fee comes from QuickNode's
 * `recommended` estimate (fallback / cap), and the compute limit carries a
 * 10 % margin that the shown fee includes.
 *
 * Runner: node-env jest config (same as SolanaChain.signAllTransactions).
 */
import {Buffer} from 'buffer';
import {
  Connection,
  Keypair,
  PublicKey,
  SendTransactionError,
  VersionedTransaction,
} from '@solana/web3.js';
import bs58 from 'bs58';
import {
  getPriorityFee,
  PRIORITY_FEE_FALLBACK_MICRO_LAMPORTS,
  PRIORITY_FEE_MAX_MICRO_LAMPORTS,
  SolanaChain,
} from 'dok-wallet-blockchain-networks/cryptoChain/chains/SolanaChain';
import {customFetchWithTimeout} from 'dok-wallet-blockchain-networks/helper';

// web3.js assigns getBlockHeight per instance in the constructor; route it
// through the prototype so it can be stubbed like the other RPC methods.
jest.mock('@solana/web3.js', () => {
  const actual = jest.requireActual('@solana/web3.js');
  class StubbableConnection extends actual.Connection {
    constructor(...args) {
      super(...args);
      delete this.getBlockHeight;
    }
    getBlockHeight() {
      return Promise.reject(new Error('getBlockHeight is not stubbed'));
    }
  }
  return {...actual, Connection: StubbableConnection};
});
jest.mock('dok-wallet-blockchain-networks/config/config', () => ({
  IS_SANDBOX: false,
  config: {},
}));
jest.mock('dok-wallet-blockchain-networks/helper', () => ({
  convertToSmallAmount: jest.fn(() => '1000000'),
  customFetchWithTimeout: jest.fn(),
  differentInCurrentTime: jest.fn(),
  getExplorerTxUrl: jest.fn(),
  isSwapBlockingError: jest.fn(() => false),
  isValidStringWithValue: jest.fn(() => false),
  parseBalance: jest.fn(v => v),
  SOLANA_PREFLIGHT_REJECTED_PREFIX:
    'Solana transaction rejected before sending',
  SWAP_QUOTE_EXPIRED_ERROR: 'expired',
}));
jest.mock('dok-wallet-blockchain-networks/rpcUrls/rpcSession', () => ({
  withRpcSessionFetch: jest.fn(f => f),
}));
jest.mock('dok-wallet-blockchain-networks/rpcUrls/rpcUrls', () => ({
  getRPCUrl: jest.fn(() => 'http://premium'),
  getPremiumRPCUrl: jest.fn(() => 'http://premium'),
  getFreeRPCUrl: jest.fn(() => ['http://free-a', 'http://free-b']),
}));
jest.mock('dok-wallet-blockchain-networks/service/solflare', () => ({
  getSolanaContract: jest.fn(),
}));
jest.mock('dok-wallet-blockchain-networks/service/dokApi', () => ({
  getStakingByChain: jest.fn(),
}));
jest.mock('dok-wallet-blockchain-networks/service/stakeWiz', () => ({
  StakeWiz: {},
}));
jest.mock('nanoid', () => ({nanoid: () => 'test-id'}));

const RPCS = ['http://premium', 'http://free-a', 'http://free-b'];
const wallet = Keypair.fromSeed(Uint8Array.from({length: 32}, () => 7));
const privateKey = bs58.encode(wallet.secretKey);
const recipient = new PublicKey('11111111111111111111111111111112');
const LAST_VALID_BLOCK_HEIGHT = 500;

let blockhashSeed = 0;
const nextBlockhash = () => {
  blockhashSeed += 1;
  return bs58.encode(Uint8Array.from({length: 32}, () => blockhashSeed));
};

const rejection = transactionMessage =>
  new SendTransactionError({
    action: 'simulate',
    signature: '',
    transactionMessage,
  });

const sendSol = () =>
  SolanaChain().send({
    to: recipient.toBase58(),
    from: wallet.publicKey.toBase58(),
    amount: '0.001',
    privateKey,
    gasFee: 5000,
    estimateGas: 450,
  });

const decode = payload => VersionedTransaction.deserialize(payload);
const signatureOf = payload => bs58.encode(decode(payload).signatures[0]);

describe('SolanaChain broadcast pipeline', () => {
  let sendRawTransaction;
  let getSignatureStatuses;
  let getBlockHeight;
  let issuedBlockhashes;
  // [0] is prepareTransferMessage's; the rest were fetched when signing.
  const signingBlockhashes = () => issuedBlockhashes.slice(1);

  const sentEndpoints = () =>
    sendRawTransaction.mock.instances.map(connection => connection.rpcEndpoint);
  const sentPayloads = () =>
    sendRawTransaction.mock.calls.map(([payload]) => Buffer.from(payload));
  const sentOptions = () =>
    sendRawTransaction.mock.calls.map(([, options]) => options);

  beforeEach(() => {
    jest.useFakeTimers();
    jest.spyOn(console, 'error').mockImplementation(() => {});
    jest.spyOn(console, 'log').mockImplementation(() => {});
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    issuedBlockhashes = [];
    jest
      .spyOn(Connection.prototype, 'getLatestBlockhash')
      .mockImplementation(async commitment => {
        // Alpenglow: 'finalized' everywhere ('confirmed' is being removed).
        expect(commitment).toBe('finalized');
        const blockhash = nextBlockhash();
        issuedBlockhashes.push(blockhash);
        return {blockhash, lastValidBlockHeight: LAST_VALID_BLOCK_HEIGHT};
      });
    sendRawTransaction = jest.spyOn(Connection.prototype, 'sendRawTransaction');
    // Landed by default, so a background re-send loop stops at its first check.
    getSignatureStatuses = jest
      .spyOn(Connection.prototype, 'getSignatureStatuses')
      .mockResolvedValue({
        value: [{confirmationStatus: 'confirmed', err: null}],
      });
    getBlockHeight = jest
      .spyOn(Connection.prototype, 'getBlockHeight')
      .mockResolvedValue(100);
    jest
      .spyOn(Connection.prototype, 'getParsedTransaction')
      .mockResolvedValue(null);
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it('sends byte-identical bytes to every RPC at once with preflight, and one acceptance is enough', async () => {
    sendRawTransaction.mockImplementation(function () {
      if (this.rpcEndpoint === 'http://free-a') {
        return Promise.resolve('accepted');
      }
      return this.rpcEndpoint === 'http://premium'
        ? Promise.reject(new Error('Network request failed'))
        : Promise.reject(
            rejection('Transaction simulation failed: Blockhash not found'),
          );
    });

    const signature = await sendSol();

    expect(sentEndpoints()).toEqual(RPCS);
    const [first, ...rest] = sentPayloads();
    rest.forEach(payload => expect(payload.equals(first)).toBe(true));
    sentOptions().forEach(options =>
      expect(options).toEqual({
        skipPreflight: false,
        preflightCommitment: 'finalized',
      }),
    );
    // Signed with the blockhash fetched when signing, not prepare's.
    expect(signingBlockhashes()).toHaveLength(1);
    expect(decode(first).message.recentBlockhash).toBe(signingBlockhashes()[0]);
    expect(signature).toBe(signatureOf(first));
  });

  it('treats "already been processed" as success', async () => {
    sendRawTransaction.mockImplementation(function () {
      return this.rpcEndpoint === 'http://free-b'
        ? Promise.reject(
            rejection(
              'Transaction simulation failed: This transaction has already been processed',
            ),
          )
        : Promise.reject(new Error('Network request failed'));
    });

    const signature = await sendSol();

    expect(signature).toBe(signatureOf(sentPayloads()[0]));
  });

  it('throws the network reason when every RPC refuses in preflight, and never re-sends', async () => {
    sendRawTransaction.mockRejectedValue(
      rejection(
        'Transaction simulation failed: Attempt to debit an account but found no record of a prior credit.',
      ),
    );

    await expect(sendSol()).rejects.toThrow(
      'Solana transaction rejected before sending: Transaction simulation failed: Attempt to debit an account but found no record of a prior credit.',
    );
    await jest.advanceTimersByTimeAsync(10000);

    expect(signingBlockhashes()).toHaveLength(1);
    expect(sendRawTransaction).toHaveBeenCalledTimes(RPCS.length);
  });

  it('re-signs exactly once with a fresh blockhash when every RPC refused the blockhash', async () => {
    let round = 0;
    sendRawTransaction.mockImplementation(() => {
      round += 1;
      return round <= RPCS.length
        ? Promise.reject(
            rejection('Transaction simulation failed: Blockhash not found'),
          )
        : Promise.resolve('accepted');
    });

    const signature = await sendSol();

    const payloads = sentPayloads();
    expect(payloads).toHaveLength(RPCS.length * 2);
    expect(signingBlockhashes()).toHaveLength(2);
    expect(decode(payloads[0]).message.recentBlockhash).toBe(
      signingBlockhashes()[0],
    );
    expect(decode(payloads[RPCS.length]).message.recentBlockhash).toBe(
      signingBlockhashes()[1],
    );
    expect(signature).toBe(signatureOf(payloads[RPCS.length]));
  });

  it('sends the re-signed copy without the check when the RPCs refuse the fresh blockhash too', async () => {
    sendRawTransaction.mockImplementation((payload, options) =>
      options.skipPreflight
        ? Promise.resolve('accepted')
        : Promise.reject(
            rejection('Transaction simulation failed: Blockhash not found'),
          ),
    );

    const signature = await sendSol();

    // Still exactly one re-sign: the third round re-uses the second bytes.
    expect(signingBlockhashes()).toHaveLength(2);
    // Skipping preflight keeps the blockhash's commitment.
    expect(sentOptions()[RPCS.length * 2].preflightCommitment).toBe(
      'finalized',
    );
    const payloads = sentPayloads();
    expect(payloads).toHaveLength(RPCS.length * 3);
    expect(payloads[RPCS.length * 2].equals(payloads[RPCS.length])).toBe(true);
    expect(sentOptions()[RPCS.length * 2].skipPreflight).toBe(true);
    expect(signature).toBe(signatureOf(payloads[RPCS.length]));
  });

  it('does not re-sign after a transport failure; it re-sends the same bytes until the signature shows up', async () => {
    let round = 0;
    sendRawTransaction.mockImplementation(() => {
      round += 1;
      return round <= RPCS.length
        ? Promise.reject(new Error('Network request failed'))
        : Promise.resolve('accepted');
    });
    getSignatureStatuses.mockResolvedValue({value: [null]});

    const signature = await sendSol();
    expect(signingBlockhashes()).toHaveLength(1);

    // One re-send round per second.
    await jest.advanceTimersByTimeAsync(1000);
    expect(sendRawTransaction).toHaveBeenCalledTimes(RPCS.length * 2);
    sentOptions()
      .slice(RPCS.length)
      .forEach(options => expect(options.skipPreflight).toBe(true));
    const [first, ...rest] = sentPayloads();
    rest.forEach(payload => expect(payload.equals(first)).toBe(true));
    expect(signature).toBe(signatureOf(first));

    getSignatureStatuses.mockResolvedValue({
      value: [{confirmationStatus: 'confirmed', err: null}],
    });
    await jest.advanceTimersByTimeAsync(10000);
    expect(sendRawTransaction).toHaveBeenCalledTimes(RPCS.length * 2);
  });

  it('stops re-sending once the blockhash has expired', async () => {
    sendRawTransaction.mockResolvedValue('accepted');
    getSignatureStatuses.mockResolvedValue({value: [null]});
    getBlockHeight.mockResolvedValue(LAST_VALID_BLOCK_HEIGHT + 1);

    await sendSol();
    await jest.advanceTimersByTimeAsync(10000);

    expect(sendRawTransaction).toHaveBeenCalledTimes(RPCS.length);
  });

  it('waitForConfirmation reports a broadcast that expired unseen as dropped', async () => {
    sendRawTransaction.mockResolvedValue('accepted');
    getSignatureStatuses.mockResolvedValue({value: [null]});
    getBlockHeight.mockResolvedValue(LAST_VALID_BLOCK_HEIGHT + 100);

    const signature = await sendSol();
    const verdict = SolanaChain().waitForConfirmation({
      transaction: signature,
      interval: 10,
      retries: 2,
    });
    await jest.advanceTimersByTimeAsync(10000);

    await expect(verdict).resolves.toEqual({status: 'dropped'});
  });

  it('waitForConfirmation gives the dropped verdict as soon as the blockhash has expired', async () => {
    sendRawTransaction.mockResolvedValue('accepted');
    getSignatureStatuses.mockResolvedValue({value: [null]});
    getBlockHeight.mockResolvedValue(LAST_VALID_BLOCK_HEIGHT + 100);

    const signature = await sendSol();
    // sendFunds' poll: 15 × 5 s. The verdict must not wait for all of it.
    const verdict = SolanaChain().waitForConfirmation({
      transaction: signature,
      interval: 5000,
      retries: 15,
    });
    await jest.advanceTimersByTimeAsync(15000);

    await expect(verdict).resolves.toEqual({status: 'dropped'});
  });

  it('waitForConfirmation stays pending for a signature it did not broadcast', async () => {
    getSignatureStatuses.mockResolvedValue({value: [null]});

    const verdict = SolanaChain().waitForConfirmation({
      transaction: 'unknown-signature',
      interval: 10,
      retries: 2,
    });
    await jest.advanceTimersByTimeAsync(100);

    await expect(verdict).resolves.toBe('pending');
  });
});

describe('Solana fee inputs', () => {
  const quickNodeAnswers = body =>
    customFetchWithTimeout.mockResolvedValue({
      status: 200,
      json: async () => body,
    });
  const estimateSol = () =>
    SolanaChain().getEstimateFee({
      fromAddress: wallet.publicKey.toBase58(),
      toAddress: recipient.toBase58(),
      amount: '0.001',
    });

  beforeEach(() => {
    jest.spyOn(console, 'error').mockImplementation(() => {});
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    jest.spyOn(Connection.prototype, 'getLatestBlockhash').mockResolvedValue({
      blockhash: nextBlockhash(),
      lastValidBlockHeight: LAST_VALID_BLOCK_HEIGHT,
    });
    jest
      .spyOn(Connection.prototype, 'getFeeForMessage')
      .mockResolvedValue({value: 5000});
  });

  afterEach(() => {
    customFetchWithTimeout.mockReset();
    jest.restoreAllMocks();
  });

  it("uses QuickNode's recommended fee from the premium RPC, plus 10 %", async () => {
    quickNodeAnswers({
      result: {recommended: 200000, per_compute_unit: {medium: 90000}},
    });

    await expect(getPriorityFee()).resolves.toBe(220000);

    const [url, options] = customFetchWithTimeout.mock.calls[0];
    expect(url).toBe('http://premium');
    expect(JSON.parse(options.body)).toEqual({
      jsonrpc: '2.0',
      id: 1,
      method: 'qn_estimatePriorityFees',
      params: {last_n_blocks: 100, api_version: 2},
    });
  });

  it('falls back, and logs it, when the endpoint does not serve the estimate', async () => {
    quickNodeAnswers({error: {code: -32601, message: 'Method not found'}});

    await expect(getPriorityFee()).resolves.toBe(
      PRIORITY_FEE_FALLBACK_MICRO_LAMPORTS,
    );
    expect(console.warn).toHaveBeenCalledWith(
      'solana.priority_fee_fallback',
      'Method not found',
    );
  });

  it('trims only the buffer when recommended is just under the cap', async () => {
    quickNodeAnswers({result: {recommended: 1_900_000}});

    await expect(getPriorityFee()).resolves.toBe(
      PRIORITY_FEE_MAX_MICRO_LAMPORTS,
    );
  });

  it('refuses, rather than paying below it, when recommended is above the cap', async () => {
    quickNodeAnswers({result: {recommended: 2_500_000}});

    const refusal = getPriorityFee();
    await expect(refusal).rejects.toThrow(/^The Solana network is congested/);
    await expect(refusal).rejects.toThrow(
      "a priority fee of 2500000 micro-lamports per compute unit, above this wallet's limit of 2000000",
    );
    expect(console.warn).toHaveBeenCalledWith(
      'solana.priority_fee_above_cap',
      2_500_000,
    );
  });

  it('fails the fee estimate with that message, so Transfer shows it', async () => {
    quickNodeAnswers({result: {recommended: 2_500_000}});
    jest
      .spyOn(Connection.prototype, 'simulateTransaction')
      .mockResolvedValue({value: {unitsConsumed: 450, err: null}});

    await expect(estimateSol()).rejects.toThrow(
      /^The Solana network is congested/,
    );
  });

  it('gives the compute limit a 10 % margin and prices it in the shown fee', async () => {
    quickNodeAnswers({result: {recommended: 200000}});
    jest
      .spyOn(Connection.prototype, 'simulateTransaction')
      .mockResolvedValue({value: {unitsConsumed: 450, err: null}});

    await expect(estimateSol()).resolves.toEqual({
      estimateGas: 495,
      gasFee: 220000,
      fee: 5000 + Math.ceil((220000 * 495) / 1000000),
    });
  });

  it('sets no priority fee when the simulation reports no compute units', async () => {
    quickNodeAnswers({result: {recommended: 200000}});
    jest
      .spyOn(Connection.prototype, 'simulateTransaction')
      .mockResolvedValue({value: {unitsConsumed: 0, err: 'AccountNotFound'}});

    await expect(estimateSol()).resolves.toEqual({
      estimateGas: 0,
      gasFee: 0,
      fee: 5000,
    });
  });
});
