import {BlockCypherAPI} from 'dok-wallet-blockchain-networks/config/blockCypher';
import BigNumber from 'bignumber.js';

export const BlockCypher = {
  getBalance: async ({chain, address}) => {
    const resp = await BlockCypherAPI.get(
      `/v1/${chain}/main/addrs/${address}/balance`,
    );
    return resp?.data?.final_balance?.toString();
  },

  getTransactions: async ({chain, address}) => {
    const resp = await BlockCypherAPI.get(
      `/v1/${chain}/main/addrs/${address}/full?limit=20`,
    );
    const txs = Array?.isArray(resp?.data?.txs) ? resp?.data?.txs : [];
    return txs?.map(item => {
      const fromAddress = item?.inputs?.[0]?.addresses?.[0];
      const isSender = fromAddress === address;
      let totalAmount = new BigNumber(0);
      const txHash = item?.hash;
      const vOut = Array.isArray(item?.outputs) ? item?.outputs : [];
      vOut.forEach(tr => {
        if (
          (isSender &&
            tr?.addresses?.[0]?.toLowerCase() !== address?.toLowerCase()) ||
          (!isSender &&
            tr?.addresses?.[0]?.toLowerCase() === address?.toLowerCase())
        ) {
          const amount = new BigNumber(tr?.value || 0);
          totalAmount = totalAmount.plus(amount);
        }
      });
      if (isSender) {
        const fees = new BigNumber(item?.fees || 0);
        totalAmount = totalAmount.plus(fees);
      }
      return {
        amount: totalAmount.toString(),
        hash: txHash,
        status: !!item?.confirmed,
        timestamp: new Date(item?.received), //new Date(transaction.raw_data.timestamp),
        from: fromAddress,
        to: item?.outputs?.find(tx =>
          tx?.addresses?.[0]?.toLowerCase() === fromAddress?.toLowerCase()
            ? tx?.addresses?.[0]?.toLowerCase() !== fromAddress?.toLowerCase()
            : tx?.addresses?.[0]?.toLowerCase() === address?.toLowerCase(),
        )?.addresses?.[0],
      };
    });
  },

  getUTXO: async ({chain, address}) => {
    const resp = await BlockCypherAPI.get(
      `/v1/${chain}/main/addrs/${address}?unspentOnly=true`,
    );
    const data = Array.isArray(resp?.data?.txrefs) ? resp?.data?.txrefs : [];
    return data.map(item => ({
      hash: item?.tx_hash,
      value: item?.value,
      vout: item?.tx_output_n,
    }));
  },
  fetchTransactionDetails: async ({chain, transactionData}) => {
    try {
      console.log('tddd', transactionData);
      const resp = await Promise.all(
        transactionData.map(item =>
          BlockCypherAPI.get(
            `/v1/${chain}/main/txs/${item.txid}?outstart=${item?.vout || 0}`,
          ),
        ),
      );

      // const data = Array.isArray(resp?.data) ? resp?.data : [];
      let finalData = [];
      let needToFetchTransactionHash = [];
      resp.forEach((item, index) => {
        const previousData = transactionData[index];
        const data = item.data;
        const txid = data.hash;
        const value = previousData.value;
        const vout = data.outputs;
        const foundVout = vout.filter(
          subItem =>
            subItem.value === value &&
            subItem.addresses?.[0]?.toLowerCase() ===
              previousData.fromAddress?.toLowerCase(),
        );
        foundVout.forEach(subItem => {
          if (
            subItem?.script_type === 'pay-to-witness-pubkey-hash' ||
            subItem?.script_type === 'pay-to-witness-script-hash'
          ) {
            finalData.push({
              txid,
              value,
              scriptpubkey: subItem.script,
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
            BlockCypherAPI.get(
              `/v1/${chain}/main/txs/${item.txid}?includeHex=true&outstart=${
                item?.vout || 0
              }`,
            ),
          ),
        );
        transacionHashResp.forEach((item, index) => {
          const previousData = transactionData[index];
          const data = item.data?.hex;
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
      if (!finalData?.length) {
        throw new Error('Something went wrong get transactions in blockcypher');
      }
      return {status: resp?.status, data: finalData};
    } catch (e) {
      console.error('Error in get getBlockcypherTransactions', e);
      throw e;
    }
  },
  createTransaction: async ({chain, txHex}) => {
    try {
      const resp = await BlockCypherAPI.post(
        `/v1/${chain}/main/txs/push`,
        JSON.stringify({tx: txHex}),
        {
          headers: {
            'Content-Type': 'text/plain',
          },
        },
      );
      return resp?.data?.tx?.hash;
    } catch (e) {
      console.error(
        `Error in Blockcypher for create transactions in ${chain} `,
        e?.response?.data,
      );
      throw e;
    }
  },
  getTransaction: async ({chain, transactionId}) => {
    try {
      const resp = await BlockCypherAPI.get(
        `/v1/${chain}/main/txs/${transactionId}`,
      );
      console.log('repsas', resp?.data);
      return !!resp?.data?.confirmations;
    } catch (e) {
      console.error(
        `Error in Blockcypher for get transactions in ${chain} `,
        e?.response?.data,
      );
      throw e;
    }
  },
  getTransactionFees: async ({chain}) => {
    const resp = await BlockCypherAPI.get(`/v1/${chain}/main`);
    const highestFee = resp?.data?.high_fee_per_kb || 15360;
    return Math.round(highestFee / 1024);
  },
};
