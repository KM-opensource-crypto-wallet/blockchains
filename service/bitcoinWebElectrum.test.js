/* global AbortSignal */
import {callWebElectrum} from 'dok-wallet-blockchain-networks/service/bitcoinWebElectrum';

const jsonResponse = (body, {ok = true, status = 200} = {}) => ({
  ok,
  status,
  json: async () => body,
});

// Resolves/rejects only when the request's signal aborts, standing in for a
// bridge that accepts the request and then never answers.
const hangingFetch = () =>
  jest.fn(
    (_url, options) =>
      new Promise((_resolve, reject) => {
        options.signal.addEventListener('abort', () =>
          reject(new Error('The user aborted a request.')),
        );
      }),
  );

afterEach(() => {
  jest.useRealTimers();
  delete global.fetch;
});

describe('callWebElectrum timeout', () => {
  it('rejects a hung request so the caller can fall back', async () => {
    jest.useFakeTimers();
    global.fetch = hangingFetch();

    const promise = callWebElectrum('balances', {derive_addresses: []});
    // Without the timeout this promise never settles at all.
    jest.advanceTimersByTime(30000);

    await expect(promise).rejects.toThrow(
      'web electrum balances timed out after 30000ms',
    );
  });

  it('passes an abort signal to fetch', async () => {
    global.fetch = jest.fn(async () => jsonResponse({ok: true, result: {}}));
    await callWebElectrum('utxo', {});
    expect(global.fetch.mock.calls[0][1].signal).toBeInstanceOf(AbortSignal);
  });

  it('does not leave the abort timer pending after success', async () => {
    jest.useFakeTimers();
    global.fetch = jest.fn(async () => jsonResponse({ok: true, result: {}}));

    await callWebElectrum('utxo', {});

    expect(jest.getTimerCount()).toBe(0);
  });

  it('does not leave the abort timer pending after failure', async () => {
    jest.useFakeTimers();
    global.fetch = jest.fn(async () => {
      throw new Error('network down');
    });

    await expect(callWebElectrum('utxo', {})).rejects.toThrow('network down');
    expect(jest.getTimerCount()).toBe(0);
  });
});

describe('callWebElectrum preserved behaviour', () => {
  it('surfaces the server error message', async () => {
    global.fetch = jest.fn(async () =>
      jsonResponse({ok: false, error: 'electrum unreachable'}),
    );
    await expect(callWebElectrum('balances', {})).rejects.toThrow(
      'electrum unreachable',
    );
  });

  it('falls back to the status code when there is no error body', async () => {
    global.fetch = jest.fn(async () =>
      jsonResponse(null, {ok: false, status: 502}),
    );
    await expect(callWebElectrum('balances', {})).rejects.toThrow(
      'web electrum balances failed (502)',
    );
  });

  it('strips private keys from the request and re-attaches them by address', async () => {
    global.fetch = jest.fn(async () =>
      jsonResponse({
        ok: true,
        result: {
          data: {
            totalBalance: '10',
            deriveAddresses: [{address: 'addr-1', balance: '10'}],
          },
        },
      }),
    );

    const result = await callWebElectrum('balances', {
      derive_addresses: [{address: 'addr-1', privateKey: 'secret-1'}],
    });

    // The key must never reach the server...
    const sent = JSON.parse(global.fetch.mock.calls[0][1].body);
    expect(sent.payload.derive_addresses).toEqual([{address: 'addr-1'}]);
    // ...but must come back for downstream signing.
    expect(result.data.deriveAddresses).toEqual([
      {address: 'addr-1', balance: '10', privateKey: 'secret-1'},
    ]);
  });

  it('re-attaches private keys by outpoint for txdetails', async () => {
    global.fetch = jest.fn(async () =>
      jsonResponse({
        ok: true,
        result: {data: [{txid: 'tx-1', vout: 0, value: 5}]},
      }),
    );

    const result = await callWebElectrum('txdetails', {
      transaction_data: [{txid: 'tx-1', vout: 0, privateKey: 'secret-2'}],
    });

    const sent = JSON.parse(global.fetch.mock.calls[0][1].body);
    expect(sent.payload.transaction_data).toEqual([{txid: 'tx-1', vout: 0}]);
    expect(result.data).toEqual([
      {txid: 'tx-1', vout: 0, value: 5, privateKey: 'secret-2'},
    ]);
  });
});
