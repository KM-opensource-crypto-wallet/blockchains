/**
 * bip122 signPsbt review: the outputs the PSBT pays, which inputs this wallet
 * signs, and a refusal when an input's signature would not cover the outputs.
 *
 *   npx jest dok-wallet-blockchain-networks/helper/psbtReview.test.js
 */
import ECPairFactory from 'ecpair';
import ecc from '@bitcoinerlab/secp256k1';
import * as bitcoin from 'bitcoinjs-lib';
import {Buffer} from 'buffer';
import {
  getUnsafePsbtInput,
  reviewPsbt,
} from 'dok-wallet-blockchain-networks/helper/psbtReview';

const network = bitcoin.networks.testnet;
const TESTNET = 'bip122:000000000933ea01ad0ee984209779ba';
const ECPair = ECPairFactory(ecc);
const walletKey = ECPair.fromPrivateKey(Buffer.alloc(32, 1), {network});
const otherKey = ECPair.fromPrivateKey(Buffer.alloc(32, 2), {network});
const p2wpkh = key => bitcoin.payments.p2wpkh({pubkey: key.publicKey, network});
const walletAddress = p2wpkh(walletKey).address;

const buildPsbt = ({sighashType, outputs}) => {
  const psbt = new bitcoin.Psbt({network});
  psbt.addInput({
    hash: 'aa'.repeat(32),
    index: 0,
    witnessUtxo: {script: p2wpkh(walletKey).output, value: 200000},
    ...(sighashType !== undefined ? {sighashType} : {}),
  });
  outputs.forEach(output => psbt.addOutput(output));
  return psbt;
};

describe('reviewPsbt', () => {
  it('lists every output with its amount and marks this wallet’s own', () => {
    const psbt = buildPsbt({
      outputs: [
        {address: p2wpkh(otherKey).address, value: 150000},
        {address: walletAddress, value: 40000},
      ],
    });
    const review = reviewPsbt(
      {psbt: psbt.toBase64(), signInputs: [{index: 0}]},
      {chainId: TESTNET, walletAddress},
    );
    expect(review.level).toBe('none');
    expect(review.blocked).toBe(false);
    expect(review.rows).toEqual([
      {label: 'Output 1', value: `${p2wpkh(otherKey).address}: 0.0015 BTC`},
      {
        label: 'Output 2',
        value: `${walletAddress}: 0.0004 BTC (this wallet)`,
      },
      {label: 'Inputs you sign', value: '1 (#0)'},
    ]);
  });

  it('blocks an input signed with SIGHASH_NONE', () => {
    const psbt = buildPsbt({
      sighashType: 0x82,
      outputs: [{address: p2wpkh(otherKey).address, value: 150000}],
    });
    const review = reviewPsbt(
      [{psbt: psbt.toBase64(), signInputs: [{index: 0}]}],
      {chainId: TESTNET, walletAddress},
    );
    expect(review.level).toBe('danger');
    expect(review.blocked).toBe(true);
    expect(review.reasons.join(' ')).toMatch(/does not cover the outputs/);
  });

  it('flags a PSBT it cannot read as danger without blocking', () => {
    const review = reviewPsbt({psbt: 'not-a-psbt'}, {chainId: TESTNET});
    expect(review.level).toBe('danger');
    expect(review.blocked).toBe(false);
  });
});

describe('getUnsafePsbtInput', () => {
  const outputs = [{address: p2wpkh(otherKey).address, value: 1000}];
  // undefined = no sighashType field (ALL, or DEFAULT for taproot).
  it.each([undefined, 0x01, 0x81, 0x03, 0x83])('accepts sighash %s', type => {
    expect(
      getUnsafePsbtInput(buildPsbt({sighashType: type, outputs}), [0]),
    ).toBeNull();
  });

  it.each([0x02, 0x82, 0x04, 0x41])('refuses sighash %s', type => {
    expect(
      getUnsafePsbtInput(buildPsbt({sighashType: type, outputs}), [0]),
    ).toMatchObject({index: 0});
  });

  it('refuses SIGHASH_SINGLE on an input with no matching output', () => {
    expect(
      getUnsafePsbtInput(buildPsbt({sighashType: 0x83, outputs: []}), [0]),
    ).toMatchObject({index: 0});
  });
});
