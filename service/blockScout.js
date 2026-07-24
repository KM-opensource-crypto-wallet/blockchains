import {BlockScoutAPI} from 'dok-wallet-blockchain-networks/config/blockScout';
import {CHAIN_ID} from '../config/config';
import {convertToSmallAmount} from '../helper';

export const BlockScout = {
  getTransactions: async ({address, contractAddress, chain_name}) => {
    try {
      const payload = {
        chain_id: CHAIN_ID[chain_name],
        module: 'account',
        action: contractAddress ? 'tokentx' : 'txlist',
        contractaddress: contractAddress,
        address,
        startblock: 0,
        endblock: 99999999,
        page: 1,
        offset: 100,
        sortby: 'timeStamp',
        sort: 'desc',
      };
      const resp = await BlockScoutAPI.get('/v2/api', {
        params: payload,
      });
      if (resp?.data?.status === '0') {
        throw new Error(resp?.data?.result);
      }
      return {status: resp?.status, data: resp?.data?.result};
    } catch (e) {
      console.error(
        `Error in get blockscout transactions for chain: ${chain_name}`,
        e,
      );
    }
  },
  getTransactionFeeData: async ({chain_name}) => {
    try {
      const resp = await BlockScoutAPI.get(
        `/${CHAIN_ID[chain_name]}/api/v2/stats`,
      );
      return {
        status: resp?.status,
        data: convertToSmallAmount(resp?.data?.gas_prices?.average, 9),
      };
    } catch (e) {
      console.error(`Error in get blockscout fees for chain: ${chain_name}`, e);
    }
  },
};
