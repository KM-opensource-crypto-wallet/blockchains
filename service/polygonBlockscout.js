import {PolygonBlockScoutAPI} from 'dok-wallet-blockchain-networks/config/polygonBlockScout';

export const PolygonBlockScout = {
  getTransactions: async ({address, contractAddress}) => {
    try {
      const payload = {
        module: 'account',
        action: contractAddress ? 'tokentx' : 'txlist',
        contractaddress: contractAddress,
        address,
        startblock: 0,
        endblock: 99999999,
        // page: 1,
        // offset: 20,
        sortby: 'timeStamp',
        sort: 'desc',
      };
      const resp = await PolygonBlockScoutAPI.get('/api', {
        params: payload,
      });
      return {status: resp?.status, data: resp?.data?.result};
    } catch (e) {
      console.error('Error in get polygon transactions', e);
    }
  },
  getTransactionFeeData: async () => {
    try {
      const resp = await PolygonBlockScoutAPI.post('/api/eth-rpc', {
        id: 0,
        jsonrpc: '2.0',
        method: 'eth_gasPrice',
        params: [],
      });
      return {
        status: resp?.status,
        data: resp?.data?.result?.toString(),
      };
    } catch (e) {
      console.error('Error in get polygon fees', e);
    }
  },
};
