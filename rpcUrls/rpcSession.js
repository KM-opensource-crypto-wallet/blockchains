import axios from 'axios';
import {fetchRpcSession} from 'dok-wallet-blockchain-networks/service/dokApi';
import {
  CHAIN_CONFIG,
  config,
  IS_SANDBOX,
  SCAN_PROXY_SERVICES,
} from 'dok-wallet-blockchain-networks/config/config';

const PREMIUM_CHAINS = {
  mainnet: Object.keys(CHAIN_CONFIG).filter(
    chain_name => CHAIN_CONFIG[chain_name].premium?.mainnet,
  ),
  testnet: Object.keys(CHAIN_CONFIG).filter(
    chain_name => CHAIN_CONFIG[chain_name].premium?.testnet,
  ),
};

const SCAN_ONLY_CHAINS = [
  ...Object.keys(CHAIN_CONFIG).filter(
    chain_name => CHAIN_CONFIG[chain_name].scan_only,
  ),
  ...SCAN_PROXY_SERVICES,
];

const NETWORK = IS_SANDBOX ? 'testnet' : 'mainnet';

let sessionToken = '';
let inFlightRequest = null;

const getProxyBaseUrl = () =>
  config.DOK_WALLET_BASE_URL?.replace(/\/$/, '') || '';

export const buildRpcProxyUrl = chain_name =>
  PREMIUM_CHAINS[NETWORK].includes(chain_name)
    ? buildScanProxyUrl(chain_name)
    : '';

export const buildScanProxyUrl = name => {
  const baseUrl = getProxyBaseUrl();
  return baseUrl ? `${baseUrl}/rpc/${name}` : '';
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

// attaches the axios interceptor for moralis
let moralisInterceptorInstalled = false;
export const installRpcSessionForMoralis = () => {
  if (moralisInterceptorInstalled) {
    return;
  }
  moralisInterceptorInstalled = true;
  const moralisBases = [
    buildScanProxyUrl('moralis'),
    buildScanProxyUrl('moralis_solana'),
  ].filter(Boolean);
  axios.interceptors.request.use(requestConfig => {
    const url = `${requestConfig.baseURL ?? ''}${requestConfig.url ?? ''}`;
    if (moralisBases.some(base => url.startsWith(base))) {
      requestConfig.adapter = rpcSessionAdapter;
    }
    return requestConfig;
  });
};

const isScanProxyUrl = url =>
  SCAN_ONLY_CHAINS.some(chain =>
    url.startsWith(`${getProxyBaseUrl()}/rpc/${chain}`),
  );

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
    if (isProxied && isScanProxyUrl(url)) {
      requestConfig.headers.set('x-rpc-type', 'scan');
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
