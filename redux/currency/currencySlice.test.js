import configureMockStore from 'redux-mock-store';
import {thunk} from 'redux-thunk';
import {selectUserCoins} from 'dok-wallet-blockchain-networks/redux/wallets/walletsSelector';
import {searchAndAddCoins} from 'dok-wallet-blockchain-networks/redux/currency/currencySlice';

// currencySlice reaches the network and the wallet selectors; neither is under
// test here - only which coin `currency` resolves to.
jest.mock('dok-wallet-blockchain-networks/service/dokApi', () => ({
  fetchCoinGroupAPI: jest.fn(),
  fetchCurrenciesAPI: jest.fn(),
  getNewsAPI: jest.fn(),
}));

jest.mock(
  'dok-wallet-blockchain-networks/redux/wallets/walletsSelector',
  () => ({
    selectAllCoinsWalletByMnemonic: jest.fn(() => []),
    selectAllCoinWithIsInWalletSymbol: jest.fn(() => []),
    selectUserCoins: jest.fn(() => []),
  }),
);

jest.mock('utils/toast', () => ({showToast: jest.fn()}));

const mockStore = configureMockStore([thunk]);

const eth = {_id: 'c1', chain_name: 'ethereum', symbol: 'ETH', type: 'coin'};
const steth = {
  _id: 'c2',
  chain_name: 'ethereum',
  symbol: 'stETH',
  type: 'token',
};

const resolve = currency =>
  mockStore({}).dispatch(searchAndAddCoins({currency})).unwrap();

describe('searchAndAddCoins currency matching', () => {
  beforeEach(() => {
    selectUserCoins.mockReturnValue([eth, steth]);
  });

  it('matches the legacy upper-case currency form', async () => {
    await expect(resolve('ethereum:ETH')).resolves.toEqual({coinId: 'c1'});
  });

  it('matches a lower-cased coin slug, which never equalled the symbol before', async () => {
    await expect(resolve('ethereum:eth')).resolves.toEqual({coinId: 'c1'});
  });

  it('matches a mixed-case token symbol from a lower-cased slug', async () => {
    await expect(resolve('ethereum:steth')).resolves.toEqual({coinId: 'c2'});
  });

  it('is case-insensitive on the chain name too', async () => {
    await expect(resolve('Ethereum:eth')).resolves.toEqual({coinId: 'c1'});
  });
});
