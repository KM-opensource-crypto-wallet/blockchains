import {InkBlockExplorerAPI} from '../config/InkBlockExplorer';

export const InkBlockExplorer = {
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
      const resp = await InkBlockExplorerAPI.get('/api', {
        params: payload,
      });
      return {status: resp?.status, data: resp?.data?.result};
    } catch (e) {
      console.error('Error in get ink transactions', e);
    }
  },
  getTransactionFeeData: async () => {
    try {
      const resp = await InkBlockExplorerAPI.post('/api/eth-rpc', {
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
      console.error('Error in get ink fees', e);
    }
  },
};
