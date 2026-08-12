/* eslint-disable no-undef */
import * as bitcoin from 'bitcoinjs-lib';
import ECPairFactory from 'ecpair';
import ecc from '@bitcoinerlab/secp256k1';
import BigNumber from 'bignumber.js';
import {IS_SANDBOX} from 'dok-wallet-blockchain-networks/config/config';
import {BitcoinFork} from 'dok-wallet-blockchain-networks/service/bitcoinFork';
import {BitcoinChain} from 'dok-wallet-blockchain-networks/cryptoChain/chains/BitcoinChain';

const varuint = require('varuint-bitcoin');

bitcoin.initEccLib(ecc);

export const BITCOIN_GET_ACCOUNT_ADDRESSES = 'getAccountAddresses';
export const BITCOIN_SEND_TRANSFER = 'sendTransfer';
export const BITCOIN_SIGN_MESSAGE = 'signMessage';
export const BITCOIN_SIGN_PSBT = 'signPsbt';

const NATIVE_SEGWIT_DERIVE_PATH = "m/84'/0'/0'/0/0";
const SEGWIT_DERIVE_PATH = "m/49'/0'/0'/0/0";
const LEGACY_DERIVE_PATH = "m/44'/0'/0'/0/0";

const getNetwork = () =>
  IS_SANDBOX ? bitcoin.networks.testnet : bitcoin.networks.bitcoin;

const getDerivePathByChain = chain_name => {
  if (chain_name === 'bitcoin_segwit') {
    return SEGWIT_DERIVE_PATH;
  }
  if (chain_name === 'bitcoin_legacy') {
    return LEGACY_DERIVE_PATH;
  }
  return NATIVE_SEGWIT_DERIVE_PATH;
};

const firstOf = data => (Array.isArray(data) ? data[0] : data);

const getKeyPairAndAddress = (privateKey, chain_name) => {
  const ECPair = ECPairFactory(ecc);
  const network = getNetwork();
  const keyPair = ECPair.fromWIF(privateKey, network);
  let address;
  if (chain_name === 'bitcoin_segwit') {
    const p2wpkh = bitcoin.payments.p2wpkh({
      pubkey: keyPair.publicKey,
      network,
    });
    address = bitcoin.payments.p2sh({redeem: p2wpkh, network}).address;
  } else if (chain_name === 'bitcoin_legacy') {
    address = bitcoin.payments.p2pkh({
      pubkey: keyPair.publicKey,
      network,
    }).address;
  } else {
    address = bitcoin.payments.p2wpkh({
      pubkey: keyPair.publicKey,
      network,
    }).address;
  }
  return {keyPair, address, network};
};

export const BitcoinWalletConnectGetAccountAddresses = async ({
  privateKey,
  chain_name,
}) => {
  try {
    const {keyPair, address} = getKeyPairAndAddress(privateKey, chain_name);
    return [
      {
        address,
        publicKey: Buffer.from(keyPair.publicKey).toString('hex'),
        path: getDerivePathByChain(chain_name),
        intention: 'payment',
      },
    ];
  } catch (e) {
    console.error('Error in BitcoinWalletConnectGetAccountAddresses', e);
    throw e;
  }
};

export const BitcoinWalletConnectSignMessage = async ({
  signTypeData,
  privateKey,
  chain_name,
}) => {
  try {
    const {keyPair, address} = getKeyPairAndAddress(privateKey, chain_name);
    const data = firstOf(signTypeData);
    const message = data?.message ?? data;
    const prefix = Buffer.from('Bitcoin Signed Message:\n', 'utf8');
    const messageBuffer = Buffer.from(message, 'utf8');
    const buffer = Buffer.concat([
      varuint.encode(prefix.length),
      prefix,
      varuint.encode(messageBuffer.length),
      messageBuffer,
    ]);
    const hash = bitcoin.crypto.hash256(buffer);
    const {signature, recoveryId} = ecc.signRecoverable(
      hash,
      keyPair.privateKey,
    );
    // BIP-137 header flag: 39-42 signals a native segwit (bech32) P2WPKH
    // address, 35-38 signals P2SH-P2WPKH (segwit), 31-34 signals compressed
    // P2PKH (legacy — ECPair keys here are always compressed) — must match
    // this wallet's address type.
    const flagBase =
      chain_name === 'bitcoin_segwit'
        ? 35
        : chain_name === 'bitcoin_legacy'
        ? 31
        : 39;
    const flag = flagBase + recoveryId;
    const compactSig = Buffer.concat([
      Buffer.from([flag]),
      Buffer.from(signature),
    ]);
    return {
      address,
      signature: compactSig.toString('hex'),
    };
  } catch (e) {
    console.error('Error in BitcoinWalletConnectSignMessage', e);
    throw e;
  }
};

export const BitcoinWalletConnectSignPsbt = async ({
  signTypeData,
  privateKey,
  chain_name,
}) => {
  try {
    const {keyPair, network} = getKeyPairAndAddress(privateKey, chain_name);
    const data = firstOf(signTypeData);
    const psbt = bitcoin.Psbt.fromBase64(data?.psbt, {network});
    const signInputs = data?.signInputs ?? [];
    signInputs.forEach(input => {
      psbt.signInput(input.index, keyPair, input.sighashTypes);
      psbt.finalizeInput(input.index);
    });
    if (data?.broadcast) {
      const txHex = psbt.extractTransaction().toHex();
      const txid = await BitcoinFork.createTransaction({
        txHex,
        chain: 'btc',
      });
      return {psbt: psbt.toBase64(), txid};
    }
    return {psbt: psbt.toBase64()};
  } catch (e) {
    console.error('Error in BitcoinWalletConnectSignPsbt', e);
    throw e;
  }
};

export const BitcoinWalletConnectSendTransfer = async ({
  signTypeData,
  privateKey,
  chain_name,
}) => {
  try {
    // BitcoinChain's getNetworkByChainName has no fallback for an
    // unrecognized chain_name, so normalize to a known value up front.
    const resolvedChainName = ['bitcoin_segwit', 'bitcoin_legacy'].includes(
      chain_name,
    )
      ? chain_name
      : 'bitcoin';
    const {address: fromAddress} = getKeyPairAndAddress(
      privateKey,
      resolvedChainName,
    );
    const data = firstOf(signTypeData);
    const chain = BitcoinChain();
    const derivePath = getDerivePathByChain(resolvedChainName);
    // bip122 sendTransfer amount is denominated in satoshis; chain.send/
    // getEstimateFee expect whole-coin (BTC) amounts, since they convert to
    // satoshis internally.
    const amount = new BigNumber(data?.amount).dividedBy(1e8).toString();
    const balanceResp = await chain.getBalance({
      address: fromAddress,
      chain_name: resolvedChainName,
      deriveAddresses: [{derivePath, address: fromAddress}],
    });
    const balance = balanceResp?.totalBalance || '0';
    const deriveAddresses = [
      {
        derivePath,
        address: fromAddress,
        balance,
        privateKey,
      },
    ];
    const feeResp = await chain.getEstimateFee({
      fromAddress,
      toAddress: data?.recipientAddress,
      amount,
      privateKey,
      chain_name: resolvedChainName,
      deriveAddresses,
      balance,
    });
    const txid = await chain.send({
      to: data?.recipientAddress,
      from: fromAddress,
      amount,
      privateKey,
      chain_name: resolvedChainName,
      deriveAddresses,
      balance,
      transactionFee: feeResp?.fee,
    });
    return {txid};
  } catch (e) {
    console.error('Error in BitcoinWalletConnectSendTransfer', e);
    throw e;
  }
};

export const bitcoinWalletConnectTransaction = async (
  method,
  payload,
  privateKey,
  signTypeData,
  chain_name,
) => {
  let tx = null;
  switch (method) {
    case BITCOIN_GET_ACCOUNT_ADDRESSES:
      tx = await BitcoinWalletConnectGetAccountAddresses({
        privateKey,
        chain_name,
      });
      break;
    case BITCOIN_SIGN_MESSAGE:
      tx = await BitcoinWalletConnectSignMessage({
        signTypeData,
        privateKey,
        chain_name,
      });
      break;
    case BITCOIN_SIGN_PSBT:
      tx = await BitcoinWalletConnectSignPsbt({
        signTypeData,
        privateKey,
        chain_name,
      });
      break;
    case BITCOIN_SEND_TRANSFER:
      tx = await BitcoinWalletConnectSendTransfer({
        signTypeData,
        privateKey,
        chain_name,
      });
      break;
    default:
      break;
  }
  return tx;
};
