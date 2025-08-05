import {BlockDaemonAPI} from 'dok-wallet-blockchain-networks/config/BlockDaemon';
import BigNumber from 'bignumber.js';
import {Mempool} from './mempool';
import {convertToSmallAmount} from 'dok-wallet-blockchain-networks/helper';
import {IS_SANDBOX} from 'dok-wallet-blockchain-networks/config/config';

const chainName = {
  btc: 'bitcoin',
  bch: 'bitcoincash',
  doge: 'dogecoin',
  ltc: 'litecoin',
};

const network = IS_SANDBOX ? 'testnet' : 'mainnet';

const parseBlockdaemonTransactions = (txs, walletAddresses) => {
  // Convert wallet addresses to lowercase Set for fast lookup
  const walletSet = new Set(walletAddresses.map(addr => addr.toLowerCase()));

  return txs
    .map(tx => {
      // Extract different event types from the events array
      const inputEvents =
        tx.events?.filter(event => event.type === 'utxo_input') || [];
      const outputEvents =
        tx.events?.filter(event => event.type === 'utxo_output') || [];
      const feeEvents = tx.events?.filter(event => event.type === 'fee') || [];

      // Check if any input belongs to our wallet (we're sending)
      const isOutgoing = inputEvents.some(input =>
        walletSet.has(input.source?.toLowerCase()),
      );

      // Separate outputs into external (actual transfers) and internal (change)
      const externalOutputs = [];
      const internalOutputs = [];

      outputEvents.forEach(output => {
        const address = output.destination?.toLowerCase();
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
          (sum, output) => sum.plus(new BigNumber(output.amount || 0)),
          new BigNumber(0),
        );
      } else {
        // For incoming: amount received = internal outputs (what we received)
        transferAmount = internalOutputs.reduce(
          (sum, output) => sum.plus(new BigNumber(output.amount || 0)),
          new BigNumber(0),
        );
      }

      // Get fee amount using BigNumber
      const fee = new BigNumber(feeEvents[0]?.amount || 0);

      // Get primary recipient (first external output)
      const primaryRecipient = externalOutputs[0]?.destination;

      // Get sender address (first input from our wallet)
      const senderAddress = inputEvents.find(input =>
        walletSet.has(input.source?.toLowerCase()),
      )?.source;

      return {
        hash: tx.id,
        timestamp: tx.date ? new Date(tx.date * 1000) : null,
        status: tx.status === 'completed',
        amount: transferAmount.toString(),
        fee: fee.toString(),
        from: isOutgoing ? senderAddress : inputEvents[0]?.source,
        to: isOutgoing ? primaryRecipient : internalOutputs[0]?.destination,
      };
    })
    .sort(
      (a, b) => (b.timestamp?.getTime() || 0) - (a.timestamp?.getTime() || 0),
    );
};

export const BlockDaemon = {
  getBalance: async ({chain, address}) => {
    const resp = await BlockDaemonAPI.get(
      `universal/v1/${chainName[chain]}/${network}/account/${address}`,
    );
    return resp?.data?.[0]?.confirmed_balance;
  },

  getTransactions: async ({chain, address, derive_addresses}) => {
    const resp = await BlockDaemonAPI.get(
      `universal/v1/${chainName[chain]}/${network}/account/${address}/txs?order=desc&limit=20`,
    );
    const txs = Array?.isArray(resp?.data?.data) ? resp?.data?.data : [];
    const finalAddresses = Array.isArray(derive_addresses)
      ? derive_addresses
      : [address];
    return parseBlockdaemonTransactions(txs, finalAddresses);
  },

  getUTXO: async ({chain, address}) => {
    const resp = await BlockDaemonAPI.get(
      `universal/v1/${chainName[chain]}/${network}/account/${address}/utxo?spent=false`,
    );
    const data = Array.isArray(resp?.data?.data) ? resp?.data?.data : [];
    return data.map(item => ({
      hash: item?.mined?.tx_id,
      value: item?.value,
      vout: item?.mined?.index,
    }));
  },
  fetchTransactionDetails: async ({chain, transactionData, address}) => {
    try {
      const resp = await BlockDaemonAPI.get(
        `universal/v1/${chainName[chain]}/${network}/account/${address}/utxo?spent=false`,
      );

      const data = Array.isArray(resp?.data?.data) ? resp?.data?.data : [];
      let finalData = [];
      let needToFetchTransactionHash = [];
      transactionData.forEach(item => {
        const txid = item.txid;
        const foundTx = data?.find(subItem => subItem?.mined?.tx_id === txid);
        if (foundTx) {
          const value = item.value;
          const vout = item.vout;
          const scriptType = foundTx?.mined?.meta?.script_type;
          const script = foundTx?.mined?.meta?.script;
          if (scriptType?.toLowerCase()?.includes('witness')) {
            finalData.push({
              txid,
              value,
              scriptpubkey: script,
              vout: vout,
            });
          } else {
            needToFetchTransactionHash.push(item);
          }
        }
      });
      if (needToFetchTransactionHash.length) {
        const transactionHashResp = await Promise.all(
          needToFetchTransactionHash.map(item =>
            Mempool.fetchTransactionHex({chain, txid: item?.txid}),
          ),
        );
        transactionHashResp.forEach((item, index) => {
          const previousData = transactionData[index];
          const txhash = item.data;
          const txid = previousData.txid;
          const value = previousData.value;
          const vout = previousData.vout;
          if (txhash && typeof txhash === 'string') {
            finalData.push({
              txid,
              value,
              txhash,
              vout: vout,
            });
          }
        });
      }
      if (!finalData?.length) {
        throw new Error('Something went wrong get transactions in blockdaemon');
      }
      return {status: resp?.status, data: finalData};
    } catch (e) {
      console.error('Error in get getblockdaemonTransactions', e);
      throw e;
    }
  },
  createTransaction: async ({chain, txHex}) => {
    try {
      const resp = await BlockDaemonAPI.post(
        `/tx/v1/${chainName[chain]}-${network}/send`,
        {
          tx: txHex,
        },
      );
      return resp?.data?.id;
    } catch (e) {
      console.error(
        `Error in blockdaemon for create transactions in ${chain} `,
        e?.response?.data,
      );
      throw e;
    }
  },
  getTransaction: async ({chain, transactionId}) => {
    try {
      const resp = await BlockDaemonAPI.get(
        `universal/v1/${chainName[chain]}/${network}/tx/${transactionId}`,
      );
      return !!resp?.data?.confirmations;
    } catch (e) {
      console.error(
        `Error in blockdaemon for get transactions in ${chain} `,
        e?.response?.data,
      );
      throw e;
    }
  },
  getTransactionFees: async ({chain}) => {
    const resp = await BlockDaemonAPI.get(
      `universal/v1/${chainName[chain]}/${network}/tx/estimate_fee`,
    );
    let highestFee = resp?.data?.estimated_fees?.fast || 20;
    if (chain === 'doge' && highestFee?.toString()?.includes('.')) {
      highestFee = Number(convertToSmallAmount(highestFee?.toString(), 8));
    }
    return Math.round(highestFee);
  },
};
