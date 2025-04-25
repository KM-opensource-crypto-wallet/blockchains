import axios from 'axios';
import BigNumber from 'bignumber.js';
import {isEVMChain} from 'dok-wallet-blockchain-networks/helper';

export const API_REQUEST = axios.create({
  headers: {
    'Content-Type': 'application/json',
  },
  timeout: 5000,
});

export async function compareAndSortRpcUrls(freeRpcUrls) {
  const allKeys = Object.keys(freeRpcUrls);
  const finalObj = {};
  await Promise.all(
    allKeys.map(async item => {
      const urls = freeRpcUrls[item];
      if (isEVMChain(item) && Array.isArray(urls)) {
        finalObj[item] = await getEthBlockByRPCUrls(urls);
      } else {
        finalObj[item] = urls;
      }
    }),
  );
  return finalObj;
}

export async function getEthBlockByRPCUrls(urls) {
  try {
    const urlsWithTime = await Promise.all(
      urls.map(async url => {
        try {
          const start = Date.now();
          const resp = await API_REQUEST.post(url, {
            jsonrpc: '2.0',
            method: 'eth_getBlockByNumber',
            params: ['latest', false],
            id: 1,
          });
          const responseTime = Date.now() - start;
          return {
            url,
            responseTime,
            blockNumber: new BigNumber(resp?.data?.result?.number).toString(),
          };
        } catch (e) {
          console.error('Error in EVM rpc url : ', url, 'Errors: ', e);
          return {url: null};
        }
      }),
    );
    const filterUrl = urlsWithTime.filter(item => item.url);
    if (filterUrl.length) {
      filterUrl.sort((a, b) => {
        const aBlock = Number(a?.blockNumber);
        const bBlock = Number(b?.blockNumber);
        if (aBlock === bBlock) {
          return a.responseTime - b.responseTime;
        }
        return bBlock - aBlock;
      });
      return filterUrl.map(item => item.url);
    }
    return urls;
  } catch (e) {
    return urls;
  }
}
