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
  getTransactionByHash: async ({txHash}) => {
    try {
      // TON API v3 expects base64url-encoded hash; convert from hex if needed
      // eslint-disable-next-line no-undef
      const hashBase64 = Buffer.from(txHash, 'hex').toString('base64');
      const resp = await TonScanAPI.get('/api/v3/transactions', {
        params: {hash: hashBase64},
      });
      return {status: resp?.status, data: resp?.data?.transactions};
    } catch (e) {
      console.error('Error in getTransactionByHash for ton', e);
    }
  },
  getMasterchainInfo: async () => {
    try {
      const resp = await TonScanAPI.get('/api/v3/masterchainInfo');
      return resp?.data?.last?.seqno ?? null;
    } catch (e) {
      console.error('Error in getMasterchainInfo for ton', e);
      return null;
    }
  },
};
