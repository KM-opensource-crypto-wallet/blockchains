import {BlockfrostProvider, MeshWallet, Transaction} from '@meshsdk/core';
import {config} from 'dok-wallet-blockchain-networks/config/config';
import {parseBalance} from 'dok-wallet-blockchain-networks/helper';
import {CardanoChainService} from 'dok-wallet-blockchain-networks/service/cardanoChain';

const provider = new BlockfrostProvider(config.BLOCKFROST_API_KEY);

export const CardanoChain = () => {
  const recall = async key => {
    const wallet = new MeshWallet({
      key,
      networkId: 1,
      fetcher: provider,
      submitter: provider,
    });
    await wallet.init();
    return wallet;
  };

  return {
    isValidAddress: ({address}) => {
      return /^addr1[0-9a-z]{58,}$/.test(address);
    },
    getBalance: async ({address}) => {
      try {
        const resp = await CardanoChainService.getCardanoBalance(address);
        return resp.data;
      } catch (e) {
        console.error('error in get balance from cardano', e);
        return '0';
      }
    },
    getTokenBalance: () => {
      return '0';
    },
    getEstimateFee: async ({toAddress, amount, fromAddress}) => {
      try {
        const wallet = await recall({type: 'address', address: fromAddress});
        const tx = new Transaction({initiator: wallet}).sendLovelace(
          toAddress,
          amount * 1e6,
        );
        const fee = tx.txBuilder.calculateFee();
        return {
          fee: parseBalance(fee.toString(), 6),
          estimateGas: 0,
          gasFee: 0,
        };
      } catch (e) {
        console.error('Error in cardano gas fee', e);
        throw e;
      }
    },
    getEstimateFeeForToken: async () => {
      return null;
    },
    getTransactions: async ({address}) => {
      try {
        const transactions = await CardanoChainService.getCardanoTransactions(
          address,
        );

        if (Array.isArray(transactions)) {
          return transactions.map(item => {
            const txHash = item?.txHash;
            return {
              amount: item?.amount?.toString(),
              link: txHash.substring(0, 13) + '...',
              url: `${config.CARDANO_SCAN_URL}/transaction/${txHash}`,
              status: 'SUCCESS',
              date: new Date(item.timestamp),
              from: item?.from,
              to: item?.to,
              totalCourse: '0$',
            };
          });
        }
        return [];
      } catch (e) {
        console.error('error in get balance from cardano', e);
        return [];
      }
    },
    getTokenTransactions: async () => {
      return [];
    },
    send: async ({to, amount, phrase}) => {
      try {
        const wallet = await recall({
          type: 'mnemonic',
          words: phrase.split(' '),
        });

        const tx = new Transaction({
          initiator: wallet,
          fetcher: provider,
          submitter: provider,
        });
        tx.sendLovelace(to, (amount * 1e6).toString());

        const unsignedTx = await tx.build();
        const signedTx = await wallet.signTx(unsignedTx, true);
        const txHash = await wallet.submitTx(signedTx);
        return txHash;
      } catch (e) {
        console.error('Error in send cardano transaction', e);
      }
    },
    sendToken: () => {
      return null;
    },
    waitForConfirmation: () => {
      return null;
    },
  };
};
