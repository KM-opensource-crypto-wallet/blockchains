import {BlockChairAPI} from 'dok-wallet-blockchain-networks/config/blockChair';

export const CardanoChainService = {
  getCardanoBalance: async address => {
    try {
      const resp = await BlockChairAPI.get(`/cardano/raw/address/${address}`);
      const balance = resp.data?.data?.[address]?.address?.caBalance?.getCoin;
      return {status: resp?.status, data: balance};
    } catch (e) {
      console.error('error in getCardanoBalance', e);
    }
  },
  getCardanoTransactions: async address => {
    try {
      const resp = await BlockChairAPI.get(`/cardano/raw/address/${address}`);
      const transactions = resp.data?.data?.[address]?.address?.caTxList;
      const last20Transactions = transactions.slice(0, 20);
      if (Array.isArray(last20Transactions)) {
        return last20Transactions.map(item => {
          return {
            txHash: item?.ctbId,
            timestamp: item?.ctbTimeIssued * 1000,
            to: item?.ctbOutputs?.[0]?.ctaAddress,
            from: item?.ctbOutputs?.[1]?.ctaAddress,
            amount: item?.ctbOutputs?.[0]?.ctaAmount?.getCoin?.toString(),
          };
        });
      }
      return [];
    } catch (e) {
      console.error('Error in getCardanoTransactions', e);
      return [];
    }
  },
};
