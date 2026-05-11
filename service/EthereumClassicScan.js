import {EthereumClassicScanAPI} from '../config/EthereumClassicScan';

export const EthereumClassicScan = {
  getTransactions: async ({address, contractAddress = null}) => {
    try {
      const resp = await EthereumClassicScanAPI.get(
        `/api/v2/addresses/${address}/${
          contractAddress ? 'token-transfers' : 'transactions'
        }`,
        contractAddress ? {params: {token: contractAddress}} : {},
      );
      const items = Array.isArray(resp?.data?.items) ? resp?.data?.items : [];
      const mapItems = contractAddress
        ? items.map(subItem => ({
            ...subItem,
            hash: subItem?.transaction_hash,
            txreceipt_status:
              subItem?.tx_status === 'ok' || subItem?.status === 'ok' ? 1 : 0,
            timeStamp: Math.floor(
              new Date(subItem?.timestamp).getTime() / 1000,
            ),
            from: subItem?.from?.hash,
            to: subItem?.to?.hash,
            value: subItem?.total?.value || '0',
            confirmations: 1,
            contractAddress: subItem?.token?.address || contractAddress,
          }))
        : items.map(subItem => ({
            ...subItem,
            txreceipt_status:
              subItem?.tx_status === 'ok' || subItem?.status === 'ok' ? 1 : 0,
            timeStamp: Math.floor(
              new Date(subItem?.timestamp).getTime() / 1000,
            ),
            from: subItem?.from?.hash,
            to: subItem?.to?.hash,
          }));
      return {status: resp?.status, data: mapItems};
    } catch (e) {
      console.error('Error in get transaction Ethereum Classic scan', e);
    }
  },
};
