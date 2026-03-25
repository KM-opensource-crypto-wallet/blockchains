import {COSMOS_API} from 'dok-wallet-blockchain-networks/config/mintscan';

export const CosmosScan = {
  getTransactions: async address => {
    try {
      const resp = await COSMOS_API.get(
        `/v1/cosmos/accounts/${address}/transactions`,
        {
          params: {
            take: 20,
          },
        },
      );
      return {status: resp?.status, data: resp?.data?.transactions};
    } catch (e) {
      console.error('Error in CosmosScan transactions', e);
    }
  },
  getTransaction: async ({txHash}) => {
    try {
      const resp = await COSMOS_API.get(`/v1/search/transactions/${txHash}`);
      return {status: resp?.status, data: resp?.data?.[0]};
    } catch (e) {
      console.error('Error in CosmosScan getTransaction', e);
    }
  },
};
