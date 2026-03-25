import {assetAmount, assetToBase} from '@xchainjs/xchain-util';
import {decode} from 'bech32-buffer';
import {ThorChainService} from 'dok-wallet-blockchain-networks/service/thorChain';
import {parseBalance} from 'dok-wallet-blockchain-networks/helper';
import {config} from 'dok-wallet-blockchain-networks/config/config';
import {WL_APP_NAME} from 'utils/wlData';

export const ThorChain = () => {
  return {
    isValidAddress: ({address}) => {
      return decode(address).prefix === 'thor';
    },
    getBalance: async ({address}) => {
      try {
        const resp = await ThorChainService.getThorBalance(address);
        return resp?.data.toString();
      } catch (e) {
        console.error('error in get balance from ThorChain', e);
        return '0';
      }
    },

    getEstimateFee: async () => {
      try {
        const fee = await ThorChainService.getBaseThorFee();
        const parseFee = parseBalance(fee, 8);
        return {
          fee: parseFee?.toString(),
        };
      } catch (e) {
        console.error('Error in thor gas fee', e);
        throw e;
      }
    },
    send: async ({to, amount, phrase, memo}) => {
      return new Promise((resolve, reject) => {
        setTimeout(async () => {
          try {
            const {
              AssetRuneNative,
              Client,
            } = require('@xchainjs/xchain-thorchain');
            const {
              DirectSecp256k1HdWallet,
              encodePubkey,
              makeAuthInfoBytes,
              makeSignDoc,
            } = require('@cosmjs/proto-signing');
            const {encodeSecp256k1Pubkey} = require('@cosmjs/amino');
            const {TxRaw} = require('cosmjs-types/cosmos/tx/v1beta1/tx');
            const {fromBase64, toBase64} = require('@cosmjs/encoding');
            const {makeClientPath} = require('@xchainjs/xchain-cosmos-sdk');

            const thorClient = new Client({phrase});
            const sender = thorClient.getAddress(0);
            const finalAmount = assetToBase(assetAmount(amount, 8));
            const txMemo = memo || `transfer from ${WL_APP_NAME}`;

            // Build tx body locally — no network needed
            const {rawUnsignedTx} = await thorClient.prepareTx({
              sender,
              recipient: to,
              asset: AssetRuneNative,
              amount: finalAmount,
              memo: txMemo,
            });
            const decodedRaw = TxRaw.decode(fromBase64(rawUnsignedTx));

            const {accountNumber, sequence} =
              await ThorChainService.getAccountInfo(sender);

            // Sign locally
            const signer = await DirectSecp256k1HdWallet.fromMnemonic(phrase, {
              prefix: 'thor',
              hdPaths: [makeClientPath("m/44'/931'/0'/0/0")],
            });
            const [signerAccount] = await signer.getAccounts();

            const pubkey = encodePubkey(
              encodeSecp256k1Pubkey(signerAccount.pubkey),
            );
            const authInfoBytes = makeAuthInfoBytes(
              [{pubkey, sequence}],
              [],
              6000000,
            );
            const signDoc = makeSignDoc(
              decodedRaw.bodyBytes,
              authInfoBytes,
              'thorchain-1',
              accountNumber,
            );
            const {signature} = await signer.signDirect(sender, signDoc);

            const txRaw = TxRaw.fromPartial({
              bodyBytes: decodedRaw.bodyBytes,
              authInfoBytes,
              signatures: [fromBase64(signature.signature)],
            });

            const txHash = await ThorChainService.broadcastTx(
              TxRaw.encode(txRaw).finish(),
            );

            resolve(txHash);
          } catch (e) {
            console.error('Error in send ThorChain transaction', e?.message);
            reject(e);
          }
        }, 600);
      });
    },

    getTransactions: async ({address}) => {
      try {
        const transactions = await ThorChainService.getThorTransactions(
          address,
        );
        return transactions.map(item => {
          const bnValue = BigInt(item?.amount);
          const txHash = item?.txhash;
          return {
            amount: bnValue.toString(),
            link: txHash,
            url: `${config.THORCHAIN_SCAN_URL}/tx/${txHash}`,
            status: 'SUCCESS',
            date: item?.timestamp, //new Date(transaction.raw_data.timestamp),
            from: item?.from,
            to: item?.to,
            totalCourse: '0$',
          };
        });
      } catch (e) {
        console.error('error getting transactions for ThorChain', e);
        return [];
      }
    },
    getTransaction: async ({txHash}) => {
      try {
        const transaction = await ThorChainService.getThorTransaction(txHash);
        if (transaction) {
          return {
            data: {
              amount: transaction.amount?.toString() || '0',
              link: txHash,
              url: `${config.THORCHAIN_SCAN_URL}/tx/${txHash}`,
              status: 'SUCCESS',
              date: transaction?.timestamp, //new Date(transaction.raw_data.timestamp),
              from: transaction?.from,
              to: transaction?.to,
              totalCourse: '0$',
            },
          };
        }
        return null;
      } catch (e) {
        console.error('error getting transactions for ThorChain', e);
        return null;
      }
    },

    waitForConfirmation: async ({
      transaction,
      interval = 3000,
      retries = 5,
    }) => {
      const transactionID = transaction;
      if (!transactionID) {
        console.error('No transaction id found for thorchain');
        return null;
      }
      return new Promise((resolve, reject) => {
        let numberOfRetries = 0;
        let timer = setInterval(async () => {
          try {
            numberOfRetries += 1;
            const response = await ThorChainService.getTransactionStatus(
              transactionID,
            );
            if (response) {
              clearInterval(timer);
              resolve(response);
            } else if (numberOfRetries === retries) {
              clearInterval(timer);
              resolve('pending');
            }
          } catch (e) {
            clearInterval(timer);
            console.error('Error in get tranaction', e);
            reject(e);
          }
        }, interval);
      });
    },
  };
};
