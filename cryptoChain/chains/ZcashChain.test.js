import ECPairFactory from 'ecpair';
import ecc from '@bitcoinerlab/secp256k1';
import * as bitcoin from 'bitcoinjs-lib';
import bs58 from 'bs58';
import blakejs from 'blakejs';

const ECPair = ECPairFactory(ecc);

const ZCASH_MAINNET_P2PKH_PREFIX = [0x1c, 0xb8];
const ZCASH_TESTNET_P2PKH_PREFIX = [0x1d, 0x25];

const loadZcashChain = isSandbox => {
  jest.resetModules();
  jest.doMock('dok-wallet-blockchain-networks/config/config', () => ({
    IS_SANDBOX: isSandbox,
    config: {
      ZCASH_CONSENSUS_BRANCH_ID: 'deadbeef',
      ZCASH_TESTNET_CONSENSUS_BRANCH_ID: 'deadbeef',
    },
  }));
  jest.doMock('dok-wallet-blockchain-networks/helper', () => ({
    getExplorerTxUrl: jest.fn(),
    parseBalance: jest.fn(value => value),
  }));
  jest.doMock('dok-wallet-blockchain-networks/service/bitcoinFork', () => ({
    BitcoinFork: {
      getBalance: jest.fn(),
      getTransactions: jest.fn(),
      getTransaction: jest.fn(),
      getUTXO: jest.fn(),
    },
  }));
  jest.doMock('dok-wallet-blockchain-networks/service/cipherscan', () => ({
    Cipherscan: {createTransaction: jest.fn()},
  }));
  const {
    ZcashChain,
  } = require('dok-wallet-blockchain-networks/cryptoChain/chains/ZcashChain');
  return ZcashChain();
};

// Independently recomputes the ZIP-243 sighash for a signed input and checks
// the ECDSA signature against it with secp256k1 -- the same technique used
// to discover that WalletCore's native Zcash signer was producing
// cryptographically invalid signatures (see ZcashChain.js's block comment
// above buildAndSignZcashTransaction). This implementation was itself
// validated against WalletCore's own published test vector before being
// trusted, so a regression here is a real, high-confidence signal, not a
// false positive from a second buggy reimplementation.
const personalization = (asciiPrefix, branchIdBuf) => {
  // eslint-disable-next-line no-undef
  const p = Buffer.alloc(16);
  // eslint-disable-next-line no-undef
  Buffer.from(asciiPrefix, 'ascii').copy(p, 0);
  if (branchIdBuf) branchIdBuf.copy(p, asciiPrefix.length);
  return p;
};
const blake2b256 = (data, personalBuf) =>
  // eslint-disable-next-line no-undef
  Buffer.from(blakejs.blake2b(data, null, 32, null, personalBuf));
const writeUInt32LE = n => {
  // eslint-disable-next-line no-undef
  const b = Buffer.alloc(4);
  b.writeUInt32LE(n, 0);
  return b;
};
const writeInt64LE = n => {
  // eslint-disable-next-line no-undef
  const b = Buffer.alloc(8);
  b.writeBigInt64LE(BigInt(n), 0);
  return b;
};
// eslint-disable-next-line no-undef
const varSlice = buf => Buffer.concat([Buffer.from([buf.length]), buf]);
const p2pkhScriptFor = hash160 =>
  // eslint-disable-next-line no-undef
  Buffer.concat([
    // eslint-disable-next-line no-undef
    Buffer.from([0x76, 0xa9, 0x14]),
    hash160,
    // eslint-disable-next-line no-undef
    Buffer.from([0x88, 0xac]),
  ]);

// Parses a single-input v4 raw tx hex and asserts its scriptSig's signature
// is a valid ZIP-243 signature for the given UTXO input value and branch id.
const assertValidZip243Signature = (rawTxHex, {inputValue, branchIdHex}) => {
  // eslint-disable-next-line no-undef
  const b = Buffer.from(rawTxHex, 'hex');
  let i = 0;
  const header = b.readUInt32LE(i);
  i += 4;
  const vgid = b.readUInt32LE(i);
  i += 4;
  const nIn = b[i];
  i += 1;
  expect(nIn).toBe(1); // this helper only supports the single-input case
  const inputTxidInternal = b.subarray(i, i + 32);
  i += 32;
  const vout = b.readUInt32LE(i);
  i += 4;
  const scriptLen = b[i];
  i += 1;
  const script = b.subarray(i, i + scriptLen);
  i += scriptLen;
  const seq = b.readUInt32LE(i);
  i += 4;
  const nOut = b[i];
  i += 1;
  const outputs = [];
  for (let k = 0; k < nOut; k++) {
    const value = b.readBigInt64LE(i);
    i += 8;
    const outScriptLen = b[i];
    i += 1;
    const outScript = b.subarray(i, i + outScriptLen);
    i += outScriptLen;
    outputs.push({value, outScript});
  }
  const lockTime = b.readUInt32LE(i);
  i += 4;
  const expiryHeight = b.readUInt32LE(i);
  i += 4;

  const sigPushLen = script[0];
  const sigAndSighash = script.subarray(1, 1 + sigPushLen);
  const derSig = sigAndSighash.subarray(0, sigAndSighash.length - 1);
  const sighashByte = sigAndSighash[sigAndSighash.length - 1];
  const pubPushOffset = 1 + sigPushLen;
  const pubPushLen = script[pubPushOffset];
  const pubkey = script.subarray(
    pubPushOffset + 1,
    pubPushOffset + 1 + pubPushLen,
  );

  const pubkeyHash = bitcoin.crypto.hash160(pubkey);
  const scriptCode = p2pkhScriptFor(pubkeyHash);
  // eslint-disable-next-line no-undef
  const outpoints = Buffer.concat([inputTxidInternal, writeUInt32LE(vout)]);
  const sequences = writeUInt32LE(seq);
  // eslint-disable-next-line no-undef
  const serializedOutputs = Buffer.concat(
    outputs.map(o =>
      // eslint-disable-next-line no-undef
      Buffer.concat([writeInt64LE(o.value), varSlice(o.outScript)]),
    ),
  );
  const hashPrevouts = blake2b256(
    outpoints,
    personalization('ZcashPrevoutHash'),
  );
  const hashSequence = blake2b256(
    sequences,
    personalization('ZcashSequencHash'),
  );
  const hashOutputs = blake2b256(
    serializedOutputs,
    personalization('ZcashOutputsHash'),
  );
  // eslint-disable-next-line no-undef
  const zero32 = Buffer.alloc(32);
  // eslint-disable-next-line no-undef
  const branchIdBuf = Buffer.from(branchIdHex, 'hex');

  // eslint-disable-next-line no-undef
  const preimage = Buffer.concat([
    writeUInt32LE(header),
    writeUInt32LE(vgid),
    hashPrevouts,
    hashSequence,
    hashOutputs,
    zero32,
    zero32,
    zero32,
    writeUInt32LE(lockTime),
    writeUInt32LE(expiryHeight),
    writeInt64LE(0n),
    writeUInt32LE(1),
    inputTxidInternal,
    writeUInt32LE(vout),
    varSlice(scriptCode),
    writeInt64LE(inputValue),
    writeUInt32LE(seq),
  ]);
  const sighash = blake2b256(
    preimage,
    personalization('ZcashSigHash', branchIdBuf),
  );

  const {signature} = bitcoin.script.signature.decode(
    // eslint-disable-next-line no-undef
    Buffer.concat([derSig, Buffer.from([sighashByte])]),
  );
  expect(ecc.verify(sighash, pubkey, signature)).toBe(true);
};

// Decodes a base58check-encoded transparent address and asserts its 2-byte
// version prefix and hash160 payload match what's expected -- exercising the
// same decode path ZcashChain's own encodeZcashTransparentAddress builds,
// without depending on an external test vector.
const assertTransparentAddress = (address, expectedPrefix, publicKey) => {
  const decoded = bs58.decode(address);
  const payload = decoded.subarray(0, decoded.length - 4);
  const checksum = decoded.subarray(decoded.length - 4);
  const expectedChecksum = bitcoin.crypto.hash256(payload).subarray(0, 4);
  // eslint-disable-next-line no-undef
  expect(Buffer.from(checksum)).toEqual(Buffer.from(expectedChecksum));
  expect(Array.from(payload.subarray(0, 2))).toEqual(expectedPrefix);
  // eslint-disable-next-line no-undef
  expect(Buffer.from(payload.subarray(2))).toEqual(
    bitcoin.crypto.hash160(publicKey),
  );
};

afterEach(() => {
  jest.dontMock('dok-wallet-blockchain-networks/config/config');
  jest.dontMock('dok-wallet-blockchain-networks/helper');
  jest.dontMock('dok-wallet-blockchain-networks/service/bitcoinFork');
  jest.dontMock('dok-wallet-blockchain-networks/service/cipherscan');
});

describe('ZcashChain isValidPrivateKey', () => {
  it('returns true for a valid WIF', () => {
    const zcash = loadZcashChain(false);
    // eslint-disable-next-line no-undef
    const keyPair = ECPair.fromPrivateKey(Buffer.alloc(32, 7), {
      network: bitcoin.networks.bitcoin,
    });
    expect(zcash.isValidPrivateKey({privateKey: keyPair.toWIF()})).toBe(true);
  });

  it('returns false for garbage input', () => {
    const zcash = loadZcashChain(false);
    expect(zcash.isValidPrivateKey({privateKey: 'not-a-wif'})).toBe(false);
  });
});

describe('ZcashChain createWalletByPrivateKey', () => {
  it('derives a mainnet t1... address', () => {
    const zcash = loadZcashChain(false);
    // eslint-disable-next-line no-undef
    const keyPair = ECPair.fromPrivateKey(Buffer.alloc(32, 7), {
      network: bitcoin.networks.bitcoin,
    });
    const wif = keyPair.toWIF();
    const {address, privateKey} = zcash.createWalletByPrivateKey({
      privateKey: wif,
    });
    expect(address.startsWith('t1')).toBe(true);
    expect(privateKey).toBe(wif);
    assertTransparentAddress(
      address,
      ZCASH_MAINNET_P2PKH_PREFIX,
      keyPair.publicKey,
    );
  });

  it('derives a testnet tm... address', () => {
    const zcash = loadZcashChain(true);
    // eslint-disable-next-line no-undef
    const keyPair = ECPair.fromPrivateKey(Buffer.alloc(32, 7), {
      network: bitcoin.networks.testnet,
    });
    const wif = keyPair.toWIF();
    const {address, privateKey} = zcash.createWalletByPrivateKey({
      privateKey: wif,
    });
    expect(address.startsWith('tm')).toBe(true);
    expect(privateKey).toBe(wif);
    assertTransparentAddress(
      address,
      ZCASH_TESTNET_P2PKH_PREFIX,
      keyPair.publicKey,
    );
  });
});

describe('ZcashChain getEstimateFee', () => {
  it('computes the ZIP-317 minimum fee, folding a sub-dust remainder into it', async () => {
    const zcash = loadZcashChain(false);
    const {
      BitcoinFork,
    } = require('dok-wallet-blockchain-networks/service/bitcoinFork');

    BitcoinFork.getUTXO.mockResolvedValue([
      {hash: '11'.repeat(32), vout: 0, value: 500000},
    ]);
    // 1 input, would-be 2 outputs: fee = 5000 * max(2, 2) = 10000.
    // Change would be 500000 - 490000 - 10000 = 0, below dust, so it folds
    // into the fee instead: fee = total - amount = 10000.
    const result = await zcash.getEstimateFee({
      fromAddress: 't1from',
      amount: '0.0049', // 490000 zatoshi
    });
    expect(result.fee).toBe('10000');
  });

  it('computes the ZIP-317 fee when a real change output is left over', async () => {
    const zcash = loadZcashChain(false);
    const {
      BitcoinFork,
    } = require('dok-wallet-blockchain-networks/service/bitcoinFork');

    BitcoinFork.getUTXO.mockResolvedValue([
      {hash: '11'.repeat(32), vout: 0, value: 1000000},
    ]);
    const result = await zcash.getEstimateFee({
      fromAddress: 't1from',
      amount: '0.001', // 100000 zatoshi, well below the UTXO value
    });
    expect(result.fee).toBe('10000');
  });

  it('defaults to the ZIP-317 protocol minimum and exposes Advanced Fees presets', async () => {
    // Recommended must equal today's unchanged fee for anyone who never
    // opens Advanced Fees -- ZIP-317's marginal fee is a network-required
    // minimum, not a Bitcoin-style market rate, so there's no reason to
    // overpay by default.
    const zcash = loadZcashChain(false);
    const {
      BitcoinFork,
    } = require('dok-wallet-blockchain-networks/service/bitcoinFork');

    BitcoinFork.getUTXO.mockResolvedValue([
      {hash: '11'.repeat(32), vout: 0, value: 1000000},
    ]);
    const result = await zcash.getEstimateFee({
      fromAddress: 't1from',
      amount: '0.001',
    });
    // 1 input, 1 output (well below balance, so a change output too): 2
    // logical actions * 5000 zat/action minimum.
    expect(result.fee).toBe('10000');
    expect(result.gasFee).toBe(5000);
    expect(result.estimateGas).toBe(2);
    expect(result.feesOptions).toEqual([
      {title: 'Recommended', gasPrice: 5000},
      {title: 'Normal', gasPrice: 7500},
    ]);
  });

  it('charges the higher "Normal" rate when feesType is normal', async () => {
    const zcash = loadZcashChain(false);
    const {
      BitcoinFork,
    } = require('dok-wallet-blockchain-networks/service/bitcoinFork');

    BitcoinFork.getUTXO.mockResolvedValue([
      {hash: '11'.repeat(32), vout: 0, value: 1000000},
    ]);
    const result = await zcash.getEstimateFee({
      fromAddress: 't1from',
      amount: '0.001',
      feesType: 'normal',
    });
    // 2 logical actions * 7500 zat/action (1.5x the protocol minimum).
    expect(result.fee).toBe('15000');
    expect(result.gasFee).toBe(7500);
  });

  it('honors a remote-config feeMultiplier override for both presets', async () => {
    const zcash = loadZcashChain(false);
    const {
      BitcoinFork,
    } = require('dok-wallet-blockchain-networks/service/bitcoinFork');

    BitcoinFork.getUTXO.mockResolvedValue([
      {hash: '11'.repeat(32), vout: 0, value: 1000000},
    ]);
    const result = await zcash.getEstimateFee({
      fromAddress: 't1from',
      amount: '0.001',
      feeMultiplier: {recommended: 2, normal: 3},
    });
    expect(result.feesOptions).toEqual([
      {title: 'Recommended', gasPrice: 10000},
      {title: 'Normal', gasPrice: 15000},
    ]);
    expect(result.fee).toBe('20000'); // 2 actions * 10000
  });

  it('throws when the UTXO set cannot cover amount + fee', async () => {
    const zcash = loadZcashChain(false);
    const {
      BitcoinFork,
    } = require('dok-wallet-blockchain-networks/service/bitcoinFork');

    BitcoinFork.getUTXO.mockResolvedValue([
      {hash: '11'.repeat(32), vout: 0, value: 1000},
    ]);
    await expect(
      zcash.getEstimateFee({fromAddress: 't1from', amount: '0.0001'}),
    ).rejects.toThrow('Insufficient balance');
  });

  it('estimates a fee for a "Max" send, where amount equals the full balance', async () => {
    // The "Max" button passes the full gross balance as `amount`, then nets
    // the returned fee out of it -- it never sends amount + fee on top of
    // the balance. selectUtxosAndFee's strict balance - amount - fee >= 0
    // check can never pass in that case, so getEstimateFee must fall back to
    // estimating the fee for spending every UTXO into a single output.
    const zcash = loadZcashChain(false);
    const {
      BitcoinFork,
    } = require('dok-wallet-blockchain-networks/service/bitcoinFork');

    BitcoinFork.getUTXO.mockResolvedValue([
      {hash: '11'.repeat(32), vout: 0, value: 500000},
    ]);
    const result = await zcash.getEstimateFee({
      fromAddress: 't1from',
      amount: '0.005', // 500000 zatoshi == the entire UTXO balance
    });
    // 1 input, 1 output: fee = 5000 * max(1, 2) = 10000.
    expect(result.fee).toBe('10000');
  });

  it('still throws for a dust-only balance that cannot even cover a fee', async () => {
    const zcash = loadZcashChain(false);
    const {
      BitcoinFork,
    } = require('dok-wallet-blockchain-networks/service/bitcoinFork');

    BitcoinFork.getUTXO.mockResolvedValue([
      {hash: '11'.repeat(32), vout: 0, value: 1000},
    ]);
    await expect(
      zcash.getEstimateFee({fromAddress: 't1from', amount: '0.00001'}), // 1000 zatoshi == full balance
    ).rejects.toThrow('Insufficient balance');
  });
});

describe('ZcashChain send', () => {
  it('produces a raw transaction with a cryptographically valid ZIP-243 signature', async () => {
    const zcash = loadZcashChain(false);
    const {
      BitcoinFork,
    } = require('dok-wallet-blockchain-networks/service/bitcoinFork');
    const {
      Cipherscan,
    } = require('dok-wallet-blockchain-networks/service/cipherscan');

    // eslint-disable-next-line no-undef
    const keyPair = ECPair.fromPrivateKey(Buffer.alloc(32, 7), {
      network: bitcoin.networks.bitcoin,
    });
    const wif = keyPair.toWIF();
    const {address: fromAddress} = zcash.createWalletByPrivateKey({
      privateKey: wif,
    });
    const toAddress = 't1QahNjDdibyE4EdYkawUSKBBcVTSqv64CS'; // any valid mainnet P2PKH address

    BitcoinFork.getUTXO.mockResolvedValue([
      {hash: '22'.repeat(32), vout: 0, value: 1000000},
    ]);
    let capturedHex = null;

    Cipherscan.createTransaction.mockImplementation(({txHex}) => {
      capturedHex = txHex;
      return Promise.resolve('mock-txid');
    });

    const txid = await zcash.send({
      to: toAddress,
      from: fromAddress,
      amount: '0.001', // 100000 zatoshi
      privateKey: wif,
    });

    expect(txid).toBe('mock-txid');
    expect(capturedHex).toBeTruthy();
    assertValidZip243Signature(capturedHex, {
      inputValue: 1000000n,
      // Matches the mocked ZCASH_CONSENSUS_BRANCH_ID in loadZcashChain.
      branchIdHex: 'deadbeef',
    });
  });

  it('throws when the UTXO set cannot cover amount + fee', async () => {
    const zcash = loadZcashChain(false);
    const {
      BitcoinFork,
    } = require('dok-wallet-blockchain-networks/service/bitcoinFork');

    BitcoinFork.getUTXO.mockResolvedValue([
      {hash: '11'.repeat(32), vout: 0, value: 1000},
    ]);
    await expect(
      zcash.send({
        to: 't1QahNjDdibyE4EdYkawUSKBBcVTSqv64CS',
        from: 't1from',
        amount: '0.0001',
        privateKey: 'irrelevant',
      }),
    ).rejects.toThrow('Insufficient balance');
  });

  it('sends the full balance once the caller nets the estimated "Max" fee out of amount', async () => {
    // Mirrors the real flow: the UI calls getEstimateFee with the gross
    // balance, then calls send() with balance - fee. That net amount must
    // consume every UTXO with no leftover change.
    const zcash = loadZcashChain(false);
    const {
      BitcoinFork,
    } = require('dok-wallet-blockchain-networks/service/bitcoinFork');
    const {
      Cipherscan,
    } = require('dok-wallet-blockchain-networks/service/cipherscan');

    // eslint-disable-next-line no-undef
    const keyPair = ECPair.fromPrivateKey(Buffer.alloc(32, 7), {
      network: bitcoin.networks.bitcoin,
    });
    const wif = keyPair.toWIF();
    const {address: fromAddress} = zcash.createWalletByPrivateKey({
      privateKey: wif,
    });
    const toAddress = 't1QahNjDdibyE4EdYkawUSKBBcVTSqv64CS';

    BitcoinFork.getUTXO.mockResolvedValue([
      {hash: '22'.repeat(32), vout: 0, value: 500000},
    ]);

    const {fee} = await zcash.getEstimateFee({
      fromAddress,
      amount: '0.005', // 500000 zatoshi, the full balance
    });
    expect(fee).toBe('10000');

    let capturedHex = null;
    Cipherscan.createTransaction.mockImplementation(({txHex}) => {
      capturedHex = txHex;
      return Promise.resolve('mock-txid');
    });

    const txid = await zcash.send({
      to: toAddress,
      from: fromAddress,
      amount: '0.0049', // 500000 - 10000 zatoshi, net of the estimated fee
      privateKey: wif,
    });

    // Doesn't re-verify the ZIP-243 signature itself (see the dedicated
    // signature test above) -- this only confirms the net amount computed
    // from the "Max" fee estimate doesn't trip selectUtxosAndFee's
    // insufficient-balance check when it's actually spent.
    expect(txid).toBe('mock-txid');
    expect(capturedHex).toBeTruthy();
  });

  // Decodes just enough of a single-input, N-output raw tx to read back the
  // output values -- doesn't touch the scriptSig, so it works regardless of
  // the pre-existing signature-verification issue covered above.
  const decodeOutputValues = rawTxHex => {
    // eslint-disable-next-line no-undef
    const b = Buffer.from(rawTxHex, 'hex');
    let i = 8; // header + version group id
    i += 1; // nIn (always 1 in these tests)
    i += 32 + 4; // txid + vout
    const scriptSigLen = b[i];
    i += 1 + scriptSigLen;
    i += 4; // sequence
    const nOut = b[i];
    i += 1;
    const values = [];
    for (let k = 0; k < nOut; k++) {
      values.push(b.readBigInt64LE(i));
      i += 8;
      const scriptLen = b[i];
      i += 1 + scriptLen;
    }
    return values;
  };

  it('applies a custom "gasFee" rate above the ZIP-317 minimum', async () => {
    const zcash = loadZcashChain(false);
    const {
      BitcoinFork,
    } = require('dok-wallet-blockchain-networks/service/bitcoinFork');
    const {
      Cipherscan,
    } = require('dok-wallet-blockchain-networks/service/cipherscan');

    // eslint-disable-next-line no-undef
    const keyPair = ECPair.fromPrivateKey(Buffer.alloc(32, 7), {
      network: bitcoin.networks.bitcoin,
    });
    const wif = keyPair.toWIF();
    const {address: fromAddress} = zcash.createWalletByPrivateKey({
      privateKey: wif,
    });

    BitcoinFork.getUTXO.mockResolvedValue([
      {hash: '22'.repeat(32), vout: 0, value: 10000000},
    ]);
    let capturedHex = null;
    Cipherscan.createTransaction.mockImplementation(({txHex}) => {
      capturedHex = txHex;
      return Promise.resolve('mock-txid');
    });

    await zcash.send({
      to: 't1QahNjDdibyE4EdYkawUSKBBcVTSqv64CS',
      from: fromAddress,
      amount: '0.001', // 100000 zatoshi
      privateKey: wif,
      gasFee: 20000, // above the 5000 zat/action protocol minimum
    });

    const [recipientValue, changeValue] = decodeOutputValues(capturedHex);
    expect(recipientValue).toBe(100000n);
    // 1 input, 2 outputs -> 2 logical actions (grace floor) * 20000 zat/action.
    expect(changeValue).toBe(10000000n - 100000n - 40000n);
  });

  it('clamps a "gasFee" below the ZIP-317 minimum back up to the minimum', async () => {
    const zcash = loadZcashChain(false);
    const {
      BitcoinFork,
    } = require('dok-wallet-blockchain-networks/service/bitcoinFork');
    const {
      Cipherscan,
    } = require('dok-wallet-blockchain-networks/service/cipherscan');

    // eslint-disable-next-line no-undef
    const keyPair = ECPair.fromPrivateKey(Buffer.alloc(32, 7), {
      network: bitcoin.networks.bitcoin,
    });
    const wif = keyPair.toWIF();
    const {address: fromAddress} = zcash.createWalletByPrivateKey({
      privateKey: wif,
    });

    BitcoinFork.getUTXO.mockResolvedValue([
      {hash: '22'.repeat(32), vout: 0, value: 10000000},
    ]);
    let capturedHex = null;
    Cipherscan.createTransaction.mockImplementation(({txHex}) => {
      capturedHex = txHex;
      return Promise.resolve('mock-txid');
    });

    await zcash.send({
      to: 't1QahNjDdibyE4EdYkawUSKBBcVTSqv64CS',
      from: fromAddress,
      amount: '0.001',
      privateKey: wif,
      gasFee: 100, // below the protocol minimum -- must not be honored as-is
    });

    const [recipientValue, changeValue] = decodeOutputValues(capturedHex);
    expect(recipientValue).toBe(100000n);
    // Falls back to the 5000 zat/action protocol minimum, not the 100 asked for.
    expect(changeValue).toBe(10000000n - 100000n - 10000n);
  });
});
