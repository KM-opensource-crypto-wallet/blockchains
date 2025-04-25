import {config, IS_SANDBOX} from 'dok-wallet-blockchain-networks/config/config';
import {ethers} from 'ethers';
import {createWallet} from 'myWallet/wallet.service';
import {HEDERA} from 'dok-wallet-blockchain-networks/service/Hedera';

import {
  AccountCreateTransaction,
  AccountId,
  Client,
  PrivateKey,
  TransactionReceiptQuery,
  TransferTransaction,
  Status,
} from '@hashgraph/sdk';

const operatorId = IS_SANDBOX ? '0.0.4461973' : '0.0.6247426';
const operatorKey =
  '84a12efd44ed44978e619010933fe05541158377aa93924804d4a832f52f10e8';

const MAX_HBAR_TRANSFER = 0.0021;

let client;
const getClient = () => {
  try {
    if (client) {
      return client;
    }
    client = IS_SANDBOX ? Client.forTestnet() : Client.forMainnet();
    client = client.setOperator(
      operatorId,
      PrivateKey.fromStringECDSA(operatorKey),
    );
    return client;
  } catch (e) {
    console.error('error in client and providers', e);
    throw e;
  }
};

const getNewClient = (localOperatorId, localPrivateKey) => {
  try {
    let tempClient = IS_SANDBOX ? Client.forTestnet() : Client.forMainnet();
    tempClient = client.setOperator(
      localOperatorId,
      PrivateKey.fromStringECDSA(localPrivateKey),
    );
    return tempClient;
  } catch (e) {
    console.error('error in client', e);
    throw e;
  }
};
export const HederaChain = () => {
  const hederaClient = getClient();

  const isAccountExists = async address => {
    try {
      const resp = await HEDERA.getAccountInfo(address);
      return resp?.data?.account;
    } catch (e) {
      return null;
    }
  };

  const createOrGetAccount = async (address, privateKey) => {
    let accountId = await isAccountExists(address);
    if (!accountId) {
      const accountPrivateKey = PrivateKey.fromStringECDSA(privateKey);
      const accountCreateTxResponse = await new AccountCreateTransaction()
        .setKey(accountPrivateKey)
        .setAlias(address)
        .freezeWith(hederaClient)
        .execute(hederaClient);
      const receipt = await new TransactionReceiptQuery()
        .setTransactionId(accountCreateTxResponse.transactionId)
        .execute(hederaClient);
      accountId = receipt.accountId?.toString();
    }
    if (!accountId) {
      throw new Error('No accountId found');
    }
    return {
      address: accountId,
      privateKey: privateKey,
    };
  };
  return {
    isValidAddress: ({address}) => {
      try {
        return !!AccountId.fromString(address).toString();
      } catch {
        return false;
      }
    },
    isValidPrivateKey: async ({privateKey}) => {
      try {
        const wallet = new ethers.Wallet(privateKey);
        return !!wallet?.address;
      } catch (e) {
        return false;
      }
    },
    getOrCreateHederaWallet: async ({mnemonic}) => {
      try {
        const etherWallet = await createWallet('ethereum', mnemonic, false);
        return await createOrGetAccount(
          etherWallet?.address,
          etherWallet?.privateKey,
        );
      } catch (e) {
        console.error('Error in create hedera wallet', e);
        throw e;
      }
    },
    createWalletByPrivateKey: async ({privateKey}) => {
      try {
        const wallet = new ethers.Wallet(privateKey);
        return await createOrGetAccount(wallet?.address, wallet?.privateKey);
      } catch (e) {
        console.error('Error in create hedera wallet by private key', e);
        throw e;
      }
    },
    getBalance: async ({address}) => {
      try {
        const resp = await HEDERA.getAccountInfo(address);
        return resp?.data?.balance?.balance?.toString() || '0';
      } catch (e) {
        console.error('error in get balance from hedera', e);
        return '0';
      }
    },

    getEstimateFee: async () => {
      try {
        const resp = await HEDERA.getExchangeFee();
        const currentRate = resp?.data?.current_rate;
        const centEquivalent = currentRate?.cent_equivalent;
        const hbarEquivalent = currentRate?.hbar_equivalent;
        const hbarToDollar = centEquivalent / hbarEquivalent / 100;
        const hbar = MAX_HBAR_TRANSFER / hbarToDollar;
        return {
          fee: hbar.toFixed(8),
          transactionFee: hbar.toFixed(8),
        };
      } catch (e) {
        console.error('Error in hedera gas fee', e);
        throw e;
      }
    },

    getTransactions: async ({address}) => {
      try {
        const resp = await HEDERA?.getTransactions(address);
        if (Array.isArray(resp?.data)) {
          return resp?.data.map(item => {
            const date = item?.consensus_timestamp?.substring(
              0,
              item?.consensus_timestamp?.indexOf('.'),
            );
            const chargeTransactionFees = item?.charged_tx_fee;
            let from = null;
            let amount = null;
            let to = null;
            for (let i = 0; i < item?.transfers.length; i++) {
              const transfer = item?.transfers[i];
              if (transfer?.account === address && transfer?.amount < 0) {
                from = transfer?.account;
                amount = (
                  Math.abs(transfer?.amount) - chargeTransactionFees
                ).toString();
              } else if (
                transfer?.account === address &&
                transfer?.amount > 0
              ) {
                to = transfer?.account;
                amount = transfer?.amount?.toString();
              }
            }
            if (!from) {
              from = item?.transfers?.find(
                subItem =>
                  subItem?.account !== to && subItem?.amount === amount,
              )?.account;
            } else if (!to) {
              to = item?.transfers?.find(
                subItem =>
                  subItem?.account !== from && subItem?.amount === amount,
              )?.account;
            }
            const txHash = item?.transaction_id;
            return {
              amount: amount,
              link: txHash.substring(0, 13) + '...',
              url: `${config.HEDERA_SCAN_URL}/transaction/${txHash}`,
              status: item?.result === 'SUCCESS' ? 'SUCCESS' : 'FAIL',
              date: date * 1000, //new Date(transaction.raw_data.timestamp),
              from: from,
              to: to,
              totalCourse: '0$',
            };
          });
        }
        return [];
      } catch (e) {
        console.error(`error getting transactions for hedera ${e}`);
        return [];
      }
    },

    send: async ({to, from, amount, privateKey, memo, transactionFee}) => {
      try {
        const tempClient = getNewClient(from, privateKey);
        return await new TransferTransaction()
          .addHbarTransfer(from, -Number(amount))
          .addHbarTransfer(to, amount)
          .setMaxTransactionFee(transactionFee)
          .setTransactionMemo(memo?.toString() || '')
          .execute(tempClient);
      } catch (e) {
        console.error('Error in send hedera transaction', e);
      }
    },
    waitForConfirmation: async ({transaction}) => {
      try {
        const receipt = await transaction.getReceipt(client);
        if (receipt.status === Status.Success) {
          return transaction;
        }
        console.error('Transaction status', receipt?.status);
        throw new Error('Transaction failed');
      } catch (e) {
        console.error('error in wait for transaction', e);
        throw e;
      }
    },
  };
};
