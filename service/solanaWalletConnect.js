import {Connection, Keypair, VersionedTransaction} from '@solana/web3.js';
import bs58 from 'bs58';
import nacl from 'tweetnacl';
import {customFetchWithTimeout} from 'dok-wallet-blockchain-networks/helper';
import {getFreeRPCUrl} from 'dok-wallet-blockchain-networks/rpcUrls/rpcUrls';

export const SOLANA_SIGN_TRANSACTION = 'solana_signTransaction';

export const SOLANA_SIGN_MESSAGE = 'solana_signMessage';
export const SOLANA_SIGN_ALL_TRANSACTIONS = 'solana_signAllTransactions';
export const SOLANA_SIGN_AND_SEND_TRANSACTION = 'solana_signAndSendTransaction';

export const solanaWalletConnectTransaction = async (
  method,
  payload,
  privateKey,
  signTypeData,
) => {
  let tx = null;
  switch (method) {
    case SOLANA_SIGN_TRANSACTION:
      tx = await solanaWalletConnectSignTransaction(payload, privateKey);
      break;
    case SOLANA_SIGN_AND_SEND_TRANSACTION:
      tx = await solanaWalletConnectSignAndSendTransaction(payload, privateKey);
      break;
    case SOLANA_SIGN_MESSAGE:
      tx = await solanaWalletConnectSignMessage(signTypeData, privateKey);
      break;
    default:
      break;
  }
  return tx;
};

export const solanaWalletConnectSignTransaction = async (
  payload,
  privateKey,
) => {
  try {
    const secretKey = bs58.decode(privateKey);
    const keypair = Keypair.fromSecretKey(secretKey, {
      skipValidation: true,
    });
    // eslint-disable-next-line no-undef
    const txBuffer = Buffer.from(payload, 'base64');
    const versionedTransaction = VersionedTransaction.deserialize(txBuffer);
    versionedTransaction.sign([keypair]);
    const primarySigPubkeyPair = versionedTransaction.signatures[0];
    if (!primarySigPubkeyPair) {
      throw new Error('Missing signature');
    }
    const signature = bs58.encode(primarySigPubkeyPair);
    return {signature};
  } catch (e) {
    console.error('Error in send solanaWalletConnectSignTransaction', e);
    return Promise.reject(e?.message);
  }
};

export const solanaWalletConnectSignAndSendTransaction = async (
  payload,
  privateKey,
) => {
  try {
    const secretKey = bs58.decode(privateKey);
    const keypair = Keypair.fromSecretKey(secretKey, {
      skipValidation: true,
    });
    // eslint-disable-next-line no-undef
    const txBuffer = Buffer.from(payload, 'base64');

    const versionedTransaction = VersionedTransaction.deserialize(txBuffer);
    const rpcs = getFreeRPCUrl('tx_solana');
    for (let i = 0; i < rpcs.length; i++) {
      try {
        const solanaProvider = new Connection(rpcs[i], {
          fetch: customFetchWithTimeout,
        });
        const finalTransaction = new VersionedTransaction(
          versionedTransaction.message,
        );
        finalTransaction.sign([keypair]);
        const txHash = await solanaProvider.sendTransaction(finalTransaction, {
          skipPreflight: true,
          preflightCommitment: 'processed',
        });
        return {signature: txHash};
      } catch (e) {
        console.error(
          'Error in solanaWalletConnectSignAndSendTransaction with rpc',
          rpcs[i],
          e,
        );
        if (i === rpcs.length - 1) {
          throw e;
        }
      }
    }
  } catch (e) {
    console.error('Error in solanaWalletConnectSignAndSendTransaction', e);
    return Promise.reject(e?.message);
  }
};

export const solanaWalletConnectSignMessage = async (payload, privateKey) => {
  try {
    const secretKey = bs58.decode(privateKey);
    const from = Keypair.fromSecretKey(secretKey, {
      skipValidation: true,
    });
    const signature = nacl.sign.detached(bs58.decode(payload), from.secretKey);
    const bs58Signature = bs58.encode(signature);

    return {signature: bs58Signature};
  } catch (e) {
    console.error('Error in sign solana message', e);
    return Promise.reject(e?.message);
  }
};

export function parseSolanaSignTransaction(txData) {
  // Default values for summary properties
  let sender = 'N/A';
  let data = 'N/A';

  try {
    if (!txData || typeof txData !== 'object') {
      throw new Error('Invalid transaction data provided');
    }
    sender = txData.feePayer || txData.pubkey || sender;
    data = txData?.transaction
      ? txData?.transaction
      : Array.isArray(txData?.transactions)
      ? JSON.stringify(txData?.transactions)
      : data;
  } catch (error) {
    console.error('Error parsing transaction:', error);
  }
  return {
    sender,
    data,
  };
}
