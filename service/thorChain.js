import axios from 'axios';

export const ThorChainService = {
  getThorBalance: async address => {
    try {
      const resp = await axios.get(
        `https://midgard.ninerealms.com/v2/balance/${address}`,
      );
      const coins = resp?.data?.coins;
      const runeBalance =
        coins?.find(item => item.asset === 'THOR.RUNE')?.amount || '0';
      return {status: resp?.status, data: runeBalance};
    } catch (e) {
      console.error('Error in getThorBalance', e);
    }
  },
  getBaseThorFee: async () => {
    try {
      const resp = await axios.get(
        'https://thornode.ninerealms.com/thorchain/constants',
      );
      return resp?.data?.int_64_values?.NativeTransactionFee;
    } catch (e) {
      console.error('Error in getThorFee', e);
    }
  },
  getThorTransactions: async address => {
    try {
      const resp = await axios.get(getThorTransactionUrl(address));
      const allTransactions = resp.data.actions;
      return allTransactions.map(item => {
        return {
          txhash: item?.in?.[0]?.txID,
          from: item?.in?.[0]?.address,
          to: item?.out?.[0]?.address,
          amount: item?.in?.[0]?.coins?.find?.(
            subItem => subItem.asset === 'THOR.RUNE',
          )?.amount,
          timestamp: item?.date?.slice(0, -6),
          status: item?.status?.toUpperCase(),
        };
      });
    } catch (e) {
      console.error('Error in getThortransaction', e);
      return [];
    }
  },
  getAccountInfo: async address => {
    try {
      // Legacy Cosmos LCD path — gRPC-gateway (/cosmos/auth/v1beta1) is not enabled on thornode
      const resp = await axios.get(
        `https://thornode.ninerealms.com/auth/accounts/${address}`,
      );
      const account = resp?.data?.result?.value ?? resp?.data?.account;
      return {
        accountNumber: parseInt(account?.account_number ?? '0', 10),
        sequence: parseInt(account?.sequence ?? '0', 10),
      };
    } catch (e) {
      // 404 = new account that has never transacted, safe to use defaults
      if (e?.response?.status === 404) {
        return {accountNumber: 0, sequence: 0};
      }
      console.error('Error in getAccountInfo', e);
      throw e;
    }
  },
  broadcastTx: async txBytes => {
    // Tendermint RPC GET endpoint — avoids the JSON-RPC POST that rpc.ninerealms.com serves as HTML
    const txHex = Array.from(txBytes)
      .map(b => b.toString(16).padStart(2, '0'))
      .join('');
    const resp = await axios.get(
      `https://rpc.ninerealms.com/broadcast_tx_sync?tx=0x${txHex}`,
    );
    const result = resp?.data?.result;
    if (result?.code !== 0) {
      throw new Error(
        result?.log || result?.raw_log || 'Transaction broadcast failed',
      );
    }
    return result?.hash;
  },
  getTransactionStatus: async txHash => {
    try {
      const resp = await axios.get(
        `https://midgard.ninerealms.com/v2/actions?txid=${txHash}`,
      );
      return !!resp?.data?.actions?.length;
    } catch (e) {
      console.error('Error in get transaction status', e);
      return false;
    }
  },
};
const getThorTransactionUrl = address => {
  return `https://midgard.ninerealms.com/v2/actions?address=${address}&asset=THOR.RUNE&limit=20`;
};
