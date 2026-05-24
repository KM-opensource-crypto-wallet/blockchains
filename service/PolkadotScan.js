import {PolkadotScanApi} from 'dok-wallet-blockchain-networks/config/polkadotScan';

export const PolkadotScan = {
  getTransactions: async (address, contractaddress = null) => {
    try {
      const resp = await PolkadotScanApi.post('/api/v2/scan/transfers', {
        address: address,
        row: 20,
      });

      return {status: resp?.status, data: resp?.data?.data?.transfers};
    } catch (e) {
      console.error('Error in get transaction PolkadotScan', e);
    }
  },
  getTransaction: async txHash => {
    try {
      const resp = await PolkadotScanApi.post('/api/scan/extrinsic', {
        hash: txHash,
      });
      return {status: resp?.status, data: resp?.data?.data};
    } catch (e) {
      console.error('Error in getTransaction PolkadotScan', e);
      return {data: null};
    }
  },
  getLatestBlockNumber: async () => {
    try {
      const resp = await PolkadotScanApi.post('/api/scan/metadata', {});
      return resp?.data?.data?.blockNum ?? null;
    } catch (e) {
      console.error('Error in getLatestBlockNumber PolkadotScan', e);
      return null;
    }
  },
};
