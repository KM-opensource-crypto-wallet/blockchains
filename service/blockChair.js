import {BlockChairAPI} from 'dok-wallet-blockchain-networks/config/blockChair';
import BigNumber from 'bignumber.js';
import {IS_SANDBOX} from 'dok-wallet-blockchain-networks/config/config';

const chainName = {
  btc: IS_SANDBOX ? 'bitcoin/testnet' : 'bitcoin',
  bch: 'bitcoin-cash',
  doge: 'dogecoin',
  ltc: 'litecoin',
};

const parseBlockchainTransactions = (txs, walletAddresses) => {
  // Convert wallet addresses to lowercase Set for fast lookup
  const walletSet = new Set(walletAddresses.map(addr => addr.toLowerCase()));

  return txs
    .map(tx => {
      // Extract inputs and outputs arrays
      const inputs = tx.inputs || [];
      const outputs = tx.outputs || [];

      // Check if any input belongs to our wallet (we're sending)
      const isOutgoing = inputs.some(input =>
        walletSet.has(input.recipient?.toLowerCase()),
      );

      // Separate outputs into external (actual transfers) and internal (change)
      const externalOutputs = [];
      const internalOutputs = [];

      outputs.forEach(output => {
        const address = output.recipient?.toLowerCase();
        if (walletSet.has(address)) {
          internalOutputs.push(output);
        } else {
          externalOutputs.push(output);
        }
      });

      // Calculate amount based on transaction direction using BigNumber
      let transferAmount;
      if (isOutgoing) {
        // For outgoing: amount sent = external outputs (what we sent to others)
        transferAmount = externalOutputs.reduce(
          (sum, output) => sum.plus(new BigNumber(output.value || 0)),
          new BigNumber(0),
        );
      } else {
        // For incoming: amount received = internal outputs (what we received)
        transferAmount = internalOutputs.reduce(
          (sum, output) => sum.plus(new BigNumber(output.value || 0)),
          new BigNumber(0),
        );
      }

      // Get fee amount from transaction object using BigNumber
      const fee = new BigNumber(tx.transaction?.fee || 0);

      // Get primary recipient (first external output)
      const primaryRecipient = externalOutputs[0]?.recipient;

      // Get sender address (first input from our wallet)
      const senderAddress = inputs.find(input =>
        walletSet.has(input.recipient?.toLowerCase()),
      )?.recipient;

      // Parse timestamp - combine date and time if available
      let timestamp = null;
      if (tx.transaction?.time) {
        timestamp = new Date(tx.transaction.time);
      }

      return {
        hash: tx.transaction?.hash,
        timestamp: timestamp,
        status: !!tx.transaction?.block_id, // Has block_id means it's confirmed
        amount: transferAmount.toString(),
        fee: fee.toString(),
        from: isOutgoing ? senderAddress : inputs[0]?.recipient,
        to: isOutgoing ? primaryRecipient : internalOutputs[0]?.recipient,
      };
    })
    .sort(
      (a, b) => (b.timestamp?.getTime() || 0) - (a.timestamp?.getTime() || 0),
    );
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

  getTransactions: async ({chain, address, derive_addresses}) => {
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
    const finalAddresses = Array.isArray(derive_addresses)
      ? derive_addresses
      : [address];
    return parseBlockchainTransactions(txs, finalAddresses);
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
