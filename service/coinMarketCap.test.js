jest.mock('dok-wallet-blockchain-networks/config/coinMarketCap', () => ({
  CoinMarketCapAPI: {get: jest.fn()},
}));

const quote = (price, change) => ({
  quote: {USD: {price, percent_change_24h: change}},
});

describe('getPrice / getPriceChange24h', () => {
  let getPrice;
  let getPriceChange24h;
  let CoinMarketCapAPI;

  beforeEach(() => {
    jest.resetModules();
    ({
      CoinMarketCapAPI,
    } = require('dok-wallet-blockchain-networks/config/coinMarketCap'));
    ({
      getPrice,
      getPriceChange24h,
    } = require('dok-wallet-blockchain-networks/service/coinMarketCap'));
  });

  it('keeps the 24h change from the same quotes response as the price', async () => {
    CoinMarketCapAPI.get.mockResolvedValue({
      data: {
        data: {
          BTC: [quote(64000, 2.345)],
          ETH: [quote(3100, -1.2)],
        },
      },
    });

    const prices = await getPrice('BTC,ETH', 'USD');

    expect(prices).toEqual({BTC: 64000, ETH: 3100});
    expect(getPriceChange24h('BTC')).toBe(2.345);
    expect(getPriceChange24h('ETH')).toBe(-1.2);
    expect(CoinMarketCapAPI.get).toHaveBeenCalledTimes(1);
  });

  it('returns null when a symbol has no change data', async () => {
    CoinMarketCapAPI.get.mockResolvedValue({
      data: {data: {NEW: [quote(1, null)], EMPTY: []}},
    });

    await getPrice('NEW,EMPTY', 'USD');

    expect(getPriceChange24h('NEW')).toBeNull();
    expect(getPriceChange24h('EMPTY')).toBeNull();
    expect(getPriceChange24h('UNKNOWN')).toBeNull();
  });
});
