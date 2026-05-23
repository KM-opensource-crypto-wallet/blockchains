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
      const [resp, latestBlockResp] = await Promise.all([
        HEDERA_API.get('/api/v1/transactions', {
          params: {
            'account.id': address,
            transactiontype: 'CRYPTOTRANSFER',
            limit: 20,
            order: 'desc',
          },
        }),
        HEDERA_API.get('/api/v1/blocks', {
          params: {order: 'desc', limit: 1},
        }).catch(() => null),
      ]);
      const transactions = resp?.data?.transactions || [];
      const latestBlockNumber =
        latestBlockResp?.data?.blocks?.[0]?.number ?? null;
      const hbarOnly = transactions.filter(
        tx =>
          tx?.transfers?.some(t => t.account === address) &&
          !tx?.token_transfers?.some(t => t.account === address),
      );
      const enriched = await Promise.all(
        hbarOnly.map(async tx => {
          const consensusTimestamp = tx?.consensus_timestamp;
          let blockNumber = null;
          if (consensusTimestamp) {
            const blockResp = await HEDERA_API.get('/api/v1/blocks', {
              params: {
                timestamp: `lte:${consensusTimestamp}`,
                order: 'desc',
                limit: 1,
              },
            }).catch(() => null);
            blockNumber = blockResp?.data?.blocks?.[0]?.number ?? null;
          }
          const confirmations =
            blockNumber !== null && latestBlockNumber !== null
              ? latestBlockNumber - blockNumber
              : null;
          return {...tx, blockNumber, confirmations};
        }),
      );
      return {status: resp?.status, data: enriched};
    } catch (e) {
      console.error('Error in HEDERA getTransactions', e);
      return {status: null, data: []};
    }
  },
  getTransaction: async txHash => {
    try {
      const resp = await HEDERA_API.get(`/api/v1/transactions/${txHash}`);
      const tx = resp?.data?.transactions?.[0];
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
