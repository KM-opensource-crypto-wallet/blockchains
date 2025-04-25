import {HEDERA_API} from 'dok-wallet-blockchain-networks/config/Hedera';

export const HEDERA = {
  getAccountInfo: async address => {
    try {
      const resp = await HEDERA_API.get(`/api/v1/accounts/${address}`, {
        params: {
          limit: 1,
          transactions: false,
        },
      });
      return {status: resp?.status, data: resp?.data};
    } catch (e) {
      console.error('Error in HEDERA getAccountInfo', e);
      return false;
    }
  },
  getExchangeFee: async () => {
    try {
      const resp = await HEDERA_API.get('/api/v1/network/exchangerate');
      return {status: resp?.status, data: resp?.data};
    } catch (e) {
      console.error('Error in  HEDERA getExchangeFee', e);
    }
  },
  getTransactions: async address => {
    try {
      const resp = await HEDERA_API.get(`/api/v1/accounts/${address}`, {
        params: {
          limit: 20,
          transactiontype: 'cryptotransfer',
          transactions: true,
          order: 'desc',
        },
      });
      return {status: resp?.status, data: resp?.data?.transactions};
    } catch (e) {
      console.error('Error in HEDERA getTransactions', e);
    }
  },
};
