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
      const resp = await axios.get(getThorTransactionUrl(address));
      const allTransactions = resp.data.actions;
      return allTransactions.map(item => {
        return {
          txhash: item?.in?.[0]?.txID,
          from: item?.in?.[0]?.address,
          to: item?.out?.[0]?.address,
          amount: item?.in?.[0]?.coins?.find?.(
            subItem => subItem.asset === 'THOR.RUNE',
          )?.amount,
          timestamp: item?.date?.slice(0, -6),
          status: item?.status?.toUpperCase(),
        };
      });
    } catch (e) {
      console.error('Error in getThortransaction', e);
      return [];
    }
  },
  getTransactionStatus: async txHash => {
    try {
      const resp = await axios.get(
        `https://midgard.ninerealms.com/v2/actions?txid=${txHash}`,
      );
      return !!resp?.data?.actions?.length;
    } catch (e) {
      console.error('Error in get transaction status', e);
      return false;
    }
  },
};
const getThorTransactionUrl = address => {
  return `https://midgard.ninerealms.com/v2/actions?address=${address}&asset=THOR.RUNE&limit=20`;
};
