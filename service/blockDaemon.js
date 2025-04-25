import {BlockDaemonAPI} from 'dok-wallet-blockchain-networks/config/BlockDaemon';
import BigNumber from 'bignumber.js';
import {Mempool} from './mempool';
import {convertToSmallAmount, parseBalance} from '../helper';

const chainName = {
  btc: 'bitcoin',
  bch: 'bitcoincash',
  doge: 'dogecoin',
  ltc: 'litecoin',
};

export const BlockDaemon = {
  getBalance: async ({chain, address}) => {
    const resp = await BlockDaemonAPI.get(
      `universal/v1/${chainName[chain]}/mainnet/account/${address}`,
    );
    return resp?.data?.[0]?.confirmed_balance;
  },

  getTransactions: async ({chain, address}) => {
    const resp = await BlockDaemonAPI.get(
      `universal/v1/${chainName[chain]}/mainnet/account/${address}/txs?order=desc&limit=20`,
    );
    const txs = Array?.isArray(resp?.data?.data) ? resp?.data?.data : [];
    return txs?.map(item => {
      const inputs = item?.events?.filter(tx => tx?.type === 'utxo_input');
      const fromAddress = inputs?.[0]?.meta?.addresses[0];
      const isSender = fromAddress === address;
      let totalAmount = new BigNumber(0);
      const txHash = item?.id;
      const vOut = item?.events?.filter(tx => tx?.type === 'utxo_output');
      vOut.forEach(tr => {
        const trAddress = tr?.meta?.addresses?.[0]?.toLowerCase();
        const addressLower = address?.toLowerCase();
        if (
          (isSender && trAddress !== addressLower) ||
          (!isSender && trAddress === addressLower)
        ) {
          const amount = new BigNumber(tr?.amount || 0);
          totalAmount = totalAmount.plus(amount);
        }
      });
      if (isSender) {
        const fees = new BigNumber(
          item?.events?.find(tx => tx?.type === 'fee')?.amount || 0,
        );
        totalAmount = totalAmount.plus(fees);
      }
      return {
        amount: totalAmount.toString(),
        hash: txHash,
        status: item?.status === 'completed',
        timestamp: new Date(item?.date * 1000), //new Date(transaction.raw_data.timestamp),
        from: fromAddress,
        to: vOut.find(tx =>
          tx?.meta?.addresses?.[0]?.toLowerCase() === fromAddress?.toLowerCase()
            ? tx?.meta?.addresses?.[0]?.toLowerCase() !==
              fromAddress?.toLowerCase()
            : tx?.meta?.addresses?.[0]?.toLowerCase() ===
              address?.toLowerCase(),
        )?.meta?.addresses?.[0],
      };
    });
  },

  getUTXO: async ({chain, address}) => {
    const resp = await BlockDaemonAPI.get(
      `universal/v1/${chainName[chain]}/mainnet/account/${address}/utxo?spent=false`,
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
        `universal/v1/${chainName[chain]}/mainnet/account/${address}/utxo?spent=false`,
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
        `/tx/v1/${chainName[chain]}-mainnet/send`,
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
        `universal/v1/${chainName[chain]}/mainnet/tx/${transactionId}`,
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
      `universal/v1/${chainName[chain]}/mainnet/tx/estimate_fee`,
    );
    let highestFee = resp?.data?.estimated_fees?.fast || 20;
    if (chain === 'doge' && highestFee?.toString()?.includes('.')) {
      highestFee = Number(convertToSmallAmount(highestFee?.toString(), 8));
    }
    return Math.round(highestFee);
  },
};
