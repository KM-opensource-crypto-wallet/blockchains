import {EthereumPowScanAPI} from '../config/EthereumPowScan';
import {convertToSmallAmount} from '../helper';

export const EthereumPowScan = {
  getTransactions: async ({
    address,
    contractAddress = null,
    decimals = null,
  }) => {
    try {
      const resp = await EthereumPowScanAPI.get(
        `/api/v5/explorer/address/${
          contractAddress ? 'token-transaction-list' : 'normal-transaction-list'
        }`,
        {
          params: {
            limit: 20,
            address,
            chainShortName: 'ETHW',
            tokenContractAddress: contractAddress,
          },
        },
      );
      const items = Array.isArray(resp?.data?.data?.[0]?.transactionList)
        ? resp?.data?.data?.[0]?.transactionList
        : [];
      const mapItems = items.map(subItem => ({
        ...subItem,
        hash: subItem.txId,
        txreceipt_status: subItem.state === 'success' ? 1 : 0,
        timeStamp: Math.floor(Number(subItem?.transactionTime) / 1000),
        from: subItem?.from,
        to: subItem?.to,
        value: convertToSmallAmount(
          subItem?.amount,
          decimals || 18,
        )?.toString(),
        contractAddress: subItem?.tokenContractAddress,
      }));
      return {status: resp?.status, data: mapItems};
    } catch (e) {
      console.error('Error in get transaction Ethereum PoW scan', e);
    }
  },
};
