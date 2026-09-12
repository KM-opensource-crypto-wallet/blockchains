import {createProviderClient} from 'dok-wallet-blockchain-networks/config/providerClient';
import {
  buildScanProxyUrl,
  rpcSessionAdapter,
} from 'dok-wallet-blockchain-networks/rpcUrls/rpcSession';
import {CHAIN_CONFIG} from 'dok-wallet-blockchain-networks/config/config';

describe('createProviderClient', () => {
  it('builds a proxied scan client with session adapter and scan typing', () => {
    const client = createProviderClient({proxy: 'tron', scan: true});
    expect(client.defaults.baseURL).toBe(buildScanProxyUrl('tron'));
    expect(client.defaults.adapter).toBe(rpcSessionAdapter);
    expect(client.defaults.headers['x-rpc-type']).toBe('scan');
    expect(client.defaults.headers['Content-Type']).toBe('application/json');
  });

  it('builds a direct client with no adapter and no scan typing', () => {
    const client = createProviderClient({baseURL: 'https://direct.example'});
    expect(client.defaults.baseURL).toBe('https://direct.example');
    expect(client.defaults.adapter).not.toBe(rpcSessionAdapter);
    expect(client.defaults.headers['x-rpc-type']).toBeUndefined();
    expect(client.defaults.timeout).toBe(30000);
  });

  it('rejects proxy combined with baseURL', () => {
    expect(() =>
      createProviderClient({proxy: 'tron', baseURL: 'https://direct.example'}),
    ).toThrow('either proxy or baseURL');
  });

  it('rejects scan typing on a direct client', () => {
    expect(() =>
      createProviderClient({baseURL: 'https://direct.example', scan: true}),
    ).toThrow('scan typing only applies to proxied clients');
  });

  it('robinhood is flagged premium on mainnet', () => {
    expect(CHAIN_CONFIG.robinhood.premium.mainnet).toBe(true);
  });
});
