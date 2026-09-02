import {PolkadotHttpProvider} from 'dok-wallet-blockchain-networks/rpcUrls/polkadotHttpProvider';

jest.mock('dok-wallet-blockchain-networks/helper', () => ({
  customFetchWithTimeout: jest.fn(),
}));

jest.mock('dok-wallet-blockchain-networks/rpcUrls/rpcSession', () => ({
  withRpcSessionFetch: jest.fn(f => f),
}));

const {
  customFetchWithTimeout,
} = require('dok-wallet-blockchain-networks/helper');
const {
  withRpcSessionFetch,
} = require('dok-wallet-blockchain-networks/rpcUrls/rpcSession');

const ENDPOINT = 'https://api.test/rpc/polkadot';

const jsonResponse = (
  payload,
  {ok = true, status = 200, statusText = 'OK'} = {},
) => ({
  ok,
  status,
  statusText,
  text: jest.fn().mockResolvedValue(JSON.stringify(payload)),
});

describe('PolkadotHttpProvider', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('wraps customFetchWithTimeout with the RPC session fetch by default', () => {
    expect(new PolkadotHttpProvider(ENDPOINT)).toBeInstanceOf(
      PolkadotHttpProvider,
    );
    expect(withRpcSessionFetch).toHaveBeenCalledWith(customFetchWithTimeout);
  });

  it('POSTs a JSON-RPC request to the endpoint and resolves the result', async () => {
    const fetchImpl = jest
      .fn()
      .mockResolvedValue(
        jsonResponse({jsonrpc: '2.0', id: 1, result: 'Polkadot Asset Hub'}),
      );
    const provider = new PolkadotHttpProvider(ENDPOINT, fetchImpl);

    await expect(provider.send('system_chain', [])).resolves.toBe(
      'Polkadot Asset Hub',
    );

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, options] = fetchImpl.mock.calls[0];
    expect(url).toBe(ENDPOINT);
    expect(options.method).toBe('POST');
    expect(options.headers).toEqual({
      Accept: 'application/json',
      'Content-Type': 'application/json',
    });
    expect(options.headers['Content-Length']).toBeUndefined();
    expect(JSON.parse(options.body)).toEqual({
      id: 1,
      jsonrpc: '2.0',
      method: 'system_chain',
      params: [],
    });
  });

  it('increments the JSON-RPC id across calls', async () => {
    const fetchImpl = jest.fn(async (_url, {body}) => {
      const {id} = JSON.parse(body);
      return jsonResponse({jsonrpc: '2.0', id, result: id});
    });
    const provider = new PolkadotHttpProvider(ENDPOINT, fetchImpl);

    await expect(provider.send('system_chain', [])).resolves.toBe(1);
    await expect(provider.send('system_chain', [])).resolves.toBe(2);
  });

  it('rejects on a non-OK response and names the failed request', async () => {
    const fetchImpl = jest
      .fn()
      .mockResolvedValue(
        jsonResponse(
          {},
          {ok: false, status: 429, statusText: 'Too Many Requests'},
        ),
      );
    const provider = new PolkadotHttpProvider(ENDPOINT, fetchImpl);

    await expect(provider.send('state_getMetadata', [])).rejects.toThrow(
      /^\[429\]: Too Many Requests\nFailed HTTP Request: .*state_getMetadata/,
    );
    expect(provider.stats.total.errors).toBe(1);
  });

  it('rejects on a JSON-RPC error payload', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(
      jsonResponse({
        jsonrpc: '2.0',
        id: 1,
        error: {code: 1010, message: 'Invalid Transaction'},
      }),
    );
    const provider = new PolkadotHttpProvider(ENDPOINT, fetchImpl);

    await expect(
      provider.send('author_submitExtrinsic', ['0x00']),
    ).rejects.toThrow(/1010: Invalid Transaction/);
  });

  it('exposes the provider surface ApiPromise relies on', async () => {
    const provider = new PolkadotHttpProvider(ENDPOINT, jest.fn());

    expect(provider.hasSubscriptions).toBe(false);
    expect(provider.isConnected).toBe(true);
    expect(provider.isClonable).toBe(true);
    expect(provider.stats).toEqual(
      expect.objectContaining({
        active: expect.any(Object),
        total: expect.any(Object),
      }),
    );
    expect(provider.clone()).toBeInstanceOf(PolkadotHttpProvider);
    expect(typeof provider.on()).toBe('function');
    await expect(provider.connect()).resolves.toBeUndefined();
    await expect(provider.disconnect()).resolves.toBeUndefined();
    await expect(provider.subscribe()).rejects.toThrow(/subscriptions/);
    await expect(provider.unsubscribe()).rejects.toThrow(/subscriptions/);
  });
});
