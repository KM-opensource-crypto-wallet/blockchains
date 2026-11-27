/**
 * StellarChain WalletConnect signing (stellar_signXDR → personalSign,
 * stellar_signAndSubmitXDR → sendRawTransaction): a transaction that changes
 * who can sign for the account is refused before it is signed.
 *
 * Runner: node-env jest config (image moduleNameMapper).
 */
import {Buffer} from 'buffer';
import {
  Account,
  Asset,
  Keypair,
  Networks,
  Operation,
  TransactionBuilder,
} from '@stellar/stellar-sdk';
import {StellarChain} from 'dok-wallet-blockchain-networks/cryptoChain/chains/StellarChain';

jest.mock('dok-wallet-blockchain-networks/config/config', () => ({
  config: {
    get STELLAR_NETWORK() {
      return require('@stellar/stellar-sdk').Networks.TESTNET;
    },
  },
}));
// ESM-only and unused by the WalletConnect signing paths.
jest.mock('stellar-hd-wallet', () => ({}));
jest.mock('dok-wallet-blockchain-networks/rpcUrls/rpcUrls', () => ({
  getRPCUrl: jest.fn(() => 'https://horizon.test'),
}));
jest.mock('dok-wallet-blockchain-networks/helper', () => ({
  getExplorerTxUrl: jest.fn(),
  isValidStringWithValue: jest.fn(),
}));

const wallet = Keypair.fromRawEd25519Seed(Buffer.alloc(32, 7));
const other = Keypair.fromRawEd25519Seed(Buffer.alloc(32, 8)).publicKey();
const xdrOf = operation =>
  new TransactionBuilder(new Account(wallet.publicKey(), '1'), {
    fee: '100',
    networkPassphrase: Networks.TESTNET,
  })
    .addOperation(operation)
    .setTimeout(0)
    .build()
    .toXDR();

describe('StellarChain WalletConnect signing', () => {
  beforeEach(() => {
    jest.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => {
    console.error.mockRestore();
  });

  const addSigner = () =>
    xdrOf(Operation.setOptions({signer: {ed25519PublicKey: other, weight: 1}}));

  it('personalSign refuses a transaction that adds a signer', () => {
    expect(() =>
      StellarChain().personalSign({
        signTypeData: addSigner(),
        privateKey: wallet.secret(),
      }),
    ).toThrow(/who can sign/);
  });

  it('sendRawTransaction refuses it before submitting', async () => {
    await expect(
      StellarChain().sendRawTransaction({
        signTypeData: addSigner(),
        privateKey: wallet.secret(),
      }),
    ).rejects.toThrow(/who can sign/);
  });

  it('personalSign still signs a payment', () => {
    const result = StellarChain().personalSign({
      signTypeData: xdrOf(
        Operation.payment({
          destination: other,
          asset: Asset.native(),
          amount: '1',
        }),
      ),
      privateKey: wallet.secret(),
    });
    const signed = TransactionBuilder.fromXDR(
      result.signedXDR,
      Networks.TESTNET,
    );
    expect(signed.signatures).toHaveLength(1);
  });
});
