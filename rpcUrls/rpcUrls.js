import {fetchRpcUrls} from 'dok-wallet-blockchain-networks/service/dokApi';
import {isValidObject} from 'dok-wallet-blockchain-networks/helper';
import {
  CHAIN_CONFIG,
  IS_SANDBOX,
} from 'dok-wallet-blockchain-networks/config/config';
import {buildRpcProxyUrl} from 'dok-wallet-blockchain-networks/rpcUrls/rpcSession';
import dayjs from 'dayjs';

const allRPCUrl = {
  ...Object.fromEntries(
    Object.entries(CHAIN_CONFIG).flatMap(([chain_name, chainConfig]) =>
      Object.entries(chainConfig.rpc_urls ?? {}).map(([name, urls]) => [
        name === 'default' ? chain_name : `${chain_name}_${name}`,
        urls,
      ]),
    ),
  ),
  // Feature flag consumed via getRPCUrl('polygon_blockscout') — not a URL.
  polygon_blockscout: {mainnet: true, testnet: true},
};

const allFreeRpcUrl = Object.fromEntries(
  Object.entries(CHAIN_CONFIG)
    .filter(([, chainConfig]) => chainConfig.free_rpc_urls)
    .map(([chain_name, chainConfig]) => [
      chain_name,
      chainConfig.free_rpc_urls,
    ]),
);

let rpcUrls = {
  url: Object.assign(
    {},
    ...Object.keys(allRPCUrl).map(key => ({
      [key]: allRPCUrl[key][IS_SANDBOX ? 'testnet' : 'mainnet'],
    })),
  ),
  free_url: Object.assign(
    {},
    ...Object.keys(allFreeRpcUrl).map(key => ({
      [key]: allFreeRpcUrl[key][IS_SANDBOX ? 'testnet' : 'mainnet'],
    })),
  ),
};

let lastCallTimeStamp;

export const fetchRPCUrl = async () => {
  try {
    if (
      lastCallTimeStamp &&
      dayjs().diff(dayjs(lastCallTimeStamp), 'minutes') < 9
    ) {
      throw new Error('last call made with 10 minutes');
    }
    lastCallTimeStamp = new Date();

    const resp = await fetchRpcUrls();
    const data = isValidObject(resp?.data) ? resp?.data : {};
    const freeUrl = isValidObject(data?.free_url) ? data?.free_url : {};
    const url = isValidObject(data?.url) ? data?.url : {};
    rpcUrls = {
      url: {
        ...rpcUrls.url,
        ...(Object.keys(url).length > 0 ? url : {}),
      },
      free_url: {
        ...rpcUrls.free_url,
        ...(Object.keys(freeUrl).length > 0 ? freeUrl : {}),
      },
    };
  } catch (e) {
    console.error('Error in fetchRPCUrl', e);
  }
};

export const getRPCUrl = chain_name => {
  const allRpcUrls = rpcUrls?.url;
  return allRpcUrls[chain_name] ?? '';
};

export const getFreeRPCUrl = chain_name => {
  const freeUrl = rpcUrls?.free_url;
  const currentFreeUrls = freeUrl[chain_name];
  return Array.isArray(currentFreeUrls) && currentFreeUrls?.length
    ? currentFreeUrls
    : [rpcUrls?.url[chain_name]];
};

export const getPremiumRPCUrl = chain_name => buildRpcProxyUrl(chain_name);
