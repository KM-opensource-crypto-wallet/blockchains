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
      const resp = await COSMOS_API.get(`/v1/cosmos/txs/${txHash}`);
      const item = resp?.data?.[0];
      if (!item) {
        return {status: resp?.status, data: null};
      }
      const events = item?.logs?.[0]?.events || [];
      const transferEvent = events.find(e => e.type === 'transfer');
      const sender = transferEvent?.attributes?.find(
        a => a.key === 'sender',
      )?.value;
      const recipient = transferEvent?.attributes?.find(
        a => a.key === 'recipient',
      )?.value;
      const amountStr = transferEvent?.attributes?.find(
        a => a.key === 'amount',
      )?.value;
      const finalAmount = parseInt(amountStr || '0', 10);
      return {
        status: resp?.status,
        data: {
          txHash: item?.txhash,
          success: item?.code === 0,
          amount: finalAmount.toString(),
          from: sender ?? null,
          to: recipient ?? null,
          blockNumber: item?.height ?? null,
          confirmations: null,
          timestamp: item?.timestamp,
        },
      };
    } catch (e) {
      console.error('Error in CosmosScan getTransaction', e);
      return {status: e?.response?.status ?? null, data: null};
    }
  },
};
