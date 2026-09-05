import {HEDERA_API} from 'dok-wallet-blockchain-networks/config/Hedera';

const isNotFound = e => e?.response?.status === 404;

// The mirror node accepts `0.0.N`, an EVM address or a long-zero address here.
// A 404 is the normal "no account yet" answer for an unfunded EVM address, so
// it is reported as `data: null` without logging; any other failure throws so
// callers can tell "no account" from "mirror node unreachable".
const fetchAccount = async idOrAddress => {
  try {
    const resp = await HEDERA_API.get(`/api/v1/accounts/${idOrAddress}`, {
      params: {
        limit: 1,
        transactions: false,
      },
    });
    return {status: resp?.status, data: resp?.data ?? null};
  } catch (e) {
    if (isNotFound(e)) {
      return {status: 404, data: null};
    }
    console.error('Error in HEDERA fetchAccount', e);
    throw e;
  }
};

// `GET /transactions/{id}` returns the parent and every child record (the
// CryptoCreate of an auto-created recipient, the CryptoUpdate that completes a
// hollow account, ...) and the children are listed first. Only the parent
// carries the transfer list.
const pickParentRecord = transactions => {
  if (!Array.isArray(transactions) || transactions.length === 0) {
    return null;
  }
  return (
    transactions.find(tx => tx?.nonce === 0) ??
    transactions.find(tx => tx?.name === 'CRYPTOTRANSFER') ??
    transactions[0]
  );
};

export const HEDERA = {
  getAccountInfo: fetchAccount,
  // `0.0.N` for a funded EVM address, null while no account exists yet.
  getAccountByEvmAddress: async evmAddress => {
    const resp = await fetchAccount(evmAddress);
    return resp?.data?.account || null;
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
      const tx = pickParentRecord(resp?.data?.transactions);
      if (!tx) {
        return {status: resp?.status, data: null};
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
      // A transaction the mirror node has not indexed yet 404s; the detail
      // screen polls until it appears.
      if (!isNotFound(e)) {
        console.error('Error in HEDERA getTransaction', e);
      }
      return {status: e?.response?.status ?? null, data: null};
    }
  },
};
