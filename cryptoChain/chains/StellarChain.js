import 'tweetnacl';
import * as StellarSdk from '@stellar/stellar-sdk';
import {Memo, StrKey} from '@stellar/stellar-sdk';
import {config} from 'dok-wallet-blockchain-networks/config/config';
import BigNumber from 'bignumber.js';
import StellarHDWallet from 'stellar-hd-wallet';
import axios from 'axios';
import qs from 'qs';
import {getRPCUrl} from 'dok-wallet-blockchain-networks/rpcUrls/rpcUrls';
import {isValidStringWithValue} from 'dok-wallet-blockchain-networks/helper';

export const StellarChain = () => {
  let stellarProvider;
  try {
    stellarProvider = new StellarSdk.Horizon.Server(getRPCUrl('stellar'));
  } catch (e) {
    console.error(`error creating StellarChain ${e}`);
    throw e;
  }
  return {
    isValidAddress: ({address}) => {
      return StrKey.isValidEd25519PublicKey(address);
    },
    isValidPrivateKey: ({privateKey}) => {
      try {
        return StrKey.isValidEd25519SecretSeed(privateKey);
      } catch (e) {
        return false;
      }
    },
    createStellarWallet: ({mnemonic}) => {
      const wallet = StellarHDWallet.fromMnemonic(mnemonic);
      return {
        address: wallet.getPublicKey(0),
        privateKey: wallet.getSecret(0),
      };
    },
    createWalletByPrivateKey: ({privateKey}) => {
      const wallet = StellarSdk.Keypair.fromSecret(privateKey);
      return {
        address: wallet.publicKey(),
        privateKey: privateKey,
      };
    },
    getBalance: async ({address}) => {
      try {
        const account = await stellarProvider.loadAccount(address);
        const balances = account.balances;
        const nativeBalance = balances.find(
          item => item.asset_type === 'native',
        )?.balance;
        if (!nativeBalance) {
          return '0';
        }
        return new BigNumber(nativeBalance)
          .multipliedBy(new BigNumber(10000000))
          .toString();
      } catch (e) {
        console.error('error in get balance from stellar', e);
        return '0';
      }
    },
    getEstimateFeeForToken: async ({toAddress, contractAddress, symbol}) => {
      try {
        const receiver = await stellarProvider.loadAccount(toAddress);
        const fee = await stellarProvider.fetchBaseFee();
        const balances = receiver.balances;
        const assetData = balances.find(
          item =>
            item.asset_issuer === contractAddress && item.asset_code === symbol,
        );
        if (assetData && assetData?.is_authorized === false) {
          throw Error('You are not authorized');
        }
        const finalFee = assetData
          ? new BigNumber(fee).dividedBy(10000000).toString()
          : new BigNumber(fee).multipliedBy(2).dividedBy(10000000).toString();
        return {
          fee: finalFee,
        };
      } catch (e) {
        console.error('error in get token fees for stellar', e);
        throw e;
      }
    },
    getEstimateFee: async () => {
      try {
        const fee = await stellarProvider.fetchBaseFee();
        return {
          fee: new BigNumber(fee).dividedBy(10000000).toString(),
        };
      } catch (e) {
        console.error('Error in gas fee for stellar', e);
        throw e;
      }
    },
    getTransactions: async ({address}) => {
      try {
        const transaction = await stellarProvider
          .transactions()
          .forAccount(address)
          .limit(20)
          .order('desc')
          .call();
        const records = transaction?.records;
        const allTransactionsOperations = records.map(item =>
          stellarProvider.operations().forTransaction(item.id).call(),
        );
        const allOperations = await Promise.all(allTransactionsOperations);
        if (Array.isArray(records)) {
          return records.map((item, index) => {
            const foundOperation = allOperations[index].records.find(
              operation => {
                const sender = operation?.from || operation?.source_account;
                const receiver = operation?.to || operation?.account;
                const type = operation?.type;
                return (
                  (type === 'create_account' || type === 'payment') &&
                  (address === sender || address === receiver)
                );
              },
            );
            const sender =
              foundOperation?.from || foundOperation?.source_account;
            const receiver = foundOperation?.to || foundOperation?.account;
            const amount =
              foundOperation?.amount || foundOperation?.starting_balance || '0';
            const txHash = item?.id;
            return {
              amount: new BigNumber(amount)
                .multipliedBy(new BigNumber(10000000))
                .toString(),
              link: txHash.substring(0, 13) + '...',
              url: `${config.STELLAR_SCAN_URL}/transactions/${txHash}`,
              status: item?.successful ? 'SUCCESS' : 'FAIL',
              date: item?.created_at, //new Date(transaction.raw_data.timestamp),
              from: sender,
              to: receiver,
              totalCourse: '0$',
            };
          });
        }
        return [];
      } catch (e) {
        console.error(`error getting transactions for stellar ${e}`);
        return [];
      }
    },
    send: async ({to, from, amount, privateKey, memo}) => {
      try {
        const fee = await stellarProvider.fetchBaseFee();
        const sourceKeypair = StellarSdk.Keypair.fromSecret(privateKey);
        const sourceAccount = await stellarProvider.loadAccount(from);
        const isExist = await StellarChain().checkUserExistOrNot(to);
        const transaction = new StellarSdk.TransactionBuilder(sourceAccount, {
          fee,
          networkPassphrase: config.STELLAR_NETWORK,
        })
          // Add a payment operation to the transaction
          .addOperation(
            isExist
              ? StellarSdk.Operation.payment({
                  destination: to,
                  asset: StellarSdk.Asset.native(),
                  amount: amount?.toString(),
                })
              : StellarSdk.Operation.createAccount({
                  destination: to,
                  startingBalance: amount?.toString(),
                }),
          )
          .addMemo(isValidStringWithValue(memo) ? Memo.text(memo) : Memo.none())
          .setTimeout(30)
          .build();
        transaction.sign(sourceKeypair);
        const bufferArray = transaction.toEnvelope().v1().toXDR('raw');
        // here it was not return proper buffer it is return array
        const uint8Array = new Uint8Array(bufferArray);
        // eslint-disable-next-line no-undef
        const finalBuffer = Buffer.from(uint8Array);
        const base64Str = finalBuffer.toString('base64');
        const transactionResult = await axios.post(
          `${getRPCUrl('stellar')}/transactions`,
          qs.stringify({tx: base64Str}),
          {
            headers: {
              'Content-Type': 'application/x-www-form-urlencoded',
            },
          },
        );
        return transactionResult?.data?.id;
      } catch (e) {
        console.error('Error in send stellar transaction', e);
        console.error('Error in send stellar transactions', e.stack);
        console.error('Error in send stellar transactions', JSON.stringify(e));
      }
    },

    waitForConfirmation: async ({transaction}) => {
      return true;
    },
    checkUserExistOrNot: async address => {
      try {
        return await stellarProvider.loadAccount(address);
      } catch (e) {
        console.error('Error account not exist.So creating new account');
        return false;
      }
    },
  };
};
