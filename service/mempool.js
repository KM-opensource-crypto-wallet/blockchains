import {LitecoinSpaceAPI} from 'dok-wallet-blockchain-networks/config/litecoinSpace';
import BigNumber from 'bignumber.js';
import {BitcoinMempoolAPI} from 'dok-wallet-blockchain-networks/config/bitcoinMempool';
import {BchMempoolAPI} from 'dok-wallet-blockchain-networks/config/BchMempool';

const APIProvider = {
  btc: BitcoinMempoolAPI,
  ltc: LitecoinSpaceAPI,
  bch: BchMempoolAPI,
};
export const Mempool = {
  getBalance: async ({address, chain}) => {
    const resp = await APIProvider[chain].get(`/address/${address}`);
    const total = new BigNumber(resp?.data?.chain_stats?.funded_txo_sum || 0);
    const spent = new BigNumber(resp?.data?.chain_stats?.spent_txo_sum || 0);
    return total.minus(spent).toString();
  },
  getTransactions: async ({address, chain}) => {
    const resp = await APIProvider[chain].get(`/address/${address}/txs`);
    const txs = Array?.isArray(resp?.data) ? resp?.data : [];
    const transactions = txs?.map(item => {
      const fromAddress = item?.vin?.[0]?.prevout?.scriptpubkey_address;
      const isSender = fromAddress === address;
      let totalAmount = new BigNumber(0);
      const txHash = item?.txid;
      const vOut = Array.isArray(item?.vout) ? item?.vout : [];
      vOut.forEach(tr => {
        const txAddress = tr?.scriptpubkey_address?.toLowerCase();
        const addressLower = address?.toLowerCase();
        if (
          (isSender && txAddress !== addressLower) ||
          (!isSender && txAddress === addressLower)
        ) {
          const amount = new BigNumber(tr?.value || 0);
          totalAmount = totalAmount.plus(amount);
        }
      });
      if (isSender) {
        const fees = new BigNumber(item?.fee || 0);
        totalAmount = totalAmount.plus(fees);
      }
      return {
        amount: totalAmount.toString(),
        hash: txHash,
        status: !!item?.status?.confirmed,
        timestamp: new Date(item?.status?.block_time * 1000), //new Date(transaction.raw_data.timestamp),
        from: fromAddress,
        to: vOut?.find(tx => {
          const txAddress = tx?.scriptpubkey_address?.toLowerCase();
          const fromAddressLower = fromAddress?.toLowerCase();
          const addressLower = address?.toLowerCase();
          return isSender
            ? txAddress !== fromAddressLower
            : txAddress === addressLower;
        })?.scriptpubkey_address,
      };
    });
    return transactions.sort(
      (a, b) => new Date(b?.timestamp) - new Date(a?.timestamp),
    );
  },
  getUTXO: async ({address, chain}) => {
    const resp = await APIProvider[chain].get(`/address/${address}/utxo`);
    const data = Array.isArray(resp?.data) ? resp?.data : [];
    return data.map(item => ({
      hash: item?.txid,
      value: item?.value,
      vout: item?.vout,
    }));
  },
  fetchTransactionHex: async ({txid, chain}) => {
    return await APIProvider[chain].get(`/tx/${txid}/hex`);
  },
  fetchTransactionDetails: async ({transactionData, chain}) => {
    try {
      const resp = await Promise.all(
        transactionData.map(item => APIProvider[chain].get(`/tx/${item.txid}`)),
      );

      // const data = Array.isArray(resp?.data) ? resp?.data : [];
      let finalData = [];
      let needToFetchTransactionHash = [];
      resp.forEach((item, index) => {
        const previousData = transactionData[index];
        const data = item.data;
        const txid = data.txid;
        const value = previousData.value;
        const vout = data.vout;
        const foundVout = vout.filter(
          subItem =>
            subItem.value === value &&
            subItem.scriptpubkey_address === previousData.fromAddress,
        );
        foundVout.forEach((subItem, index) => {
          if (
            (subItem?.scriptpubkey &&
              subItem?.scriptpubkey_type?.includes('p2wsh')) ||
            subItem?.scriptpubkey_type?.includes('p2wpkh') ||
            subItem?.scriptpubkey_type?.includes('p2sh') ||
            subItem?.scriptpubkey_type?.includes('p2tr')
          ) {
            finalData.push({
              txid,
              value,
              scriptpubkey: subItem.scriptpubkey,
              vout: previousData.vout,
            });
          } else {
            needToFetchTransactionHash.push(previousData);
          }
        });
      });
      if (needToFetchTransactionHash.length) {
        const uniqueTransactionHash = [];
        needToFetchTransactionHash.forEach(function (item) {
          const i = uniqueTransactionHash.findIndex(x => x.txid === item.txid);
          if (i <= -1) {
            uniqueTransactionHash.push(item);
          }
        });
        const transactionHashResp = await Promise.all(
          uniqueTransactionHash.map(item =>
            APIProvider[chain].get(`/tx/${item.txid}/hex`),
          ),
        );
        transactionHashResp.forEach((item, index) => {
          const previousData = transactionData[index];
          const data = item.data;
          const txid = previousData.txid;
          const value = previousData.value;
          const vout = previousData.vout;
          if (data && typeof data === 'string') {
            finalData.push({
              txid,
              value,
              txhash: data,
              vout: vout,
            });
          }
        });
      }

      return {status: resp?.status, data: finalData};
    } catch (e) {
      console.error(`Error in get transactions details ${chain}`, e);
      throw e;
    }
  },
  createTransaction: async ({txHex, chain}) => {
    try {
      const resp = await APIProvider[chain].post('/tx', txHex, {
        headers: {
          'Content-Type': 'text/plain',
        },
      });
      return resp?.data;
    } catch (e) {
      console.error(
        `Error in ${chain} for create transactions`,
        e?.response?.data,
      );
      throw e;
    }
  },
  getTransaction: async ({transactionId, chain}) => {
    try {
      const resp = await APIProvider[chain].get(`/tx/${transactionId}`);
      return !!resp?.data?.status?.confirmed;
    } catch (e) {
      console.error(
        `Error in ${chain} for get transactions`,
        e?.response?.data,
      );
      throw e;
    }
  },
  getTransactionFees: async ({chain}) => {
    const resp = await APIProvider[chain].get('/v1/fees/mempool-blocks');
    const blockSize = resp?.data?.[0]?.blockVSize || 1;
    const totalFees = resp?.data?.[0]?.totalFees || 1;
    const fees = Math.round(totalFees / blockSize);
    if (!fees || fees === 1) {
      throw new Error('Invalid fees');
    }
    return Math.round(fees);
  },
};
