import {PolygonBlockScout} from 'dok-wallet-blockchain-networks/service/polygonBlockscout';
import {getRPCUrl} from 'dok-wallet-blockchain-networks/rpcUrls/rpcUrls';
import {EtherScan} from 'dok-wallet-blockchain-networks/service/etherScan';

export const PolygonService = {
  getTransactions: async ({address, contractAddress}) => {
    const isBlockScout = getRPCUrl('polygon_blockscout');
    if (isBlockScout) {
      return PolygonBlockScout.getTransactions({address, contractAddress});
    } else {
      return EtherScan.getTransactions({
        chain_name: 'polygon',
        address,
        contractAddress,
      });
    }
  },
  getTransactionFeeData: async () => {
    const isBlockScout = getRPCUrl('polygon_blockscout');
    if (isBlockScout) {
      return PolygonBlockScout.getTransactionFeeData();
    } else {
      return EtherScan.getTransactionFeeData({
        chain_name: 'polygon',
      });
    }
  },
};
