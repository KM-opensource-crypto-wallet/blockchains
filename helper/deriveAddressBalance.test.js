import {formatDeriveAddressBalance} from 'dok-wallet-blockchain-networks/helper/deriveAddressBalance';

describe('formatDeriveAddressBalance', () => {
  it('converts a satoshi balance to whole coins with the symbol', () => {
    expect(
      formatDeriveAddressBalance({balance: '10000', decimal: 8, symbol: 'BTC'}),
    ).toBe('0.0001 BTC');
    expect(
      formatDeriveAddressBalance({
        balance: 150000000,
        decimal: 8,
        symbol: 'LTC',
      }),
    ).toBe('1.5 LTC');
  });

  it('defaults to 8 decimals for bitcoin-family coins when the coin has none', () => {
    expect(formatDeriveAddressBalance({balance: '1', symbol: 'BTC'})).toBe(
      '0.00000001 BTC',
    );
  });

  it('shows 0 for a missing or empty balance', () => {
    expect(formatDeriveAddressBalance({symbol: 'BTC'})).toBe('0 BTC');
    expect(formatDeriveAddressBalance({balance: '0', symbol: 'BTC'})).toBe(
      '0 BTC',
    );
    expect(formatDeriveAddressBalance({balance: 'abc', symbol: 'BTC'})).toBe(
      '0 BTC',
    );
  });

  it('omits the symbol when there is none', () => {
    expect(formatDeriveAddressBalance({balance: '10000', decimal: 8})).toBe(
      '0.0001',
    );
  });
});
