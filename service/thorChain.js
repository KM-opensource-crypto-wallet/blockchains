import axios from 'axios';

export const ThorChainService = {
  getThorBalance: async address => {
    try {
      const resp = await axios.get(
        `https://midgard.ninerealms.com/v2/balance/${address}`,
      );
      const coins = resp?.data?.coins;
      const runeBalance =
        coins?.find(item => item.asset === 'THOR.RUNE')?.amount || '0';
      return {status: resp?.status, data: runeBalance};
    } catch (e) {
      console.error('Error in getThorBalance', e);
    }
  },
  getBaseThorFee: async () => {
    try {
      const resp = await axios.get(
        'https://thornode.ninerealms.com/thorchain/constants',
      );
      return resp?.data?.int_64_values?.NativeTransactionFee;
    } catch (e) {
      console.error('Error in getThorFee', e);
    }
  },
  getThorTransactions: async address => {
    try {
      const resp = await Promise.all([
        axios.get(getThorTransactionUrl(address, true)),
        axios.get(getThorTransactionUrl(address, false)),
      ]);
      const allTransactions = [];
      for (let item of resp) {
        if (Array.isArray(item?.data?.txs)) {
          allTransactions.push(...item.data.txs);
        }
      }
      allTransactions.sort(
        (a, b) => new Date(b.timestamp) - new Date(a.timestamp),
      );

      const arrayUniqueByKey = [];
      allTransactions.filter(function (item) {
        const i = arrayUniqueByKey.findIndex(x => x.txhash === item.txhash);
        if (i === -1) {
          arrayUniqueByKey.push(item);
        }
        return null;
      });
      const last20Transactions = arrayUniqueByKey.slice(0, 20);
      return last20Transactions.map(item => ({
        txhash: item?.txhash,
        from: item?.tx?.value?.msg[0]?.value?.from_address,
        to: item?.tx?.value?.msg[0]?.value?.to_address,
        amount: item?.tx?.value?.msg[0]?.value?.amount[0]?.amount,
        timestamp: item?.timestamp,
      }));
    } catch (e) {
      console.error('Error in getThortransaction', e);
      return [];
    }
  },
  getTransactionStatus: async txHash => {
    try {
      const resp = await axios.get(
        `https://thornode-v1.ninerealms.com/txs/${txHash}`,
      );
      return !!resp?.data;
    } catch (e) {
      console.error('Error in get transaction status', e);
      return false;
    }
  },
};
const getThorTransactionUrl = (address, isSend) => {
  return `https://thornode-v1.ninerealms.com/txs?limit=20&page=1&transfer.${
    isSend ? 'sender' : 'recipient'
  }=${address}&message.action=send`;
};
