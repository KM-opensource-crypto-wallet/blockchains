import {VicScanAPI} from 'dok-wallet-blockchain-networks/config/vicScan';

export const VicScan = {
  getTransactions: async ({address, contractAddress = null}) => {
    try {
      const resp = await VicScanAPI.get(
        `/api/${contractAddress ? 'tokentx' : 'transaction'}/list`,
        {
          params: {
            sort: 'desc',
            limit: 20,
            account: address,
            tokenAddress: contractAddress,
          },
        },
      );
      const items = Array.isArray(resp?.data?.data) ? resp?.data?.data : [];
      const mapItems = contractAddress
        ? items.map(subItem => ({
            ...subItem,
            hash: subItem?.transactionHash,
            confirmations: 20,
            timeStamp: subItem?.timestamp,
            contractAddress: contractAddress,
          }))
        : items.map(subItem => ({
            ...subItem,
            txreceipt_status: subItem.status === 'success' ? 1 : 0,
            timeStamp: subItem?.timestamp,
          }));
      return {status: resp?.status, data: mapItems};
    } catch (e) {
      console.error('Error in get transaction VicScan scan', e);
    }
  },
};
