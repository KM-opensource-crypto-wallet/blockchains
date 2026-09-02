import {RpcCoder} from '@polkadot/rpc-provider/coder';
import {customFetchWithTimeout} from 'dok-wallet-blockchain-networks/helper';
import {withRpcSessionFetch} from 'dok-wallet-blockchain-networks/rpcUrls/rpcSession';

const ERROR_SUBSCRIBE =
  'HTTP Provider does not have subscriptions, use WebSockets instead';

/**
 * @polkadot/api ProviderInterface used for every Polkadot HTTP endpoint.
 *
 * @polkadot/rpc-provider's HttpProvider reads `fetch` from @polkadot/x-fetch
 * at module load and only accepts static headers, so it cannot attach the
 * 60-second x-rpc-session token or replay on 401. This provider does the same
 * JSON-RPC-over-POST work but sends through withRpcSessionFetch (a passthrough
 * for non-proxy URLs), with customFetchWithTimeout's 20s timeout, no manual
 * Content-Length and no result cache. One transport for proxy and public URLs
 * keeps behaviour identical across endpoints.
 *
 * No subscriptions: ApiPromise then routes storage reads through
 * state_getStorage / state_queryStorageAt and never calls `on`.
 */
export class PolkadotHttpProvider {
  #coder;
  #endpoint;
  #fetch;
  #stats;

  constructor(
    endpoint,
    fetchImpl = withRpcSessionFetch(customFetchWithTimeout),
  ) {
    this.#coder = new RpcCoder();
    this.#endpoint = endpoint;
    this.#fetch = fetchImpl;
    this.#stats = {
      active: {requests: 0, subscriptions: 0},
      total: {
        bytesRecv: 0,
        bytesSent: 0,
        cached: 0,
        errors: 0,
        requests: 0,
        subscriptions: 0,
        timeout: 0,
      },
    };
  }

  get hasSubscriptions() {
    return false;
  }

  get isClonable() {
    return true;
  }

  get isConnected() {
    return true;
  }

  get stats() {
    return this.#stats;
  }

  clone() {
    return new PolkadotHttpProvider(this.#endpoint, this.#fetch);
  }

  async connect() {
    // noop: HTTP is stateless
  }

  async disconnect() {
    // noop: HTTP is stateless
  }

  on() {
    return () => {};
  }

  async send(method, params) {
    this.#stats.total.requests++;
    this.#stats.active.requests++;
    const [, body] = this.#coder.encodeJson(method, params);
    this.#stats.total.bytesSent += body.length;
    try {
      // No Content-Length: React Native's fetch computes it, and a mismatch
      // is worse than an absent header.
      const response = await this.#fetch(this.#endpoint, {
        body,
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
        },
        method: 'POST',
      });
      if (!response.ok) {
        throw new Error(`[${response.status}]: ${response.statusText}`);
      }
      const result = await response.text();
      this.#stats.total.bytesRecv += result.length;
      const decoded = this.#coder.decodeResponse(JSON.parse(result));
      this.#stats.active.requests--;
      return decoded;
    } catch (e) {
      this.#stats.active.requests--;
      this.#stats.total.errors++;
      // Same convention as HttpProvider: keep the failing request in the
      // message so logs say which call died.
      e.message = `${e.message}\nFailed HTTP Request: ${JSON.stringify({
        method,
        params,
      })}`;
      throw e;
    }
  }

  async subscribe() {
    throw new Error(ERROR_SUBSCRIBE);
  }

  async unsubscribe() {
    throw new Error(ERROR_SUBSCRIBE);
  }
}
