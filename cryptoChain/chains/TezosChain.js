import {TezosToolkit} from '@taquito/taquito';
import {validateAddress, ValidationResult} from '@taquito/utils';
import {InMemorySigner} from '@taquito/signer';
import {ethers} from 'ethers';
import BigNumber from 'bignumber.js';
import {Tzkt} from 'dok-wallet-blockchain-networks/service/tzkt';
import {config} from 'dok-wallet-blockchain-networks/config/config';
import {getRPCUrl} from 'dok-wallet-blockchain-networks/rpcUrls/rpcUrls';

export const TezosChain = () => {
  const tezosProvider = new TezosToolkit(getRPCUrl('tezos'));
  return {
    isValidAddress: ({address}) => {
      try {
        return validateAddress(address) === ValidationResult.VALID;
      } catch (e) {
        console.error('Error in isValidPrivateKey', e);
        return false;
      }
    },
    isValidPrivateKey: ({privateKey}) => {
      return /^edsk[1-9A-HJ-NP-Za-km-z]{50}/.test(privateKey);
    },
    getBalance: async ({address}) => {
      try {
        const resp = await tezosProvider.tz.getBalance(address);
        return resp?.toString();
      } catch (e) {
        console.error('error in get balance from tezos', e);
        return '0';
      }
    },
    getEstimateFee: async ({toAddress, amount, privateKey}) => {
      try {
        const signer = await getSignerConfigure(privateKey);
        const bnAmount = new BigNumber(amount);
        let finalAmount = bnAmount.gt(new BigNumber(1))
          ? bnAmount.minus(new BigNumber(1)).toString()
          : amount;
        tezosProvider.setProvider({signer: signer});
        const estimate = await tezosProvider.estimate.transfer({
          to: toAddress,
          amount: finalAmount,
        });
        const finalFee = Math.max(
          estimate?.suggestedFeeMutez,
          estimate?.totalCost,
        );
        const fees = ethers.formatUnits(finalFee, 6) || '0';

        return {
          fee: fees,
        };
      } catch (e) {
        console.error('Error in tezos gas fee', e);
        throw e;
      }
    },
    send: async ({to, amount, privateKey}) => {
      try {
        const signer = await getSignerConfigure(privateKey);
        tezosProvider.setProvider({signer: signer});
        return await tezosProvider.wallet
          .transfer({
            to: to,
            amount,
          })
          .send();
      } catch (e) {
        console.error('Error in send on Tezos chain', e);
      }
    },

    getTransactions: async ({address}) => {
      try {
        const resp = await Tzkt.getTezosTransactions(address);
        return resp?.data.map(item => {
          const bnValue = BigInt(item?.amount);
          const txHash = item?.hash;
          return {
            amount: bnValue.toString(),
            link: txHash.substring(0, 13) + '...',
            url: `${config.TEZOS_SCAN_URL}/${txHash}`,
            status: item?.status === 'applied' ? 'SUCCESS' : 'Pending',
            date: item?.timestamp, //new Date(transaction.raw_data.timestamp),
            from: item?.sender?.address,
            to: item?.target?.address,
            totalCourse: '0$',
          };
        });
      } catch (e) {
        console.error('error getting transactions for tezos', e);
        return [];
      }
    },
    createWalletByPrivateKey: async ({privateKey}) => {
      const signer = await getSignerConfigure(privateKey);
      return {
        address: await signer.publicKeyHash(),
        privateKey: await signer.secretKey(),
      };
    },

    waitForConfirmation: async ({
      transaction,
      interval = 5000,
      retries = 15,
    }) => {
      try {
        if (!transaction?.status) {
          console.error('No transaction id found for tezoschain');
          return null;
        }
        return new Promise((resolve, reject) => {
          let numberOfRetries = 0;
          let timer = setInterval(async () => {
            try {
              numberOfRetries += 1;
              const status = await transaction?.status();
              if (status?.toString() === 'applied') {
                clearInterval(timer);
                resolve(true);
              } else if (numberOfRetries === retries) {
                clearInterval(timer);
                resolve('pending');
              }
            } catch (e) {
              clearInterval(timer);
              console.error('Error in get transaction status', e);
              reject(e);
            }
          }, interval);
        });
      } catch (e) {
        return true;
      }
    },
  };
};

const getSignerConfigure = privateKey => {
  return InMemorySigner.fromSecretKey(privateKey);
};
