import { assetAmount, assetToBase } from '@xchainjs/xchain-util';
import { decode } from 'bech32-buffer';
import { ThorChainService } from 'dok-wallet-blockchain-networks/service/thorChain';
import { parseBalance } from 'dok-wallet-blockchain-networks/helper';
import { config } from 'dok-wallet-blockchain-networks/config/config';
// import {WL_APP_NAME} from '../../../src/utils/wlData';
import { WL_APP_NAME } from '../../../src/utils/wlData';

export const ThorChain = () => {
  return {
    isValidAddress: ({ address }) => {
      return decode(address).prefix === 'thor';
    },
    getBalance: async ({ address }) => {
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
    send: async ({ to, amount, phrase, memo }) => {
      return new Promise((resolve, reject) => {
        setTimeout(async () => {
          try {
            const {
              AssetRuneNative,
              Client,
            } = require('@xchainjs/xchain-thorchain');
            const thorClient = new Client({ phrase });
            const finalAmount = assetToBase(assetAmount(amount, 8));
            const txid = await thorClient.transfer({
              amount: finalAmount,
              recipient: to,
              memo: memo || `transfer from ${WL_APP_NAME}`,
              asset: AssetRuneNative,
            });
            resolve(txid);
          } catch (e) {
            console.error('Error in send ThorChain transaction', e);
            reject(e);
          }
        }, 600);
      });
    },

    getTransactions: async ({ address }) => {
      try {
        const transactions = await ThorChainService.getThorTransactions(
          address,
        );
        return transactions.map(item => {
          const bnValue = BigInt(item?.amount);
          const txHash = item?.txhash;
          return {
            amount: bnValue.toString(),
            link: txHash.substring(0, 13) + '...',
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
