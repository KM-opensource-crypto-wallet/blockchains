import {ElectrumClient} from 'dok-wallet-blockchain-networks/service/electrum';

jest.mock('dok-wallet-blockchain-networks/config/config', () => ({
  IS_SANDBOX: false,
  isWeb: false,
  config: {},
}));

jest.mock('dok-wallet-blockchain-networks/service/blockChair', () => ({
  parseBlockchainTransactions: jest.fn(() => []),
}));

/**
 * In-memory Electrum server over the injectable socketFactory: records every
 * batch written, tracks how many were in flight at once, and answers each
 * request by echoing its first param (or erroring when the param is 'boom').
 */
const createFakeClient = () => {
  const server = {batches: [], inflight: 0, maxInflight: 0};
  const handlers = {};
  const deliver = response => {
    (handlers.data || []).forEach(fn => fn(JSON.stringify(response) + '\n'));
  };
  const answer = item =>
    item.params?.[0] === 'boom'
      ? {jsonrpc: '2.0', id: item.id, error: {message: 'boom'}}
      : {jsonrpc: '2.0', id: item.id, result: item.params?.[0]};

  const socket = {
    on: (event, fn) => {
      handlers[event] = handlers[event] || [];
      handlers[event].push(fn);
    },
    write: line => {
      const payload = JSON.parse(line);
      if (!Array.isArray(payload)) {
        // server.version handshake
        setImmediate(() =>
          deliver([{jsonrpc: '2.0', id: payload.id, result: ['fake', '1.4']}]),
        );
        return;
      }
      server.batches.push(payload);
      server.inflight += 1;
      server.maxInflight = Math.max(server.maxInflight, server.inflight);
      setImmediate(() => {
        server.inflight -= 1;
        deliver(payload.map(answer));
      });
    },
    destroy: () => {},
  };

  const client = new ElectrumClient({
    servers: [{host: 'fake', port: 1}],
    socketFactory: (_srv, onConnect) => {
      setImmediate(onConnect);
      return socket;
    },
  });
  return {client, server};
};

const makeCalls = (count, boomAt = -1) =>
  Array.from({length: count}, (_v, i) => ({
    method: 'blockchain.scripthash.get_balance',
    params: [i === boomAt ? 'boom' : `addr-${i}`],
  }));

describe('ElectrumClient.batchRequestChunked', () => {
  it('returns no results for no calls without touching the socket', async () => {
    const {client, server} = createFakeClient();
    await expect(client.batchRequestChunked([])).resolves.toEqual([]);
    expect(server.batches).toHaveLength(0);
  });

  it('keeps results in call order across chunks', async () => {
    const {client, server} = createFakeClient();
    const calls = makeCalls(250);
    const results = await client.batchRequestChunked(calls, 100);
    expect(results).toEqual(calls.map(call => call.params[0]));
    expect(server.batches.map(batch => batch.length)).toEqual([100, 100, 50]);
  });

  it('overlaps chunks instead of serializing them', async () => {
    const {client, server} = createFakeClient();
    await client.batchRequestChunked(makeCalls(250), 100);
    // 3 chunks, all in flight together -- the sequential version peaked at 1.
    expect(server.maxInflight).toBe(3);
  });

  it('caps the number of chunks in flight at once', async () => {
    const {client, server} = createFakeClient();
    const calls = makeCalls(600);
    const results = await client.batchRequestChunked(calls, 100);
    expect(results).toEqual(calls.map(call => call.params[0]));
    expect(server.batches).toHaveLength(6);
    expect(server.maxInflight).toBe(4);
  });

  it('propagates a chunk error and stops claiming unstarted chunks', async () => {
    const {client, server} = createFakeClient();
    await expect(
      client.batchRequestChunked(makeCalls(600, 0), 100),
    ).rejects.toThrow('boom');
    // Chunks 0-3 were already in flight; 4 and 5 were never written.
    expect(server.batches).toHaveLength(4);
  });

  it('still settles per-call errors when settleErrors is set', async () => {
    const {client} = createFakeClient();
    const calls = makeCalls(250, 150);
    const results = await client.batchRequestChunked(calls, 100, {
      settleErrors: true,
    });
    expect(results).toHaveLength(250);
    expect(results[150].electrumError).toBeInstanceOf(Error);
    expect(results[149]).toBe('addr-149');
    expect(results[151]).toBe('addr-151');
  });
});
