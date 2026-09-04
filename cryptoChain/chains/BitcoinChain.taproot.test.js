import ECPairFactory from 'ecpair';
import ecc from '@bitcoinerlab/secp256k1';
import * as bitcoin from 'bitcoinjs-lib';
import {toXOnly} from 'bitcoinjs-lib/src/psbt/bip371';
import varuint from 'varuint-bitcoin';
import {BitcoinChain} from 'dok-wallet-blockchain-networks/cryptoChain/chains/BitcoinChain';

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

// eslint-disable-next-line no-undef
const walletKey = ECPair.fromPrivateKey(Buffer.alloc(32, 7), {network});
const walletWif = walletKey.toWIF();
const internalPubkey = toXOnly(walletKey.publicKey);
const p2tr = bitcoin.payments.p2tr({internalPubkey, network});
const UTXO_VALUE = 10000;

// BIP86 test vector mnemonic.
const MNEMONIC =
  'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';

const chain = BitcoinChain();
const call = (method, extra) =>
  chain[method]({
    privateKey: walletWif,
    chain_name: 'bitcoin_taproot',
    ...extra,
  });

// One P2TR witnessUtxo input owned by the wallet, one payment output.
const buildUnsignedPsbt = ({withInternalKey}) => {
  const psbt = new bitcoin.Psbt({network});
  psbt.addInput({
    hash: 'aa'.repeat(32),
    index: 0,
    witnessUtxo: {script: p2tr.output, value: UTXO_VALUE},
    ...(withInternalKey ? {tapInternalKey: internalPubkey} : {}),
  });
  psbt.addOutput({address: p2tr.address, value: 5000});
  return psbt.toBase64();
};

// BIP-340 tagged hash with the BIP-322 tag (not in bitcoinjs-lib's tag list).
const bip322MessageHash = message => {
  // eslint-disable-next-line no-undef
  const tagHash = bitcoin.crypto.sha256(Buffer.from('BIP0322-signed-message'));
  return bitcoin.crypto.sha256(
    // eslint-disable-next-line no-undef
    Buffer.concat([tagHash, tagHash, Buffer.from(message, 'utf8')]),
  );
};

const expectValidKeyPathSpend = tx => {
  expect(tx.ins[0].witness).toHaveLength(1);
  const signature = tx.ins[0].witness[0];
  expect(signature).toHaveLength(64); // SIGHASH_DEFAULT, no trailing byte
  const hash = tx.hashForWitnessV1(
    0,
    [p2tr.output],
    [UTXO_VALUE],
    bitcoin.Transaction.SIGHASH_DEFAULT,
  );
  expect(ecc.verifySchnorr(hash, p2tr.pubkey, signature)).toBe(true);
};

describe('BitcoinChain bitcoin_taproot', () => {
  beforeEach(() => {
    jest.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => {
    console.error.mockRestore();
  });

  it('getAccounts reports the P2TR address on the BIP-86 path', () => {
    const [account] = call('getAccounts');
    expect(account.address).toBe(p2tr.address);
    expect(account.address.startsWith('tb1p')).toBe(true);
    expect(account.path).toBe("m/86'/0'/0'/0/0");
  });

  it('createWalletByPrivateKey imports a WIF as a P2TR address', () => {
    const wallet = call('createWalletByPrivateKey');
    expect(wallet).toEqual({address: p2tr.address, privateKey: walletWif});
  });

  it('createCustomDerivedAddress derives a P2TR address for a custom path', async () => {
    const {account} = await call('createCustomDerivedAddress', {
      mnemonic: MNEMONIC,
      derivePath: "m/86'/1'/0'/0/0",
    });
    expect(account.derivePath).toBe("m/86'/1'/0'/0/0");
    expect(account.address.startsWith('tb1p')).toBe(true);
    // The WIF must belong to the address it is stored with.
    const key = ECPair.fromWIF(account.privateKey, network);
    expect(
      bitcoin.payments.p2tr({internalPubkey: toXOnly(key.publicKey), network})
        .address,
    ).toBe(account.address);
  });

  it('createCustomDerivedAddress still works for native segwit', async () => {
    const {account} = await chain.createCustomDerivedAddress({
      chain_name: 'bitcoin',
      mnemonic: MNEMONIC,
      derivePath: "m/84'/1'/0'/0/0",
    });
    expect(account.address.startsWith('tb1q')).toBe(true);
  });

  it('signPsbt key-path signs and finalizes a P2TR input', async () => {
    const result = await call('signPsbt', {
      signTypeData: {
        psbt: buildUnsignedPsbt({withInternalKey: true}),
        signInputs: [],
        broadcast: false,
      },
    });
    const signed = bitcoin.Psbt.fromBase64(result.psbt, {network});
    expectValidKeyPathSpend(signed.extractTransaction());
  });

  it('signPsbt fills in tapInternalKey for its own inputs when the dApp omits it', async () => {
    const result = await call('signPsbt', {
      signTypeData: {
        psbt: buildUnsignedPsbt({withInternalKey: false}),
        broadcast: false,
      },
    });
    const signed = bitcoin.Psbt.fromBase64(result.psbt, {network});
    expectValidKeyPathSpend(signed.extractTransaction());
  });

  it('signPsbt key-path spends verify for both even- and odd-y internal keys', async () => {
    const parities = new Set();
    for (let seed = 1; seed <= 6; seed++) {
      // eslint-disable-next-line no-undef
      const key = ECPair.fromPrivateKey(Buffer.alloc(32, seed), {network});
      parities.add(key.publicKey[0]); // 0x02 even y, 0x03 odd y
      const payment = bitcoin.payments.p2tr({
        internalPubkey: toXOnly(key.publicKey),
        network,
      });
      const psbt = new bitcoin.Psbt({network});
      psbt.addInput({
        hash: 'bb'.repeat(32),
        index: 0,
        witnessUtxo: {script: payment.output, value: UTXO_VALUE},
        tapInternalKey: toXOnly(key.publicKey),
      });
      psbt.addOutput({address: payment.address, value: 5000});
      const result = await chain.signPsbt({
        signTypeData: {psbt: psbt.toBase64(), broadcast: false},
        privateKey: key.toWIF(),
        chain_name: 'bitcoin_taproot',
      });
      const tx = bitcoin.Psbt.fromBase64(result.psbt, {
        network,
      }).extractTransaction();
      const hash = tx.hashForWitnessV1(
        0,
        [payment.output],
        [UTXO_VALUE],
        bitcoin.Transaction.SIGHASH_DEFAULT,
      );
      expect(
        ecc.verifySchnorr(hash, payment.pubkey, tx.ins[0].witness[0]),
      ).toBe(true);
    }
    expect(parities).toEqual(new Set([0x02, 0x03]));
  });

  it('signMessage returns a BIP-322 simple signature for the taproot address', () => {
    const message = 'Hello World';
    const {address, signature} = call('signMessage', {
      signTypeData: {message},
    });
    expect(address).toBe(p2tr.address);

    // Simple signature = serialized witness stack of to_sign's only input.
    // eslint-disable-next-line no-undef
    const witnessBytes = Buffer.from(signature, 'base64');
    const count = varuint.decode(witnessBytes, 0);
    expect(count).toBe(1);
    const lenOffset = varuint.decode.bytes;
    const sigLen = varuint.decode(witnessBytes, lenOffset);
    const schnorrSig = witnessBytes.subarray(
      lenOffset + varuint.decode.bytes,
      lenOffset + varuint.decode.bytes + sigLen,
    );
    expect(schnorrSig).toHaveLength(64);

    // Rebuild to_spend / to_sign per BIP-322 and verify the Schnorr signature
    // against to_sign's key-path sighash for the tweaked output key.
    const toSpend = new bitcoin.Transaction();
    toSpend.version = 0;
    toSpend.locktime = 0;
    toSpend.addInput(
      // eslint-disable-next-line no-undef
      Buffer.alloc(32, 0),
      0xffffffff,
      0,
      bitcoin.script.compile([
        bitcoin.opcodes.OP_0,
        bip322MessageHash(message),
      ]),
    );
    toSpend.addOutput(p2tr.output, 0);
    const toSign = new bitcoin.Transaction();
    toSign.version = 0;
    toSign.locktime = 0;
    toSign.addInput(toSpend.getHash(), 0, 0);
    toSign.addOutput(bitcoin.script.compile([bitcoin.opcodes.OP_RETURN]), 0);
    const hash = toSign.hashForWitnessV1(
      0,
      [p2tr.output],
      [0],
      bitcoin.Transaction.SIGHASH_DEFAULT,
    );
    expect(ecc.verifySchnorr(hash, p2tr.pubkey, schnorrSig)).toBe(true);
  });

  it('signMessage keeps BIP-137 ECDSA for non-taproot address types', () => {
    const {signature} = chain.signMessage({
      signTypeData: {message: 'Hello World'},
      privateKey: walletWif,
      chain_name: 'bitcoin',
    });
    expect(signature).toHaveLength(130); // 65 bytes hex
    expect(parseInt(signature.slice(0, 2), 16)).toBeGreaterThanOrEqual(39);
  });
});
