import {
  convertToSmallAmount,
  parseBalance,
  validateNumber,
} from 'dok-wallet-blockchain-networks/helper';
import {config, IS_SANDBOX} from 'dok-wallet-blockchain-networks/config/config';
const {
  Account,
  Ed25519PrivateKey,
  Aptos,
  AptosConfig,
  Network,
  AccountAddress,
} = require('@aptos-labs/ts-sdk');

const APT_COIN = '0x1::aptos_coin::AptosCoin';
export const AptosChain = () => {
  const aptosConfig = new AptosConfig({
    network: IS_SANDBOX ? Network.TESTNET : Network.MAINNET,
  });
  const aptosProvider = new Aptos(aptosConfig);

  const getAccountFromPrivateKey = privateKey => {
    const pk = new Ed25519PrivateKey(privateKey);
    return Account.fromPrivateKey({
      privateKey: pk,
      legacy: true,
    });
  };

  const prepareTransaction = async ({
    fromAddress,
    toAddress,
    amount,
    gasPrice,
    coinType,
    estimateGas,
  }) => {
    return aptosProvider.transferCoinTransaction({
      sender: fromAddress,
      recipient: toAddress,
      amount,
      coinType,
      options: {
        gasUnitPrice: gasPrice,
        maxGasAmount: estimateGas,
      },
    });
  };
  const calculateFee = async ({transaction, privateKey}) => {
    const account = getAccountFromPrivateKey(privateKey);
    const [userTransactionResponse] =
      await aptosProvider.transaction.simulate.simple({
        signerPublicKey: account.publicKey,
        transaction,
      });
    if (
      !userTransactionResponse?.success &&
      !userTransactionResponse?.vm_status?.includes('0x203ed')
    ) {
      throw new Error('Simulation is failed for aptos chain');
    }
    const gasPrice =
      validateNumber(userTransactionResponse?.gas_unit_price) || 0;
    const gasUsed = validateNumber(userTransactionResponse?.gas_used) || 0;
    if (!gasPrice || !gasUsed) {
      throw new Error('gas price or gas used is not valid');
    }
    return {
      gasPrice,
      gasUsed,
    };
  };
  return {
    isValidAddress: ({address}) => {
      try {
        return !!AccountAddress.fromStringStrict(address);
      } catch {
        return false;
      }
    },
    isValidPrivateKey: async ({privateKey}) => {
      try {
        return !!new Ed25519PrivateKey(privateKey);
      } catch (e) {
        return false;
      }
    },
    createWalletByPrivateKey: async ({privateKey}) => {
      const account = getAccountFromPrivateKey(privateKey);
      return {
        address: account?.accountAddress?.toString(),
        privateKey: privateKey,
      };
    },
    getBalance: async ({address}) => {
      try {
        const balance = await aptosProvider.getAccountAPTAmount({
          accountAddress: address,
        });
        return balance?.toString() || '0';
      } catch (e) {
        console.error('error in get balance from aptos', e);
        return '0';
      }
    },
    getTokenBalance: async ({address, contractAddress}) => {
      try {
        // Extract base address (before ::) for FA lookup
        const faAddress = contractAddress.split('::')[0];
        const balance = await aptosProvider.getBalance({
          accountAddress: address,
          asset: faAddress,
        });
        return balance?.toString() || '0';
      } catch (e) {
        console.error(`error getting token balance for aptos ${e}`);
        return '0';
      }
    },
    getEstimateFee: async ({toAddress, amount, privateKey, fromAddress}) => {
      try {
        const transaction = await prepareTransaction({
          fromAddress,
          toAddress,
          amount: convertToSmallAmount(amount, 8),
          coinType: APT_COIN,
        });
        const {gasPrice, gasUsed} = await calculateFee({
          transaction,
          privateKey,
        });
        return {
          fee: parseBalance((gasUsed * gasPrice).toString(), 8),
          estimateGas: gasUsed,
          gasFee: gasPrice,
        };
      } catch (e) {
        console.error('Error in aptos gas fee', e);
        throw e;
      }
    },
    getEstimateFeeForToken: async ({
      toAddress,
      amount,
      privateKey,
      fromAddress,
      contractAddress,
      decimals,
    }) => {
      try {
        const transaction = await prepareTransaction({
          fromAddress,
          toAddress,
          amount: convertToSmallAmount(amount, decimals),
          coinType: contractAddress,
        });

        const {gasPrice, gasUsed} = await calculateFee({
          transaction,
          privateKey,
        });

        return {
          fee: parseBalance((gasUsed * gasPrice).toString(), 8),
          estimateGas: gasUsed,
          gasFee: gasPrice,
        };
      } catch (e) {
        console.error('Error in aptos gas fee', e);
        throw e;
      }
    },
    getTransactions: async ({address}) => {
      try {
        const transactions = await aptosProvider.getAccountTransactions({
          accountAddress: address,
          options: {limit: 10},
        });
        if (!Array.isArray(transactions)) {
          return [];
        }
        const finalData = [];
        transactions.forEach(item => {
          if (item?.type !== 'user_transaction') {
            return;
          }
          const payload = item?.payload;
          const isTransfer =
            payload?.function === '0x1::coin::transfer' ||
            payload?.function === '0x1::aptos_account::transfer' ||
            payload?.function === '0x1::aptos_account::transfer_coins';
          if (!isTransfer) {
            return;
          }
          const txHash = item?.hash;
          const args = payload?.arguments || [];
          const toAddress = args[0];
          const amount = args[1];
          if (!amount) {
            return;
          }
          finalData.push({
            amount: amount?.toString(),
            link: txHash,
            url: `${config.APTOS_SCAN_URL}/txn/${txHash}${
              IS_SANDBOX ? '?network=testnet' : ''
            }`,
            status: item?.success ? 'SUCCESS' : 'Failed',
            date: Math.floor(Number(item?.timestamp) / 1000),
            from: item?.sender,
            to: toAddress,
            totalCourse: '0$',
          });
        });
        return finalData;
      } catch (e) {
        console.error(`error getting transactions for aptos ${e}`);
        return [];
      }
    },
    getTransaction: async ({txHash}) => {
      try {
        if (!txHash) {
          return null;
        }
        const item = await aptosProvider.getTransactionByHash({
          transactionHash: txHash,
        });
        if (!item || item?.type !== 'user_transaction') {
          return null;
        }
        const payload = item?.payload;
        const args = payload?.arguments || [];
        const toAddress = args[0];
        const amount = args[1];
        if (!amount) {
          return null;
        }
        return {
          data: {
            amount: amount?.toString(),
            link: txHash,
            url: `${config.APTOS_SCAN_URL}/txn/${txHash}${
              IS_SANDBOX ? '?network=testnet' : ''
            }`,
            status: item?.success ? 'SUCCESS' : 'Failed',
            date: Math.floor(Number(item?.timestamp) / 1000),
            from: item?.sender,
            to: toAddress,
            totalCourse: '0$',
          },
        };
      } catch (e) {
        console.error(`error getting transaction for aptos ${e}`);
        return null;
      }
    },
    getTokenTransactions: async () => {
      return [];
    },
    send: async ({to, from, amount, privateKey, estimateGas, gasFee}) => {
      try {
        const account = getAccountFromPrivateKey(privateKey);
        const transaction = await prepareTransaction({
          fromAddress: from,
          toAddress: to,
          amount: convertToSmallAmount(amount, 8),
          coinType: APT_COIN,
          gasPrice: gasFee,
          estimateGas,
        });

        const committedTransaction =
          await aptosProvider.signAndSubmitTransaction({
            signer: account,
            transaction,
          });
        return committedTransaction?.hash;
      } catch (e) {
        console.error('Error in send aptos transaction', e);
      }
    },
    sendToken: async ({
      from,
      contractAddress,
      to,
      amount,
      privateKey,
      decimal,
      gasFee,
      estimateGas,
    }) => {
      try {
        const account = getAccountFromPrivateKey(privateKey);
        const transaction = await prepareTransaction({
          fromAddress: from,
          toAddress: to,
          amount: convertToSmallAmount(amount, decimal),
          coinType: contractAddress,
          gasPrice: gasFee,
          estimateGas,
        });
        const committedTransaction =
          await aptosProvider.signAndSubmitTransaction({
            signer: account,
            transaction,
          });
        return committedTransaction?.hash;
      } catch (e) {
        console.error('Error in send aptos token transaction', e);
      }
    },
    waitForConfirmation: async ({transaction}) => {
      return aptosProvider.waitForTransaction({
        transactionHash: transaction,
        options: {
          checkSuccess: true,
          timeoutSecs: 120,
        },
      });
    },
  };
};
