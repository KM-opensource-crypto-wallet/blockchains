import {EthereumClassicScanAPI} from '../config/EthereumClassicScan';

export const EthereumClassicScan = {
  getTransactions: async ({address, contractAddress = null}) => {
    try {
      const resp = await EthereumClassicScanAPI.get(
        `/api/v2/addresses/${address}/${
          contractAddress ? 'token-transfer' : 'transactions'
        }`,
        {
          params: {
            sort: 'desc',
            limit: 20,
            token: contractAddress,
          },
        },
      );
      const items = Array.isArray(resp?.data?.items) ? resp?.data?.items : [];
      const mapItems = items.map(subItem => ({
        ...subItem,
        txreceipt_status: subItem.status === 'ok' ? 1 : 0,
        timeStamp: Math.floor(new Date(subItem?.timestamp).getTime() / 1000),
        from: subItem?.from?.hash,
        to: subItem?.to?.hash,
      }));
      return {status: resp?.status, data: mapItems};
    } catch (e) {
      console.error('Error in get transaction Ethereum Classic scan', e);
    }
  },
};
