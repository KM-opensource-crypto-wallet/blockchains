import {
  getAddressDetailsUrl,
  getExplorerTxUrl,
} from 'dok-wallet-blockchain-networks/helper';
import {config} from 'dok-wallet-blockchain-networks/config/config';

jest.mock('utils/common', () => ({APP_VERSION: '9.9.9'}));
// helper/index.js pulls the RPC session layer (uuid ESM, DokApi); none of it
// is exercised here.
jest.mock('dok-wallet-blockchain-networks/rpcUrls/rpcUrls', () => ({
  getRPCUrl: jest.fn(),
}));
jest.mock('dok-wallet-blockchain-networks/rpcUrls/rpcSession', () => ({
  rpcSessionAdapter: jest.fn(),
}));

// All bitcoin address types share one explorer; only `bitcoin` carries the
// `scan` config, so the variants must resolve to it.
const VARIANTS = ['bitcoin_segwit', 'bitcoin_legacy', 'bitcoin_taproot'];

describe('bitcoin address-type explorer links', () => {
  it.each(VARIANTS)('%s transaction links match bitcoin', chain_name => {
    const expected = getExplorerTxUrl('bitcoin', 'deadbeef');
    expect(expected).toContain('/tx/deadbeef');
    expect(getExplorerTxUrl(chain_name, 'deadbeef')).toBe(expected);
  });

  it.each(VARIANTS)(
    '%s address links open the bitcoin explorer',
    chain_name => {
      expect(getAddressDetailsUrl(chain_name, 'coin', 'bc1pxyz')).toBe(
        `${config.BITCOIN_SCAN_URL}/address/bc1pxyz`,
      );
    },
  );

  it('leaves other chains untouched', () => {
    expect(getExplorerTxUrl('litecoin', 'abc')).toContain('litecoin');
    expect(getAddressDetailsUrl('bitcoin_cash', 'coin', 'q')).toContain(
      config.BITCOIN_CASH_SCAN_URL,
    );
  });
});
