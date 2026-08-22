/* global Buffer */
import {broadcastBitcoinTransaction} from 'dok-wallet-blockchain-networks/service/bitcoinDataSource';
import {
  electrumBroadcastTransaction,
  electrumGetTransaction,
} from 'dok-wallet-blockchain-networks/service/electrum';
import {BitcoinFork} from 'dok-wallet-blockchain-networks/service/bitcoinFork';

jest.mock('dok-wallet-blockchain-networks/config/config', () => ({
  isWeb: false,
  IS_SANDBOX: false,
  config: {},
}));

jest.mock('dok-wallet-blockchain-networks/service/dokApi', () => ({
  fetchBitcoinBalances: jest.fn(),
  fetchBitcoinUTXO: jest.fn(),
  fetchBitcoinTransactionDetails: jest.fn(),
}));

jest.mock('dok-wallet-blockchain-networks/service/bitcoinWebElectrum', () => ({
  callWebElectrum: jest.fn(),
}));

jest.mock('dok-wallet-blockchain-networks/service/bitcoinFork', () => ({
  BitcoinFork: {
    createTransaction: jest.fn(),
    getTransaction: jest.fn(),
    getTransactions: jest.fn(),
    getTransactionFees: jest.fn(),
  },
}));

jest.mock('dok-wallet-blockchain-networks/service/electrum', () => ({
  isElectrumAvailable: jest.fn(() => true),
  electrumBroadcastTransaction: jest.fn(),
  electrumGetTransaction: jest.fn(),
  electrumFetchBitcoinBalances: jest.fn(),
  electrumFetchBitcoinUTXO: jest.fn(),
  electrumFetchBitcoinTransactionDetails: jest.fn(),
  electrumFetchBitcoinTransactions: jest.fn(),
  electrumGetFeeRate: jest.fn(),
}));

const bitcoin = require('bitcoinjs-lib');

// A real signed-shape tx so broadcastBitcoinTransaction can derive its txid.
const buildTxHex = () => {
  const tx = new bitcoin.Transaction();
  tx.addInput(Buffer.alloc(32, 4), 0);
  tx.addOutput(
    Buffer.concat([
      Buffer.from([0x76, 0xa9, 0x14]),
      Buffer.alloc(20, 5),
      Buffer.from([0x88, 0xac]),
    ]),
    1234,
  );
  return tx.toHex();
};

const TX_HEX = buildTxHex();
const EXPECTED_TXID = bitcoin.Transaction.fromHex(TX_HEX).getId();

// Bitcoin Core's two wordings for the same reject reason.
const MISSING_INPUTS_MESSAGES = [
  'bad-txns-inputs-missingorspent',
  'Missing inputs',
];

beforeEach(() => {
  jest.clearAllMocks();
  electrumGetTransaction.mockResolvedValue(null);
  BitcoinFork.createTransaction.mockResolvedValue(null);
});

describe('broadcastBitcoinTransaction missing-inputs recovery', () => {
  it.each(MISSING_INPUTS_MESSAGES)(
    'returns the txid for "%s" once the tx is confirmed on-network',
    async message => {
      electrumBroadcastTransaction.mockRejectedValue(new Error(message));
      electrumGetTransaction.mockResolvedValue({hash: EXPECTED_TXID});

      await expect(broadcastBitcoinTransaction({txHex: TX_HEX})).resolves.toBe(
        EXPECTED_TXID,
      );
      // Recognised as already landed, so no pointless re-broadcast.
      expect(BitcoinFork.createTransaction).not.toHaveBeenCalled();
      expect(electrumGetTransaction).toHaveBeenCalledWith({
        transactionId: EXPECTED_TXID,
      });
    },
  );

  it('throws for a double spend, where the tx is NOT on the network', async () => {
    // The dangerous case: same reject message, but our tx never landed --
    // a conflicting tx spent the inputs. Reporting success here would tell
    // the user a payment went through that will never confirm.
    electrumBroadcastTransaction.mockRejectedValue(
      new Error('bad-txns-inputs-missingorspent'),
    );
    electrumGetTransaction.mockResolvedValue(null);

    await expect(broadcastBitcoinTransaction({txHex: TX_HEX})).rejects.toThrow(
      /bad-txns-inputs-missingorspent|Bitcoin broadcast failed/,
    );
    // Unconfirmable, so the existing API fallback still gets its attempt.
    expect(BitcoinFork.createTransaction).toHaveBeenCalled();
  });

  it('does not mask the broadcast error when the lookup itself throws', async () => {
    electrumBroadcastTransaction.mockRejectedValue(
      new Error('bad-txns-inputs-missingorspent'),
    );
    electrumGetTransaction.mockRejectedValue(new Error('electrum unreachable'));
    BitcoinFork.getTransaction.mockRejectedValue(new Error('api unreachable'));

    await expect(broadcastBitcoinTransaction({txHex: TX_HEX})).rejects.toThrow(
      /bad-txns-inputs-missingorspent|Bitcoin broadcast failed/,
    );
  });

  it('recovers on the API leg too when the tx is on-network', async () => {
    electrumBroadcastTransaction.mockRejectedValue(new Error('some other'));
    BitcoinFork.createTransaction.mockRejectedValue(
      new Error('Missing inputs'),
    );
    electrumGetTransaction.mockResolvedValue({hash: EXPECTED_TXID});

    await expect(broadcastBitcoinTransaction({txHex: TX_HEX})).resolves.toBe(
      EXPECTED_TXID,
    );
  });
});

describe('broadcastBitcoinTransaction existing behaviour', () => {
  it('treats an already-known rejection as success without any lookup', async () => {
    electrumBroadcastTransaction.mockRejectedValue(
      new Error('txn-already-known'),
    );

    await expect(broadcastBitcoinTransaction({txHex: TX_HEX})).resolves.toBe(
      EXPECTED_TXID,
    );
    // Unambiguous message, so it must short-circuit before the lookup.
    expect(electrumGetTransaction).not.toHaveBeenCalled();
  });

  it('returns the txid from a successful electrum broadcast', async () => {
    electrumBroadcastTransaction.mockResolvedValue(EXPECTED_TXID);

    await expect(broadcastBitcoinTransaction({txHex: TX_HEX})).resolves.toBe(
      EXPECTED_TXID,
    );
    expect(BitcoinFork.createTransaction).not.toHaveBeenCalled();
  });

  it('falls back to the API for an unrelated electrum failure', async () => {
    electrumBroadcastTransaction.mockRejectedValue(new Error('socket closed'));
    BitcoinFork.createTransaction.mockResolvedValue('api-txid');

    await expect(broadcastBitcoinTransaction({txHex: TX_HEX})).resolves.toBe(
      'api-txid',
    );
    expect(electrumGetTransaction).not.toHaveBeenCalled();
  });

  it('throws when both legs fail for an unrelated reason', async () => {
    electrumBroadcastTransaction.mockRejectedValue(new Error('socket closed'));
    BitcoinFork.createTransaction.mockResolvedValue(null);

    await expect(broadcastBitcoinTransaction({txHex: TX_HEX})).rejects.toThrow(
      'Bitcoin broadcast failed',
    );
  });
});
