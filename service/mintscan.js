import {COSMOS_REST_API} from 'dok-wallet-blockchain-networks/config/mintscan';

const parseCosmosTransaction = (txResponse, tx) => {
  const msg = tx?.body?.messages?.[0];
  return {
    txHash: txResponse?.txhash,
    success: txResponse?.code === 0,
    amount: msg?.amount?.[0]?.amount ?? '0',
    from: msg?.from_address ?? null,
    to: msg?.to_address ?? null,
    blockNumber: txResponse?.height ?? null,
    timestamp: txResponse?.timestamp,
  };
};

const fetchTxs = (query, limit = 20) =>
  COSMOS_REST_API.get('/cosmos/tx/v1beta1/txs', {
    params: {
      query,
      'pagination.limit': limit,
      order_by: 'ORDER_BY_DESC',
    },
  });

export const CosmosScan = {
  getTransactions: async address => {
    try {
      const [sentResp, receivedResp] = await Promise.all([
        fetchTxs(`message.sender='${address}'`),
        fetchTxs(`transfer.recipient='${address}'`),
      ]);

      const seen = new Set();
      const combined = [];

      const addAll = (txResponses, txs) => {
        (txResponses || []).forEach((txResp, i) => {
          if (!seen.has(txResp.txhash)) {
            seen.add(txResp.txhash);
            combined.push(parseCosmosTransaction(txResp, txs?.[i]));
          }
        });
      };

      addAll(sentResp?.data?.tx_responses, sentResp?.data?.txs);
      addAll(receivedResp?.data?.tx_responses, receivedResp?.data?.txs);

      combined.sort((a, b) => (b.blockNumber || 0) - (a.blockNumber || 0));

      return {status: 200, data: combined.slice(0, 20)};
    } catch (e) {
      console.error('Error in CosmosScan transactions', e);
      return {status: null, data: []};
    }
  },
  getTransaction: async ({txHash}) => {
    try {
      const resp = await COSMOS_REST_API.get(
        `/cosmos/tx/v1beta1/txs/${txHash}`,
      );
      const txResponse = resp?.data?.tx_response;
      const tx = resp?.data?.tx;
      if (!txResponse) {
        return {status: resp?.status, data: null};
      }
      return {
        status: resp?.status,
        data: parseCosmosTransaction(txResponse, tx),
      };
    } catch (e) {
      console.error('Error in CosmosScan getTransaction', e);
      return {status: e?.response?.status ?? null, data: null};
    }
  },
};
