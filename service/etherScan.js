import {
  EtherScanAPI1,
  EtherScanAPI2,
  EtherScanAPIFree,
} from 'dok-wallet-blockchain-networks/config/etherScan';
import {
  commonRetryFunc,
  convertToSmallAmount,
  isOptionGasFeesChain,
} from '../helper';
import {CHAIN_ID} from '../config/config';

const providers = [EtherScanAPIFree, EtherScanAPI1, EtherScanAPI2];
const providersName = ['Free EtherScan', 'Etherscan1', 'Etherscan2'];

const FREE_NOT_SUPPORTED_CHAINS = [
  'ethereum',
  'binance_smart_chain',
  'polygon',
  'base',
  'gnosis',
];
export const EtherScan = {
  getTransactions: async ({address, contractAddress = null, chain_name}) =>
    commonRetryFunc(
      providers,
      async provider => {
        try {
          const resp = await provider.get('/api', {
            params: {
              chainid: CHAIN_ID[chain_name],
              module: 'account',
              action: contractAddress ? 'tokentx' : 'txlist',
              contractaddress: contractAddress,
              address,
              startblock: 0,
              endblock: 99999999,
              page: 1,
              offset: 20,
              sortby: 'timeStamp',
              sort: 'desc',
            },
          });
          if (resp?.data?.status === '0') {
            throw new Error(resp?.data?.result);
          }
          return {status: resp?.status, data: resp?.data?.result};
        } catch (e) {
          console.error(
            `Error in get ether transactions for chain: ${chain_name}`,
            e,
          );
          throw e;
        }
      },
      [],
      providersName,
      FREE_NOT_SUPPORTED_CHAINS.includes(chain_name) ? [0] : null,
    ),
  getTransactionFeeData: async ({chain_name}) =>
    commonRetryFunc(
      providers,
      async provider => {
        try {
          const isOptionGasFees = isOptionGasFeesChain(chain_name);
          const payload = {
            chainid: CHAIN_ID[chain_name],
            module: isOptionGasFees ? 'gastracker' : 'proxy',
            action: isOptionGasFees ? 'gasoracle' : 'eth_gasPrice',
          };
          const resp = await provider.get('/api', {
            params: payload,
          });
          if (resp?.data?.status === '0') {
            throw new Error(resp?.data?.result);
          }
          const result = resp?.data?.result;
          return {
            status: resp?.status,
            data: isOptionGasFees
              ? convertToSmallAmount(result?.ProposeGasPrice, 9)
              : result,
          };
        } catch (e) {
          console.error(
            `Error in get transaction fees for chain: ${chain_name}`,
            e,
          );
          throw e;
        }
      },
      '0',
      providersName,
    ),
};
