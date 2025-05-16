import BigNumber from 'bignumber.js';
import {FilScanApi} from 'dok-wallet-blockchain-networks/config/filScan';

export const FilScan = {
  getTransactions: async ({address}) => {
    try {
      const res = await FilScanApi.post('/MessagesByAccountID', {
        account_id: address,
        filters: {
          index: 0,
          limit: 20,
          method_name: '',
        },
      });
      if (Array.isArray(res?.data?.result?.messages_by_account_id_list)) {
        const list = res.data.result.messages_by_account_id_list.map(item => {
          return {
            txHash: item?.cid,
            to: item?.to,
            from: item?.from,
            amount: item?.value,
            status: item?.exit_code === 'Ok',
            timestamp: item?.block_time * 1000,
          };
        });
        return list;
      }
      return [];
    } catch (e) {
      console.error('Error in getTransactions for filScan', e);
      return [];
    }
  },
  getTransactionFees: async () => {
    let baseFee = '100';
    let gasUsed = '1000000';

    try {
      const resFinalHeight = await FilScanApi.post('/FinalHeight', {});
      const base_fee = resFinalHeight?.data?.result?.base_fee;
      if (base_fee) {
        baseFee = new BigNumber(base_fee).plus(500).toFixed(0);
      } else {
        console.warn('Missing base_fee in API response, using fallback value');
      }

      const res = await FilScanApi.post('/GasDataTrend', {
        interval: '24h',
      });
      const avg_gas_used = res.data?.result?.items?.[0]?.avg_gas_used;
      if (avg_gas_used) {
        gasUsed = new BigNumber(avg_gas_used).toFixed(0);
      } else {
        console.warn(
          'Missing avg_gas_used in API response, using fallback value',
        );
      }
    } catch (error) {
      console.error('Failed to fetch gas data trend:', error);
      console.warn('Using fallback values for gas calculation');
    }
    return {baseFee, gasUsed};
  },
};
