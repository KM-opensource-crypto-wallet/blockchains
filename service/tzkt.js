import {TZKTAPI} from 'dok-wallet-blockchain-networks/config/tzkt';

export const Tzkt = {
  getTezosTransactions: async address => {
    try {
      const resp = await TZKTAPI.get(
        `/v1/accounts/${address}/operations?type=transaction&sort=1&limit=20`,
      );
      return {status: resp?.status, data: resp?.data};
    } catch (e) {
      console.error('Error in get getTezosTransaction', e);
    }
  },
};
