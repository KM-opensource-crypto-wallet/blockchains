import {PolkadotScanApi} from 'dok-wallet-blockchain-networks/config/polkadotScan';

// Subscan for Polkadot Asset Hub, reached through the `polkadot` scan proxy
// (the worker holds the API key and the upstream host). Asset Hub's v2
// `transfers`, `extrinsic` and `metadata` responses have the same shape as the
// relay chain's, so PolkadotChain parses them unchanged; only Asset Hub
// extrinsics exist here (pre-migration relay history is not served).

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
