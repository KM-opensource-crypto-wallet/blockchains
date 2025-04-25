import {TronScanAPI} from '../config/tronScan';

export const TronScan = {
  getAllValidators: async () => {
    try {
      const resp = await TronScanAPI.get('/api/pagewitness');
      return {status: resp?.status, data: resp?.data?.data};
    } catch (e) {
      console.error('Error in getAllValidators for tron', e);
    }
  },
  getTransactionByHash: async transactionHash => {
    try {
      const resp = await TronScanAPI.get('/api/transaction-info', {
        params: {
          hash: transactionHash,
        },
      });
      return {status: resp?.status, data: resp?.data?.contractRet};
    } catch (e) {
      console.error('Error in getTransactionByHash for tron', e);
    }
  },
};
