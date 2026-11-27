/*
 * Review of a bip122 signPsbt request (pure, never throws): the outputs the
 * PSBT pays, which inputs this wallet signs, and whether any of those inputs
 * asks for a signature type that does not cover the outputs.
 */
import * as bitcoin from 'bitcoinjs-lib';
import {Buffer} from 'buffer';

const MAINNET_GENESIS = '000000000019d6689c085ae165831e93';
const SIGHASH_SINGLE = 0x03;
const SIGHASH_BASE_MASK = 0x1f;
// DEFAULT (taproot), ALL, ALL|ANYONECANPAY, SINGLE, SINGLE|ANYONECANPAY. The
// last two cover the output at the input's own index (marketplace listings).
const SAFE_SIGHASH_TYPES = [0x00, 0x01, 0x81, 0x03, 0x83];

const networkFor = chainId =>
  !chainId || String(chainId).split(':')[1] === MAINNET_GENESIS
    ? bitcoin.networks.bitcoin
    : bitcoin.networks.testnet;

const firstOf = data => (Array.isArray(data) ? data[0] : data);

// First input index (of `indexes`) whose signature type is unsafe, or null.
export const getUnsafePsbtInput = (psbt, indexes) => {
  const outputCount = psbt.txOutputs.length;
  for (const index of indexes) {
    const type =
      psbt.data.inputs[index]?.sighashType ?? bitcoin.Transaction.SIGHASH_ALL;
    if (!SAFE_SIGHASH_TYPES.includes(type)) {
      return {
        index,
        sighashType: type,
        reason: `Input #${index} asks for a signature that does not cover the outputs.`,
      };
    }
    if ((type & SIGHASH_BASE_MASK) === SIGHASH_SINGLE && index >= outputCount) {
      return {
        index,
        sighashType: type,
        reason: `Input #${index} asks for a signature tied to an output that does not exist.`,
      };
    }
  }
  return null;
};

const formatBtc = sats => {
  const value = BigInt(sats);
  const whole = value / 100000000n;
  const fraction = (value % 100000000n)
    .toString()
    .padStart(8, '0')
    .replace(/0+$/, '');
  return fraction ? `${whole}.${fraction}` : `${whole}`;
};

const addressOf = (script, network) => {
  try {
    return bitcoin.address.fromOutputScript(script, network);
  } catch (e) {
    return `script ${Buffer.from(script).toString('hex')}`;
  }
};

const inputScript = (psbt, index) => {
  const input = psbt.data.inputs[index];
  if (input?.witnessUtxo) {
    return input.witnessUtxo.script;
  }
  if (input?.nonWitnessUtxo) {
    const vout = psbt.txInputs[index].index;
    return bitcoin.Transaction.fromBuffer(input.nonWitnessUtxo).outs[vout]
      ?.script;
  }
  return null;
};

export const reviewPsbt = (signTypeData, {chainId, walletAddress} = {}) => {
  const data = firstOf(signTypeData);
  const network = networkFor(chainId);
  let psbt;
  try {
    psbt = bitcoin.Psbt.fromBase64(data?.psbt, {network});
  } catch (e) {
    return {
      level: 'danger',
      blocked: false,
      reasons: ['This PSBT could not be read, so its outputs cannot be shown.'],
      rows: [],
    };
  }
  const rows = psbt.txOutputs.map((output, i) => {
    const address = addressOf(output.script, network);
    const own = walletAddress && address === walletAddress;
    return {
      label: `Output ${i + 1}`,
      value: `${address}: ${formatBtc(output.value)} BTC${
        own ? ' (this wallet)' : ''
      }`,
    };
  });
  const indexes = data?.signInputs?.length
    ? data.signInputs.map(input => input.index)
    : psbt.txInputs
        .map((_, index) => index)
        .filter(index => {
          const script = inputScript(psbt, index);
          return (
            !!script &&
            !!walletAddress &&
            addressOf(script, network) === walletAddress
          );
        });
  rows.push({
    label: 'Inputs you sign',
    value: `${indexes.length} (${indexes.map(i => `#${i}`).join(', ')})`,
  });
  const unsafe = getUnsafePsbtInput(psbt, indexes);
  return {
    level: unsafe ? 'danger' : 'none',
    blocked: !!unsafe,
    reasons: unsafe ? [`${unsafe.reason} It cannot be signed.`] : [],
    rows,
  };
};
