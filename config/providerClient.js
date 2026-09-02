import axios from 'axios';
import {
  buildScanProxyUrl,
  rpcSessionAdapter,
} from 'dok-wallet-blockchain-networks/rpcUrls/rpcSession';

/**
 * Single constructor for every provider HTTP client in config/.
 * Flipping a provider between direct and proxied, or changing its URL,
 * is a one-line change in that provider's config file:
 *   direct:  createProviderClient({baseURL: config.SOME_BASE_URL})
 *   proxied: createProviderClient({proxy: 'name', scan: true})
 *
 * NOT built with this factory (they own their HTTP client or must not
 * carry session headers):
 *   - config/dokApi.js          mints the rpc sessions; adding the adapter
 *                               would create an import cycle through
 *                               rpcSession.js → service/dokApi
 *   - config/moralis.js         Moralis SDK owns its axios; hooked via
 *                               installRpcSessionForMoralis()
 *   - config/electrumServers.js host/port data, not an HTTP client
 *   - Blockfrost, TronWeb, ethers FetchRequest, TonClient, Solana fetch —
 *     see their adapter hooks in cryptoChain/chains/*
 *
 * @param {string}  [proxy]    Worker route name; baseURL becomes
 *                             `${DOK_WALLET_BASE_URL}/rpc/<name>` and
 *                             rpcSessionAdapter is attached.
 * @param {boolean} [scan]     Type proxied requests as explorer traffic
 *                             (`x-rpc-type: scan`). Requires proxy.
 * @param {string}  [baseURL]  Direct provider URL (no adapter, no session).
 */
export const createProviderClient = ({
  proxy,
  scan,
  baseURL,
  headers,
  timeout = 30000,
  axiosOptions,
}) => {
  if (proxy && baseURL) {
    throw new Error(
      'createProviderClient: pass either proxy or baseURL, not both',
    );
  }
  if (scan && !proxy) {
    throw new Error(
      'createProviderClient: scan typing only applies to proxied clients',
    );
  }
  return axios.create({
    baseURL: proxy ? buildScanProxyUrl(proxy) : baseURL,
    headers: {
      'Content-Type': 'application/json',
      ...(scan ? {'x-rpc-type': 'scan'} : {}),
      ...headers,
    },
    ...(proxy ? {adapter: rpcSessionAdapter} : {}),
    timeout,
    ...axiosOptions,
  });
};
