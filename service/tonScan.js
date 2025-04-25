import {TonScanAPI} from '../config/tonScan';

export const TonScan = {
  getTokenTransactions: async ({address, contractAddress}) => {
    try {
      const resp = await TonScanAPI.get('/api/v3/jetton/transfers', {
        params: {
          address: address,
          jetton_master: contractAddress,
        },
      });
      return {status: resp?.status, data: resp?.data?.jetton_transfers};
    } catch (e) {
      console.error('Error in getAllValidators for tron', e);
    }
  },
};
