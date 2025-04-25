import {BlockChairAPI} from 'dok-wallet-blockchain-networks/config/blockChair';
import BigNumber from 'bignumber.js';

const chainName = {
  btc: 'bitcoin',
  bch: 'bitcoin-cash',
  doge: 'dogecoin',
  ltc: 'litecoin',
};

export const BlockChair = {
  getBalance: async ({chain, address}) => {
    const resp = await BlockChairAPI.get(
      `${chainName[chain]}/dashboards/address/${address}`,
      {
        params: {
          limit: '0,0',
        },
      },
    );
    return resp?.data?.data?.[address]?.address?.balance;
  },

  getTransactions: async ({chain, address}) => {
    const resp = await BlockChairAPI.get(
      `${chainName[chain]}/dashboards/address/${address}`,
      {
        params: {
          limit: '10,0',
        },
      },
    );
    const txIds = resp?.data?.data?.[address]?.transactions;
    const transactionResp = await BlockChairAPI.get(
      `${chainName[chain]}/dashboards/transactions/${txIds.join(',')}`,
    );
    const transactionsData = transactionResp?.data?.data || {};
    const txs = Object.values(transactionsData);
    return txs?.map(item => {
      const inputs = item?.inputs;
      const fromAddress = inputs[0]?.recipient;
      const isSender = fromAddress?.toLowerCase() === address?.toLowerCase();
      let totalAmount = new BigNumber(0);
      const transaction = item?.transaction;
      const txHash = transaction?.hash;
      const vOut = item?.outputs;
      vOut.forEach(tr => {
        const recipientLower = tr?.recipient?.toLowerCase();
        const addressLower = address?.toLowerCase();
        if (
          (isSender && recipientLower !== addressLower) ||
          (!isSender && recipientLower === addressLower)
        ) {
          const amount = new BigNumber(tr?.value || 0);
          totalAmount = totalAmount.plus(amount);
        }
      });
      if (isSender) {
        const fees = new BigNumber(transaction?.fee || 0);
        totalAmount = totalAmount.plus(fees);
      }
      return {
        amount: totalAmount.toString(),
        hash: txHash,
        status: transaction?.block_id && transaction?.block_id !== -1,
        timestamp: new Date(transaction?.time), //new Date(transaction.raw_data.timestamp),
        from: fromAddress,
        to: vOut.find(tx => {
          const recipientLower = tx?.recipient?.toLowerCase();
          const addressLower = address?.toLowerCase();
          if (isSender) {
            return recipientLower !== addressLower;
          } else {
            return recipientLower === addressLower;
          }
        })?.recipient,
      };
    });
  },

  getUTXO: async ({chain, address}) => {
    const resp = await BlockChairAPI.get(
      `${chainName[chain]}/dashboards/address/${address}`,
      {
        params: {
          limit: '0,100',
        },
      },
    );
    const utxos = resp?.data?.data?.[address]?.utxo;
    const data = Array.isArray(utxos) ? utxos : [];
    return data.map(item => ({
      hash: item?.transaction_hash,
      value: item?.value,
      vout: item?.index,
    }));
  },
  fetchTransactionDetails: async ({chain, transactionData}) => {
    try {
      const txIds = transactionData
        .reduce((accumulator, current, index) => {
          const chunkIndex = Math.floor(index / 10); // Determine the chunk

          // If this is the start of a new chunk, initialize it
          if (!accumulator[chunkIndex]) {
            accumulator[chunkIndex] = [];
          }

          // Add the current field value to the current chunk
          accumulator[chunkIndex].push(current.txid);
          return accumulator;
        }, [])
        // Convert each chunk (array of field values) to a single string
        .map(chunk => chunk.join(','));
      const resp = await Promise.all(
        txIds.map(item =>
          BlockChairAPI.get(
            `${chainName[chain]}/dashboards/transactions/${item}`,
          ),
        ),
      );
      const finalTransactionsArray = [].concat(
        ...resp.map(item => {
          const transactionsData = item?.data?.data || {};
          return Object.values(transactionsData);
        }),
      );

      let finalData = [];
      let needToFetchTransactionHash = [];
      finalTransactionsArray.forEach((item, index) => {
        const previousData = transactionData[index];
        const txid = previousData.txid;
        const value = previousData.value;
        const vout = item.outputs;
        const foundVout = vout.filter(
          subItem =>
            subItem.value === value &&
            subItem.recipient?.toLowerCase() ===
              previousData.fromAddress?.toLowerCase(),
        );
        foundVout.forEach(subItem => {
          if (subItem?.type?.includes('witness')) {
            finalData.push({
              txid,
              value,
              scriptpubkey: subItem.script_hex,
              vout: previousData.vout,
            });
          } else {
            needToFetchTransactionHash.push(previousData);
          }
        });
      });
      if (needToFetchTransactionHash.length) {
        const transacionHashResp = await Promise.all(
          needToFetchTransactionHash.map(item =>
            BlockChairAPI.get(
              `${chainName[chain]}/raw/transaction/${item?.txid}`,
            ),
          ),
        );
        transacionHashResp.forEach((item, index) => {
          const previousData = transactionData[index];
          const data = item.data?.data;
          const values = Object.values(data);
          const rawTx = values[0]?.raw_transaction;
          const txid = previousData.txid;
          const value = previousData.value;
          const vout = previousData.vout;
          if (rawTx && typeof rawTx === 'string') {
            finalData.push({
              txid,
              value,
              txhash: rawTx,
              vout: vout,
            });
          }
        });
      }
      if (!finalData?.length) {
        throw new Error('not found input data in blockchair');
      }
      return {status: resp?.status, data: finalData};
    } catch (e) {
      console.error('Error in get getBlockChairTransactions', e);
      throw e;
    }
  },
  createTransaction: async ({chain, txHex}) => {
    try {
      const resp = await BlockChairAPI.post(
        `${chainName[chain]}/push/transaction`,
        {
          data: txHex,
        },
      );
      return resp?.data?.data?.transaction_hash;
    } catch (e) {
      console.error(
        `Error in BlockChair for create transactions in ${chain} `,
        e?.response?.data,
      );
      throw e;
    }
  },
  getTransaction: async ({chain, transactionId}) => {
    try {
      const resp = await BlockChairAPI.get(
        `${chainName[chain]}/dashboards/transaction/${transactionId}`,
      );
      const blockId = resp?.data?.data?.[transactionId]?.transaction?.block_id;
      return blockId && blockId !== -1;
    } catch (e) {
      console.error(
        `Error in BlockChair for get transactions in ${chain} `,
        e?.response?.data,
      );
      throw e;
    }
  },
  getTransactionFees: async ({chain}) => {
    const resp = await BlockChairAPI.get(`${chainName[chain]}/stats`);
    const suggesterFee =
      resp?.data?.data?.suggested_transaction_fee_per_byte_sat || 20;
    return Math.round(suggesterFee);
  },
};
