/* eslint-disable no-undef */
import * as bitcoin from 'bitcoinjs-lib';
import ECPairFactory from 'ecpair';
import ecc from '@bitcoinerlab/secp256k1';
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

const getNetwork = () =>
  IS_SANDBOX ? bitcoin.networks.testnet : bitcoin.networks.bitcoin;

const firstOf = data => (Array.isArray(data) ? data[0] : data);

const getKeyPairAndAddress = privateKey => {
  const ECPair = ECPairFactory(ecc);
  const network = getNetwork();
  const keyPair = ECPair.fromWIF(privateKey, network);
  const {address} = bitcoin.payments.p2wpkh({
    pubkey: keyPair.publicKey,
    network,
  });
  return {keyPair, address, network};
};

export const BitcoinWalletConnectGetAccountAddresses = async ({privateKey}) => {
  try {
    const {keyPair, address} = getKeyPairAndAddress(privateKey);
    return [
      {
        address,
        publicKey: Buffer.from(keyPair.publicKey).toString('hex'),
        path: NATIVE_SEGWIT_DERIVE_PATH,
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
}) => {
  try {
    const {keyPair, address} = getKeyPairAndAddress(privateKey);
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
    // address, as opposed to 27-30 (P2PKH uncompressed) or 31-34 (P2PKH
    // compressed) or 35-38 (P2SH-P2WPKH) — must match this wallet's address type.
    const flag = 39 + recoveryId;
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
}) => {
  try {
    const {keyPair, network} = getKeyPairAndAddress(privateKey);
    const data = firstOf(signTypeData);
    const psbt = bitcoin.Psbt.fromBase64(data?.psbt, {network});
    const signInputs = data?.signInputs ?? [];
    signInputs.forEach(input => {
      psbt.signInput(input.index, keyPair, input.sighashTypes);
    });
    if (data?.broadcast) {
      psbt.finalizeAllInputs();
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
}) => {
  try {
    const {address: fromAddress} = getKeyPairAndAddress(privateKey);
    const data = firstOf(signTypeData);
    const chain = BitcoinChain();
    const txid = await chain.send({
      to: data?.recipientAddress,
      from: fromAddress,
      amount: data?.amount,
      privateKey,
      chain_name: 'bitcoin',
      deriveAddresses: [
        {
          derivePath: NATIVE_SEGWIT_DERIVE_PATH,
          address: fromAddress,
          balance: data?.amount,
          privateKey,
        },
      ],
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
) => {
  let tx = null;
  switch (method) {
    case BITCOIN_GET_ACCOUNT_ADDRESSES:
      tx = await BitcoinWalletConnectGetAccountAddresses({privateKey});
      break;
    case BITCOIN_SIGN_MESSAGE:
      tx = await BitcoinWalletConnectSignMessage({signTypeData, privateKey});
      break;
    case BITCOIN_SIGN_PSBT:
      tx = await BitcoinWalletConnectSignPsbt({signTypeData, privateKey});
      break;
    case BITCOIN_SEND_TRANSFER:
      tx = await BitcoinWalletConnectSendTransfer({signTypeData, privateKey});
      break;
    default:
      break;
  }
  return tx;
};
