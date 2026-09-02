import ECPairFactory from 'ecpair';
import ecc from '@bitcoinerlab/secp256k1';
import * as bitcoin from 'bitcoinjs-lib';
import {BitcoinChain} from 'dok-wallet-blockchain-networks/cryptoChain/chains/BitcoinChain';
import {broadcastBitcoinTransaction} from 'dok-wallet-blockchain-networks/service/bitcoinDataSource';

jest.mock('dok-wallet-blockchain-networks/config/config', () => ({
  IS_SANDBOX: true,
  config: {
    get BITCOIN_NETWORK_STRING() {
      return require('bitcoinjs-lib').networks.testnet;
    },
  },
}));

jest.mock('dok-wallet-blockchain-networks/helper', () => ({
  convertToSmallAmount: jest.fn(),
  getExplorerTxUrl: jest.fn(),
  mergeUniqueAccounts: jest.fn((a, b) => [...(a || []), ...(b || [])]),
  parseBalance: jest.fn(value => value),
  validateNumber: jest.fn(),
}));

jest.mock('dok-wallet-blockchain-networks/service/dokApi', () => ({
  getBitcoinAddresses: jest.fn(),
}));

jest.mock('dok-wallet-blockchain-networks/service/bitcoinDataSource', () => ({
  isAddressUsageScanAvailable: jest.fn(() => true),
  fetchBitcoinAddressUsage: jest.fn(),
  fetchBitcoinBalances: jest.fn(),
  fetchBitcoinTransactionDetails: jest.fn(),
  fetchBitcoinUTXO: jest.fn(),
  fetchBitcoinTransactions: jest.fn(),
  fetchBitcoinTransaction: jest.fn(),
  broadcastBitcoinTransaction: jest.fn(),
  fetchBitcoinFeeRate: jest.fn(),
}));

const network = bitcoin.networks.testnet;
const ECPair = ECPairFactory(ecc);
bitcoin.initEccLib(ecc);

// Deterministic keys so failures are reproducible.
// eslint-disable-next-line no-undef
const walletKey = ECPair.fromPrivateKey(Buffer.alloc(32, 1), {network});
// eslint-disable-next-line no-undef
const strangerKey = ECPair.fromPrivateKey(Buffer.alloc(32, 2), {network});
const walletWif = walletKey.toWIF();

const p2wpkhOf = key =>
  bitcoin.payments.p2wpkh({pubkey: key.publicKey, network});

// Mirrors what AppKit Lab's BitcoinUtil.createSignPSBTParams builds: one
// witnessUtxo input owned by `ownerKey`, one payment output, no signatures.
const buildUnsignedPsbt = ownerKey => {
  const owner = p2wpkhOf(ownerKey);
  const psbt = new bitcoin.Psbt({network});
  psbt.addInput({
    hash: 'aa'.repeat(32),
    index: 0,
    witnessUtxo: {script: owner.output, value: 10000},
  });
  psbt.addOutput({address: p2wpkhOf(walletKey).address, value: 5000});
  return psbt.toBase64();
};

const decode = base64 => bitcoin.Psbt.fromBase64(base64, {network});

const signPsbt = data =>
  BitcoinChain().signPsbt({
    signTypeData: data,
    privateKey: walletWif,
    chain_name: 'bitcoin',
  });

describe('BitcoinChain.signPsbt (bip122 WalletConnect)', () => {
  beforeEach(() => {
    jest.spyOn(console, 'error').mockImplementation(() => {});
    broadcastBitcoinTransaction.mockReset();
  });

  afterEach(() => {
    console.error.mockRestore();
  });

  it('signs and finalizes every wallet-owned input when signInputs is empty', async () => {
    const result = await signPsbt({
      psbt: buildUnsignedPsbt(walletKey),
      signInputs: [],
      broadcast: false,
    });

    const signed = decode(result.psbt);
    expect(signed.data.inputs[0].finalScriptWitness).toBeDefined();
    expect(result.txid).toBeUndefined();
  });

  it('treats a missing signInputs the same as an empty one', async () => {
    const result = await signPsbt({
      psbt: buildUnsignedPsbt(walletKey),
      broadcast: false,
    });

    expect(decode(result.psbt).data.inputs[0].finalScriptWitness).toBeDefined();
  });

  it('broadcasts the finalized transaction when broadcast is true and signInputs is empty', async () => {
    broadcastBitcoinTransaction.mockResolvedValue('deadbeef');

    const result = await signPsbt({
      psbt: buildUnsignedPsbt(walletKey),
      signInputs: [],
      broadcast: true,
    });

    expect(result.txid).toBe('deadbeef');
    expect(broadcastBitcoinTransaction).toHaveBeenCalledTimes(1);
    const {txHex} = broadcastBitcoinTransaction.mock.calls[0][0];
    const tx = bitcoin.Transaction.fromHex(txHex);
    expect(tx.ins).toHaveLength(1);
    expect(tx.ins[0].witness.length).toBeGreaterThan(0);
  });

  it('still honours an explicit signInputs list', async () => {
    const result = await signPsbt({
      psbt: buildUnsignedPsbt(walletKey),
      signInputs: [{index: 0, address: p2wpkhOf(walletKey).address}],
      broadcast: false,
    });

    expect(decode(result.psbt).data.inputs[0].finalScriptWitness).toBeDefined();
  });

  it('refuses when no input belongs to this wallet', async () => {
    await expect(
      signPsbt({
        psbt: buildUnsignedPsbt(strangerKey),
        signInputs: [],
        broadcast: false,
      }),
    ).rejects.toThrow('No PSBT inputs belong to this wallet');
    expect(broadcastBitcoinTransaction).not.toHaveBeenCalled();
  });
});
