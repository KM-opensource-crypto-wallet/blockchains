import BigNumber from 'bignumber.js';
import {FilScanApi} from 'dok-wallet-blockchain-networks/config/filScan';

// FilScan reports mempool messages with exit_code 'Pending(-1)' while
// height/block_time are already set to the current tip, so exit_code is
// the only reliable execution signal.
const mapExitCodeToStatus = exitCode => {
  if (exitCode === 'Ok') {
    return 'SUCCESS';
  }
  if (!exitCode || exitCode.startsWith('Pending')) {
    return 'PENDING';
  }
  return 'FAILED';
};

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
            status: mapExitCodeToStatus(item?.exit_code),
            timestamp: item?.block_time * 1000,
            blockNumber: item?.height * 1000,
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
  getTransaction: async ({txHash}) => {
    try {
      const [res, tipRes] = await Promise.all([
        FilScanApi.post('/MessageDetails', {message_cid: txHash}),
        FilScanApi.post('/FinalHeight', {}).catch(() => null),
      ]);
      if (res?.data?.result?.MessageDetails) {
        const {block_time, exit_code, from, to, value, height} =
          res.data.result.MessageDetails.message_basic;
        const status = mapExitCodeToStatus(exit_code);
        // While pending, height/block_time only mirror the current tip —
        // they are not the inclusion epoch, so don't report them.
        const blockNumber = status === 'PENDING' ? null : height ?? null;
        const tipHeight = tipRes?.data?.result?.final_height ?? null;
        const confirmations =
          tipHeight !== null && blockNumber !== null
            ? tipHeight - blockNumber
            : null;
        return {
          data: {
            txHash: txHash,
            to: to,
            from: from,
            amount: value,
            status,
            timestamp: block_time * 1000,
            blockNumber,
            confirmations,
          },
        };
      }
      return {data: null};
    } catch (e) {
      console.error('Error in getTransactions for filScan', e);
      return {data: null};
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
