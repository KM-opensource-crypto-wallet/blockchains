import ECPairFactory from 'ecpair';
import ecc from '@bitcoinerlab/secp256k1';
import * as bitcoin from 'bitcoinjs-lib';
import bs58 from 'bs58';
import blakejs from 'blakejs';
import BigNumber from 'bignumber.js';
import {config, IS_SANDBOX} from 'dok-wallet-blockchain-networks/config/config';
import {
  getExplorerTxUrl,
  parseBalance,
} from 'dok-wallet-blockchain-networks/helper';
import {BitcoinFork} from 'dok-wallet-blockchain-networks/service/bitcoinFork/bitcoinFork';

const CHAIN_CODE = 'zec';
const ZEC_DECIMALS = 8;

const consensusBranchId = () =>
  IS_SANDBOX
    ? config.ZCASH_TESTNET_CONSENSUS_BRANCH_ID
    : config.ZCASH_CONSENSUS_BRANCH_ID;

const toZatoshi = amount => new BigNumber(amount).times(1e8).toFixed(0);

// Transparent P2PKH/P2SH version bytes (mirrors the testnet P2PKH value
// already used in ios/ZcashCoin.swift; the rest are Zcash's well-known
// chainparams values). These are 2 bytes, unlike Bitcoin's single-byte
// pubKeyHash/scriptHash, so they can't be expressed as a bitcoinjs-lib
// `network` object and are base58check-encoded/decoded by hand.
const ZCASH_MAINNET_P2PKH_PREFIX = [0x1c, 0xb8]; // t1...
const ZCASH_TESTNET_P2PKH_PREFIX = [0x1d, 0x25]; // tm...
const ZCASH_MAINNET_P2SH_PREFIX = [0x1c, 0xbd]; // t3...
const ZCASH_TESTNET_P2SH_PREFIX = [0x1c, 0xba]; // t2...

// v4 (Sapling) transaction constants. WalletCore's own generated bindings
// document this as the only transaction version it can build, and Zcash's
// own backward-compatibility guarantee (unlike most of its network
// upgrades) is that v4 transparent transactions remain valid indefinitely
// -- verified directly against a real, currently-mined mainnet v4
// transaction sitting in the same block as v5/v6 ones.
const HEADER = 0x80000004;
const VERSION_GROUP_ID = 0x892f2085;

// ZIP-317 fee parameters (https://zips.z.cash/zip-0317). For an all-
// transparent transaction, logical_actions is just max(inputs, outputs);
// verified against a real mainnet transaction's actual paid fee.
const ZIP317_MARGINAL_FEE = 5000n;
const ZIP317_GRACE_ACTIONS = 2n;
const DUST_THRESHOLD = 546n;

const encodeZcashTransparentAddress = (prefix, hash160) => {
  // eslint-disable-next-line no-undef
  const payload = Buffer.concat([Buffer.from(prefix), hash160]);
  const checksum = bitcoin.crypto.hash256(payload).subarray(0, 4);
  // eslint-disable-next-line no-undef
  return bs58.encode(Buffer.concat([payload, checksum]));
};

// Base58check-decodes a Zcash transparent address into its raw 22-byte
// payload (2-byte version prefix + 20-byte hash160), verifying the
// checksum. Returns null instead of throwing so callers can choose how to
// report an invalid address.
const decodeZcashTransparentAddress = address => {
  if (typeof address !== 'string' || !address) {
    return null;
  }
  let decoded;
  try {
    decoded = bs58.decode(address);
  } catch (e) {
    return null;
  }
  // 2-byte version prefix + 20-byte hash160 + 4-byte checksum.
  if (decoded.length !== 26) {
    return null;
  }
  const payload = decoded.subarray(0, 22);
  const checksum = decoded.subarray(22);
  const expectedChecksum = bitcoin.crypto.hash256(payload).subarray(0, 4);
  // eslint-disable-next-line no-undef
  if (!Buffer.from(checksum).equals(Buffer.from(expectedChecksum))) {
    return null;
  }
  return payload;
};

// A regex on the raw string can only check character shape -- it can't catch
// a mistyped/corrupted address (wrong checksum) or one copied from the wrong
// network, since those still fit "t" + shape + length. Decode it for real,
// the same way BitcoinChain/DogecoinOrLitecoinChain validate addresses via
// bitcoinjs-lib: verify the base58check checksum and match the 2-byte version
// prefix against Zcash's transparent P2PKH/P2SH prefixes for the active network.
const isValidZcashTransparentAddress = address => {
  const payload = decodeZcashTransparentAddress(address);
  if (!payload) {
    return false;
  }
  const validPrefixes = IS_SANDBOX
    ? [ZCASH_TESTNET_P2PKH_PREFIX, ZCASH_TESTNET_P2SH_PREFIX]
    : [ZCASH_MAINNET_P2PKH_PREFIX, ZCASH_MAINNET_P2SH_PREFIX];
  return validPrefixes.some(
    prefix => prefix[0] === payload[0] && prefix[1] === payload[1],
  );
};

// Only P2PKH recipients are supported for building outputs (matches what
// createWalletByPrivateKey ever generates for this wallet's own addresses);
// a P2SH `to`/change address would need a different output script than
// p2pkhScript below.
const addressToHash160 = address => {
  const payload = decodeZcashTransparentAddress(address);
  if (!payload) {
    throw new Error(`Invalid Zcash transparent address: ${address}`);
  }
  const p2pkhPrefix = IS_SANDBOX
    ? ZCASH_TESTNET_P2PKH_PREFIX
    : ZCASH_MAINNET_P2PKH_PREFIX;
  if (payload[0] !== p2pkhPrefix[0] || payload[1] !== p2pkhPrefix[1]) {
    throw new Error(
      `Unsupported Zcash address type (only transparent P2PKH is supported): ${address}`,
    );
  }
  // eslint-disable-next-line no-undef
  return Buffer.from(payload.subarray(2));
};

// --- little-endian / CompactSize serialization helpers -------------------

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
const writeVarInt = n => {
  const v = BigInt(n);
  if (v < 0xfdn) {
    // eslint-disable-next-line no-undef
    return Buffer.from([Number(v)]);
  }
  if (v <= 0xffffn) {
    // eslint-disable-next-line no-undef
    const b = Buffer.alloc(3);
    b[0] = 0xfd;
    b.writeUInt16LE(Number(v), 1);
    return b;
  }
  if (v <= 0xffffffffn) {
    // eslint-disable-next-line no-undef
    const b = Buffer.alloc(5);
    b[0] = 0xfe;
    b.writeUInt32LE(Number(v), 1);
    return b;
  }
  // eslint-disable-next-line no-undef
  const b = Buffer.alloc(9);
  b[0] = 0xff;
  b.writeBigUInt64LE(v, 1);
  return b;
};
// eslint-disable-next-line no-undef
const varSlice = buf => Buffer.concat([writeVarInt(buf.length), buf]);

const p2pkhScript = hash160 =>
  // eslint-disable-next-line no-undef
  Buffer.concat([
    // eslint-disable-next-line no-undef
    Buffer.from([0x76, 0xa9, 0x14]),
    hash160,
    // eslint-disable-next-line no-undef
    Buffer.from([0x88, 0xac]),
  ]);

// --- ZIP-243 sighash (BLAKE2b-256, personalized) --------------------------
//
// bitcoinjs-lib can't build/sign a Zcash transaction (its sighash isn't
// SHA256d like Bitcoin's), which is why this chain used to hand the whole
// job to WalletCore's native Zcash signer. That signer turned out to
// produce cryptographically invalid signatures for real transactions
// (verified independently by recomputing this exact sighash and checking
// the signature against it with secp256k1 -- confirmed correct first
// against WalletCore's own published test vector, then shown to fail
// against a real signed tx). This reimplements ZIP-243 directly instead,
// verified the same way: it validates WalletCore's own known-good test
// vector before being trusted here.
//
// Uses `blakejs` (pure JS) rather than the more common `blake2b` package:
// the latter is a WASM wrapper (blake2b-wasm), and Hermes -- this app's JS
// engine (ios/Podfile: hermes_enabled) -- has no WebAssembly support, so it
// would fail at runtime despite working fine under Node.
const blake2b256 = (data, personalBuf) =>
  // eslint-disable-next-line no-undef
  Buffer.from(blakejs.blake2b(data, null, 32, null, personalBuf));

const personalization = (asciiPrefix, branchIdBuf) => {
  // eslint-disable-next-line no-undef
  const p = Buffer.alloc(16);
  // eslint-disable-next-line no-undef
  Buffer.from(asciiPrefix, 'ascii').copy(p, 0);
  if (branchIdBuf) {
    branchIdBuf.copy(p, asciiPrefix.length);
  }
  return p;
};

const getConsensusBranchIdLE = () => {
  const branchId = consensusBranchId();

  if (!/^[0-9a-fA-F]{8}$/.test(branchId)) {
    throw new Error(`Invalid Zcash consensus branch ID: ${branchId}`);
  }

  return Buffer.from(branchId, 'hex').reverse();
};
// Builds and signs a v4 transparent (P2PKH-only) Zcash transaction. All
// inputs are assumed to be spendable by the same `privateKey`/address, which
// matches this wallet's single-address-per-coin model.
const buildAndSignZcashTransaction = ({inputs, outputs, privateKey}) => {
  const network = IS_SANDBOX
    ? bitcoin.networks.testnet
    : bitcoin.networks.bitcoin;
  const ECPair = ECPairFactory(ecc);
  const keyPair = ECPair.fromWIF(privateKey, network);
  const pubkeyHash = bitcoin.crypto.hash160(keyPair.publicKey);
  const scriptCode = p2pkhScript(pubkeyHash);

  // const branchIdBuf = Buffer.from(consensusBranchId(), 'hex');
  const branchIdBuf = getConsensusBranchIdLE();

  console.log('Branch ID LE:', branchIdBuf.toString('hex'));

  const inputTxidBufs = inputs.map(input =>
    // eslint-disable-next-line no-undef
    Buffer.from(input.txid, 'hex').reverse(),
  );

  // eslint-disable-next-line no-undef
  const outpoints = Buffer.concat(
    inputs.map((input, idx) =>
      // eslint-disable-next-line no-undef
      Buffer.concat([inputTxidBufs[idx], writeUInt32LE(input.vout)]),
    ),
  );
  // eslint-disable-next-line no-undef
  const sequences = Buffer.concat(inputs.map(() => writeUInt32LE(0xfffffffd)));
  // eslint-disable-next-line no-undef
  const serializedOutputs = Buffer.concat(
    outputs.map(output =>
      // eslint-disable-next-line no-undef
      Buffer.concat([
        writeInt64LE(output.value),
        varSlice(p2pkhScript(addressToHash160(output.address))),
      ]),
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
  const lockTime = writeUInt32LE(0);
  const expiryHeight = writeUInt32LE(0);
  const valueBalance = writeInt64LE(0n);
  const sighashType = writeUInt32LE(1); // SIGHASH_ALL
  const sigHashPersonal = personalization('ZcashSigHash', branchIdBuf);

  const scriptSigs = inputs.map((input, idx) => {
    // eslint-disable-next-line no-undef
    const preimage = Buffer.concat([
      writeUInt32LE(HEADER),
      writeUInt32LE(VERSION_GROUP_ID),
      hashPrevouts,
      hashSequence,
      hashOutputs,
      zero32, // hashJoinSplits
      zero32, // hashShieldedSpends
      zero32, // hashShieldedOutputs
      lockTime,
      expiryHeight,
      valueBalance,
      sighashType,
      // Per-input data for the input being signed:
      inputTxidBufs[idx],
      writeUInt32LE(input.vout),
      varSlice(scriptCode),
      writeInt64LE(input.value),
      writeUInt32LE(0xfffffffd),
    ]);
    const sighash = blake2b256(preimage, sigHashPersonal);
    const signature = keyPair.sign(sighash);
    const derSignature = bitcoin.script.signature.encode(
      // eslint-disable-next-line no-undef
      Buffer.from(signature),
      0x01, // SIGHASH_ALL
    );
    // eslint-disable-next-line no-undef
    return Buffer.concat([
      varSlice(derSignature),
      // eslint-disable-next-line no-undef
      varSlice(Buffer.from(keyPair.publicKey)),
    ]);
  });

  const parts = [
    writeUInt32LE(HEADER),
    writeUInt32LE(VERSION_GROUP_ID),
    writeVarInt(inputs.length),
  ];
  inputs.forEach((input, idx) => {
    parts.push(inputTxidBufs[idx]);
    parts.push(writeUInt32LE(input.vout));
    parts.push(varSlice(scriptSigs[idx]));
    parts.push(writeUInt32LE(0xfffffffd));
  });
  parts.push(writeVarInt(outputs.length));
  parts.push(serializedOutputs);
  parts.push(lockTime);
  parts.push(expiryHeight);
  parts.push(valueBalance);
  parts.push(writeVarInt(0)); // nShieldedSpend
  parts.push(writeVarInt(0)); // nShieldedOutput
  parts.push(writeVarInt(0)); // nJoinSplit

  // eslint-disable-next-line no-undef
  return Buffer.concat(parts).toString('hex');
};

// ZIP-317: fee = marginal_fee * max(logical_actions, grace_actions). For an
// all-transparent transaction, logical_actions is max(inputs, outputs).
// `marginalFee` defaults to the protocol-required minimum (ZIP317_MARGINAL_FEE)
// but callers may raise it -- via the Advanced Fees "Normal"/Custom options --
// to pay more per action than the network requires; it can never be used to
// pay less, since nodes reject anything under the true minimum.
const calculateZip317Fee = (
  numInputs,
  numOutputs,
  marginalFee = ZIP317_MARGINAL_FEE,
) => {
  const actions = BigInt(Math.max(numInputs, numOutputs, 1));
  const logicalActions =
    actions > ZIP317_GRACE_ACTIONS ? actions : ZIP317_GRACE_ACTIONS;
  return marginalFee * logicalActions;
};

// Greedily selects UTXOs (in the order returned by the provider) until the
// running total covers amount + fee, recomputing the ZIP-317 fee (at
// `marginalFee` zatoshi per logical action) as inputs are added. Drops the
// change output if it would be dust, folding the difference into the fee
// instead (never creates a sub-dust output).
const selectUtxosAndFee = (
  utxos,
  amountZatoshiStr,
  marginalFee = ZIP317_MARGINAL_FEE,
) => {
  const amount = BigInt(amountZatoshiStr);
  if (amount <= 0n) {
    throw new Error('Amount must be greater than zero');
  }
  const selected = [];
  let total = 0n;
  for (const utxo of utxos) {
    selected.push(utxo);
    total += BigInt(utxo.value);

    const feeWithChange = calculateZip317Fee(selected.length, 2, marginalFee);
    const changeWithChange = total - amount - feeWithChange;
    if (changeWithChange >= DUST_THRESHOLD) {
      return {selected, fee: feeWithChange, change: changeWithChange};
    }

    const feeNoChange = calculateZip317Fee(selected.length, 1, marginalFee);
    if (total - amount - feeNoChange >= 0n) {
      // Either no change needed, or change would be dust -- fold the
      // remainder into the fee rather than create a sub-dust output.
      return {selected, fee: total - amount, change: 0n};
    }
  }
  throw new Error('Insufficient balance to broadcast transaction');
};

const sumUtxoValues = utxos =>
  utxos.reduce((sum, utxo) => sum + BigInt(utxo.value), 0n);

export const ZcashChain = () => {
  return {
    // t1.../t3... = mainnet P2PKH/P2SH, tm.../t2... = testnet P2PKH/P2SH.
    isValidAddress: ({address}) => isValidZcashTransparentAddress(address),
    isValidPrivateKey: ({privateKey}) => {
      try {
        const ECPair = ECPairFactory(ecc);
        const network = IS_SANDBOX
          ? bitcoin.networks.testnet
          : bitcoin.networks.bitcoin;
        const keyPair = ECPair.fromWIF(privateKey, network);
        return !!keyPair?.publicKey;
      } catch (e) {
        return false;
      }
    },
    createWalletByPrivateKey: ({privateKey}) => {
      const ECPair = ECPairFactory(ecc);
      const network = IS_SANDBOX
        ? bitcoin.networks.testnet
        : bitcoin.networks.bitcoin;
      const keyPair = ECPair.fromWIF(privateKey, network);
      const hash160 = bitcoin.crypto.hash160(keyPair.publicKey);
      const prefix = IS_SANDBOX
        ? ZCASH_TESTNET_P2PKH_PREFIX
        : ZCASH_MAINNET_P2PKH_PREFIX;
      return {
        address: encodeZcashTransparentAddress(prefix, hash160),
        privateKey: keyPair.toWIF(),
      };
    },
    getBalance: async ({address}) => {
      try {
        return await BitcoinFork.getBalance({chain: CHAIN_CODE, address});
      } catch (e) {
        console.error('error in get balance from zcash', e);
        return '0';
      }
    },
    getTransactions: async ({address}) => {
      try {
        const transactions = await BitcoinFork.getTransactions({
          chain: CHAIN_CODE,
          address,
        });
        if (!Array.isArray(transactions)) return [];
        return transactions.map(item => ({
          amount: item?.amount?.toString(),
          link: item?.hash,
          url: getExplorerTxUrl('zcash', item?.hash),
          status: item?.status ? 'SUCCESS' : 'Pending',
          date: new Date(item?.timestamp),
          from: item?.from,
          to: item?.to,
          totalCourse: '0$',
          transactionType: 'regular',
          blockNumber: item?.blockNumber ?? null,
          confirmations: item?.confirmations ?? null,
        }));
      } catch (e) {
        console.error('error getting transactions for zcash', e);
        return [];
      }
    },
    getTransaction: async ({txHash, address}) => {
      try {
        const response = await BitcoinFork.getTransaction({
          transactionId: txHash,
          chain: CHAIN_CODE,
          address,
        });
        if (!response) return {data: null};
        return {
          data: {
            amount: response?.amount?.toString(),
            link: txHash,
            url: getExplorerTxUrl('zcash', txHash),
            status: response?.status ? 'SUCCESS' : 'Pending',
            date: response?.timestamp ? new Date(response?.timestamp) : null,
            from: response?.from,
            to: response?.to,
            totalCourse: '0$',
            blockNumber: response?.blockNumber ?? null,
            confirmations: response?.confirmations ?? null,
          },
        };
      } catch (e) {
        console.error('error getting transaction for zcash', e);
        return {data: null};
      }
    },
    // Advanced Fees support: unlike Bitcoin's sat/vByte (a congestion-driven
    // market rate), ZIP-317's marginal fee is a network-defined *minimum* --
    // paying more doesn't buy priority the way it does on Bitcoin, so
    // "Recommended" stays pinned to exactly that minimum (feeMultiplier
    // defaults to 1x, i.e. today's unchanged fee for anyone who never opens
    // Advanced Fees) and "Normal" is a purely elective higher rate. Both are
    // expressed in zatoshi per ZIP-317 "logical action" -- the same unit
    // `send` receives back as `gasFee` -- so the generic
    // transactionFee = gasPrice * estimateGas math in currentTransferSlice
    // reproduces calculateZip317Fee's own formula unmodified.
    getEstimateFee: async ({fromAddress, amount, feeMultiplier, feesType}) => {
      try {
        const utxos = await BitcoinFork.getUTXO({
          chain: CHAIN_CODE,
          address: fromAddress,
        });
        if (!utxos?.length) {
          throw new Error('Insufficient balance to broadcast transaction');
        }
        const recommendedMultiplier = feeMultiplier?.recommended || 1;
        const normalMultiplier = feeMultiplier?.normal || 1.5;
        const recommendedMarginalFee = BigInt(
          Math.round(Number(ZIP317_MARGINAL_FEE) * recommendedMultiplier),
        );
        const normalMarginalFee = BigInt(
          Math.round(Number(ZIP317_MARGINAL_FEE) * normalMultiplier),
        );
        const feesOptions = [
          {title: 'Recommended', gasPrice: Number(recommendedMarginalFee)},
          {title: 'Normal', gasPrice: Number(normalMarginalFee)},
        ];
        const marginalFee =
          feesType === 'normal' ? normalMarginalFee : recommendedMarginalFee;

        const amountZatoshi = toZatoshi(amount);
        let fee;
        let selectedCount;
        try {
          const result = selectUtxosAndFee(utxos, amountZatoshi, marginalFee);
          fee = result.fee;
          selectedCount = result.selected.length;
        } catch (err) {
          // Sending the "Max" amount passes the full gross balance as
          // `amount` (the caller nets the fee out of it afterwards), which
          // leaves no room for selectUtxosAndFee's balance - amount - fee
          // >= 0 check to ever pass. Fall back to the fee for spending every
          // UTXO into a single (no-change) output -- what `send` will
          // actually build once the caller subtracts this fee from amount --
          // and only re-throw if the balance can't even cover that.
          const totalUtxoValue = sumUtxoValues(utxos);
          const maxFee = calculateZip317Fee(utxos.length, 1, marginalFee);
          if (totalUtxoValue <= maxFee) {
            throw err;
          }
          fee = maxFee;
          selectedCount = utxos.length;
        }
        return {
          fee: parseBalance(fee.toString(), ZEC_DECIMALS),
          // The zat/action rate actually used, echoed back so `send` can
          // reapply the same rate to whatever UTXO set it ends up choosing.
          gasFee: Number(marginalFee),
          // Logical actions -- stable across Recommended/Normal/Custom since
          // they only change the per-action rate, not which UTXOs get used.
          estimateGas: Math.max(selectedCount, 2),
          feesOptions,
        };
      } catch (e) {
        console.error('Error in zcash gas fee', e);
        throw e;
      }
    },
    send: async ({to, from, amount, privateKey, gasFee}) => {
      try {
        const utxos = await BitcoinFork.getUTXO({
          chain: CHAIN_CODE,
          address: from,
        });
        console.log('Zcash UTXOs:', JSON.stringify(utxos, null, 2));
        if (!utxos?.length) {
          throw new Error('Insufficient balance to broadcast transaction');
        }
        const amountZatoshi = toZatoshi(amount);
        // `gasFee` is the zat/action rate selected via Advanced Fees. It can
        // only raise the fee above the ZIP-317 protocol minimum, never lower
        // it -- an under-minimum fee would just make the node reject the
        // broadcast.
        const requestedMarginalFee = gasFee
          ? BigInt(Math.round(Number(gasFee)))
          : ZIP317_MARGINAL_FEE;
        const marginalFee =
          requestedMarginalFee > ZIP317_MARGINAL_FEE
            ? requestedMarginalFee
            : ZIP317_MARGINAL_FEE;
        const {selected, change} = selectUtxosAndFee(
          utxos,
          amountZatoshi,
          marginalFee,
        );

        const outputs = [{address: to, value: BigInt(amountZatoshi)}];
        if (change > 0n) {
          outputs.push({address: from, value: change});
        }
        console.log('selected:', selected);
        const rawTransaction = buildAndSignZcashTransaction({
          inputs: selected.map(utxo => ({
            txid: utxo.hash,
            vout: utxo.vout,
            value: BigInt(utxo.value),
          })),
          outputs,
          privateKey,
        });

        // TEMP diagnostic (see conversation history): Cipherscan's broadcast
        // endpoint returns the same generic "Failed to broadcast transaction"
        // string for any rejection, so it carries no signal on its own about
        // whether this specific transaction is well-formed. Logging the raw
        // hex here (not sensitive -- it's the public, about-to-be-broadcast
        // transaction, no private key material) so it can be decoded/
        // verified independently.
        console.log('Zcash rawTransaction about to broadcast:', rawTransaction);
        return await BitcoinFork.createTransaction({
          chain: CHAIN_CODE,
          txHex: rawTransaction,
        });
      } catch (e) {
        console.error('Error in send zcash transaction', e);
        console.error('========== ZCASH SEND ERROR ==========');
        console.error('message:', e?.message);
        console.error('response:', e?.response?.data);
        console.error('status:', e?.response?.status);
        console.error('error:', e);
        console.error('======================================');

        throw e;
      }
    },
    waitForConfirmation: async ({transaction, address}) => {
      const transactionID = transaction;
      if (!transactionID) {
        console.error('No transaction id found for zcash');
        return null;
      }
      return new Promise(resolve => {
        let numberOfRetries = 0;
        const timer = setInterval(async () => {
          try {
            numberOfRetries += 1;
            const isConfirmed = await BitcoinFork.getTransaction({
              chain: CHAIN_CODE,
              transactionId: transactionID,
              address,
            });
            if (isConfirmed?.status && Number(isConfirmed?.blockNumber) > 0) {
              clearInterval(timer);
              resolve(isConfirmed);
            } else if (numberOfRetries >= 15) {
              clearInterval(timer);
              resolve('pending');
            }
          } catch (e) {
            console.error('Error in get transaction', e);
            if (numberOfRetries >= 15) {
              clearInterval(timer);
              resolve('pending');
            }
          }
        }, 5000);
      });
    },
  };
};
