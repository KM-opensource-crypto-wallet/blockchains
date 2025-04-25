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
};
