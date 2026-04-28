import {HEDERA_API} from 'dok-wallet-blockchain-networks/config/Hedera';

export const HEDERA = {
  getAccountInfo: async address => {
    try {
      const resp = await HEDERA_API.get(`/api/v1/accounts/${address}`, {
        params: {
          limit: 1,
          transactions: false,
        },
      });
      return {status: resp?.status, data: resp?.data};
    } catch (e) {
      console.error('Error in HEDERA getAccountInfo', e);
      return false;
    }
  },
  getExchangeFee: async () => {
    try {
      const resp = await HEDERA_API.get('/api/v1/network/exchangerate');
      return {status: resp?.status, data: resp?.data};
    } catch (e) {
      console.error('Error in  HEDERA getExchangeFee', e);
    }
  },
  getTransactions: async address => {
    try {
      const resp = await HEDERA_API.get(`/api/v1/accounts/${address}`, {
        params: {
          limit: 20,
          transactiontype: 'cryptotransfer',
          transactions: true,
          order: 'desc',
        },
      });
      return {status: resp?.status, data: resp?.data?.transactions};
    } catch (e) {
      console.error('Error in HEDERA getTransaction', e);
      return null;
    }
  },
  getTransaction: async txHash => {
    try {
      const resp = await HEDERA_API.get(`/api/v1/transactions/${txHash}`);
      const tx = resp?.data?.transactions[0];
      if (!tx) {
        return {status: resp?.status, data: tx};
      }
      const consensusTimestamp = tx?.consensus_timestamp;
      const [txBlockResp, latestBlockResp] = await Promise.all([
        consensusTimestamp
          ? HEDERA_API.get('/api/v1/blocks', {
              params: {
                timestamp: `lte:${consensusTimestamp}`,
                order: 'desc',
                limit: 1,
              },
            }).catch(() => null)
          : Promise.resolve(null),
        HEDERA_API.get('/api/v1/blocks', {
          params: {order: 'desc', limit: 1},
        }).catch(() => null),
      ]);
      const blockNumber = txBlockResp?.data?.blocks?.[0]?.number ?? null;
      const latestBlockNumber =
        latestBlockResp?.data?.blocks?.[0]?.number ?? null;
      const confirmations =
        blockNumber !== null && latestBlockNumber !== null
          ? latestBlockNumber - blockNumber
          : null;
      return {
        status: resp?.status,
        data: {...tx, blockNumber, confirmations},
      };
    } catch (e) {
      console.error('Error in HEDERA getTransaction', e);
      return {status: null, data: null};
    }
  },
};
