import {BlockScout} from 'dok-wallet-blockchain-networks/service/blockScout';
import {getRPCUrl} from 'dok-wallet-blockchain-networks/rpcUrls/rpcUrls';
import {EtherScan} from 'dok-wallet-blockchain-networks/service/etherScan';

export const PolygonService = {
  getTransactions: async ({
    address,
    contractAddress,
    chain_name = 'polygon',
  }) => {
    const isBlockScout = getRPCUrl('polygon_blockscout');
    if (isBlockScout) {
      return BlockScout.getTransactions({address, contractAddress, chain_name});
    } else {
      return EtherScan.getTransactions({
        chain_name,
        address,
        contractAddress,
      });
    }
  },
  getTransactionFeeData: async ({chain_name = 'polygon'} = {}) => {
    const isBlockScout = getRPCUrl('polygon_blockscout');
    if (isBlockScout) {
      return BlockScout.getTransactionFeeData({chain_name});
    } else {
      return EtherScan.getTransactionFeeData({
        chain_name,
      });
    }
  },
};
