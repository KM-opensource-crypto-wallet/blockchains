import {
  BlockfrostProvider,
  DEFAULT_PROTOCOL_PARAMETERS,
  MeshWallet,
  Transaction,
} from '@meshsdk/core';
import {config} from 'dok-wallet-blockchain-networks/config/config';
import {
  convertToSmallAmount,
  parseBalance,
} from 'dok-wallet-blockchain-networks/helper';
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
        const fee = await buildTransaction({
          from: fromAddress,
          wallet,
          amount,
          to: toAddress,
        });
        const finalFee = fee + 0n;
        return {
          fee: parseBalance(finalFee.toString(), 6),
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
    send: async ({from, to, amount, phrase, transactionFee}) => {
      try {
        const wallet = await recall({
          type: 'mnemonic',
          words: phrase.split(' '),
        });
        const unsignedTx = await buildTransaction({
          wallet,
          from,
          amount,
          transactionFee,
          to,
        });
        const signedTx = await wallet.signTx(unsignedTx);
        // Submit the transaction
        return await wallet.submitTx(signedTx);
      } catch (e) {
        console.error('Error in send cardano transaction', e);
      }
    },
    sendToken: () => {
      return null;
    },
    waitForConfirmation: async ({transaction}) => {
      return new Promise(resolve => {
        provider.onTxConfirmed(transaction, () => {
          resolve(true);
        });
        setTimeout(() => {
          resolve('pending');
        }, 90000); // 90 seconds
      });
    },
  };
};

const buildTransaction = async ({wallet, from, to, amount, transactionFee}) => {
  if (!from) {
    throw new Error('Could not get sender address');
  }
  const utxos = await wallet.getUtxos();
  if (!utxos || utxos.length === 0) {
    throw new Error('No UTXOs available in sender wallet');
  }

  // Calculate total available Lovelace
  const totalAvailableLovelace = utxos.reduce((sum, utxo) => {
    const amounts = utxo.output.amount;
    let totalLoveLaceAmount = 0n;
    for (let i = 0; i < amounts.length; i++) {
      const asset = amounts[i];
      if (asset.unit === 'lovelace') {
        totalLoveLaceAmount += BigInt(asset.quantity);
      }
    }
    return sum + totalLoveLaceAmount;
  }, BigInt(0));
  // Convert input amounts to BigInt for precise calculations
  const amountToSend = BigInt(convertToSmallAmount(amount, 6));
  let fee = 0n;
  if (transactionFee) {
    fee = BigInt(convertToSmallAmount(transactionFee, 6));
  }
  const totalNeeded = amountToSend + fee;

  // Check if there's enough Lovelace
  if (totalAvailableLovelace < totalNeeded) {
    throw new Error(
      `Insufficient funds. Available: ${totalAvailableLovelace.toString()} Lovelace, ` +
        `Required: ${totalNeeded.toString()} Lovelace (including fee)`,
    );
  }

  // Calculate change amount
  const changeAmount = totalAvailableLovelace - totalNeeded;

  // Build transaction
  let tx = new Transaction({initiator: wallet});
  tx.txBuilder.reset();
  tx.setTxInputs(utxos);

  // Add recipient output
  tx.txBuilder.txOut(to, [
    {unit: 'lovelace', quantity: amountToSend.toString()},
  ]);

  // Add change output if there's any change to return
  if (changeAmount > 0) {
    tx.txBuilder.txOut(from, [
      {unit: 'lovelace', quantity: changeAmount.toString()},
    ]);
  }
  if (fee > 0) {
    tx.txBuilder.setFee(fee.toString());
  } else {
    tx.txBuilder.setFee(DEFAULT_PROTOCOL_PARAMETERS.minFeeB);
  }

  // Build and sign the transaction
  const unsignedTx = await tx.build(false);
  if (transactionFee) {
    return unsignedTx;
  }
  return tx.txBuilder.calculateFee();
};
