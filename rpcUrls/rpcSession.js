import axios from 'axios';
import {fetchRpcSession} from 'dok-wallet-blockchain-networks/service/dokApi';
import {config, IS_SANDBOX} from 'dok-wallet-blockchain-networks/config/config';

const PREMIUM_CHAINS = {
  mainnet: [
    'ethereum',
    'binance_smart_chain',
    'polygon',
    'base',
    'arbitrum',
    'optimism',
    'optimism_binance_smart_chain',
    'avalanche',
    'gnosis',
    'linea',
    'ink',
    'sei',
    'tron',
    'ton',
    'solana',
  ],
  testnet: ['tron', 'ton'],
};

const NETWORK = IS_SANDBOX ? 'testnet' : 'mainnet';

let sessionToken = '';
let inFlightRequest = null;

const getProxyBaseUrl = () =>
  config.DOK_WALLET_BASE_URL?.replace(/\/$/, '') || '';

export const buildRpcProxyUrl = chain_name => {
  const baseUrl = getProxyBaseUrl();
  if (!baseUrl || !PREMIUM_CHAINS[NETWORK].includes(chain_name)) {
    return '';
  }
  return `${baseUrl}/rpc/${chain_name}`;
};

export const isRpcProxyUrl = url => {
  const baseUrl = getProxyBaseUrl();
  return (
    !!baseUrl && typeof url === 'string' && url.startsWith(`${baseUrl}/rpc/`)
  );
};

export const refreshRpcSession = () => {
  if (!inFlightRequest) {
    inFlightRequest = fetchRpcSession()
      .then(data => {
        sessionToken = data?.token || '';
        return sessionToken;
      })
      .catch(e => {
        console.error('Error in fetchRpcSession', e);
        return '';
      })
      .finally(() => {
        inFlightRequest = null;
      });
  }
  return inFlightRequest;
};

export const getRpcSessionHeaders = async url => {
  if (!isRpcProxyUrl(url)) {
    return null;
  }
  const token = sessionToken || (await refreshRpcSession());
  return token ? {'x-rpc-session': token, 'x-rpc-network': NETWORK} : null;
};

export const refreshSessionForReplay = async sentToken => {
  if (sessionToken && sessionToken !== sentToken) {
    return sessionToken;
  }
  const freshToken = await refreshRpcSession();
  return freshToken && freshToken !== sentToken ? freshToken : '';
};

// Solana chain uses fetch
export const withRpcSessionFetch =
  baseFetch =>
  async (url, options = {}) => {
    if (!isRpcProxyUrl(url)) {
      return baseFetch(url, options);
    }
    const send = extra =>
      baseFetch(url, {
        ...options,
        headers: {...(options.headers || {}), ...(extra || {})},
      });
    const sessionHeaders = await getRpcSessionHeaders(url);
    const response = await send(sessionHeaders);
    if (response.status !== 401) {
      return response;
    }
    const freshToken = await refreshSessionForReplay(
      sessionHeaders?.['x-rpc-session'],
    );
    return freshToken
      ? send({'x-rpc-session': freshToken, 'x-rpc-network': NETWORK})
      : response;
  };

export const rpcSessionAdapter = async requestConfig => {
  const url = `${requestConfig.baseURL ?? ''}${requestConfig.url ?? ''}`;
  const isProxied = isRpcProxyUrl(url);

  const dispatch = async () => {
    const sessionHeaders = await getRpcSessionHeaders(url);
    if (sessionHeaders) {
      Object.entries(sessionHeaders).forEach(([key, value]) =>
        requestConfig.headers.set(key, value),
      );
    }
    return axios.getAdapter(axios.defaults.adapter)(requestConfig);
  };

  try {
    return await dispatch();
  } catch (e) {
    if (e?.response?.status === 401 && isProxied) {
      const sentToken = requestConfig.headers.get('x-rpc-session');
      if (await refreshSessionForReplay(sentToken)) {
        return dispatch();
      }
    }
    throw e;
  }
};
