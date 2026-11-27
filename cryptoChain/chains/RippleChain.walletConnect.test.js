/**
 * RippleChain WalletConnect signing: a transaction that gives another key the
 * right to sign for the account is refused before anything is signed or sent.
 *
 *   npx jest dok-wallet-blockchain-networks/cryptoChain/chains/RippleChain.walletConnect.test.js
 */
import {RippleChain} from 'dok-wallet-blockchain-networks/cryptoChain/chains/RippleChain';

const mockClient = {
  connect: jest.fn(async () => {}),
  isConnected: jest.fn(() => true),
  autofill: jest.fn(async tx => ({...tx, Sequence: 1, Fee: '12'})),
  submitAndWait: jest.fn(async () => ({result: {hash: 'H'}})),
  on: jest.fn(),
};
jest.mock('xrpl', () => ({Client: jest.fn(() => mockClient)}));
jest.mock('dok-wallet-blockchain-networks/rpcUrls/rpcUrls', () => ({
  getRPCUrl: jest.fn(() => 'wss://xrpl.test'),
}));
jest.mock('dok-wallet-blockchain-networks/helper', () => ({
  convertToSmallAmount: jest.fn(),
  getExplorerTxUrl: jest.fn(),
  validateNumber: jest.fn(),
}));

// Any valid secp256k1 key works: autofill is mocked, nothing is broadcast.
const privateKey = '00' + '11'.repeat(32);
const OTHER = 'rUn84CUYbNjRoTQ6mSW7BVJPSVJNLb1QLo';
const payload = tx => ({signTypeData: {transaction: {tx_json: tx}}});

describe('RippleChain WalletConnect signing', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => {
    console.error.mockRestore();
  });

  it.each(['signRawTransaction', 'sendRawTransaction'])(
    '%s refuses SetRegularKey without signing or sending',
    async method => {
      await expect(
        RippleChain()[method]({
          payload: payload({
            TransactionType: 'SetRegularKey',
            RegularKey: OTHER,
          }),
          privateKey,
        }),
      ).rejects.toThrow(/sign for your XRP account/);
      expect(mockClient.autofill).not.toHaveBeenCalled();
      expect(mockClient.submitAndWait).not.toHaveBeenCalled();
    },
  );

  it('still signs a payment', async () => {
    const signed = await RippleChain().signRawTransaction({
      payload: payload({
        TransactionType: 'Payment',
        Destination: OTHER,
        Amount: '1',
      }),
      privateKey,
    });
    expect(signed.TxnSignature).toEqual(expect.any(String));
  });
});
