import {ethers, FetchRequest, formatUnits, JsonRpcProvider} from 'ethers';
import {getFreeRPCUrl} from 'dok-wallet-blockchain-networks/rpcUrls/rpcUrls';
import erc20 from '../abis/erc20.json';
import aavePoolABI from '../abis/aave_pool.json';
import aaveDataProviderABI from '../abis/aave_data_provider.json';

export const aavePoolContractAddress =
  '0x87870Bca3F3fD6335C3F4ce8392D69350B4fA4E2';
export const aaveDataProviderContractAddress =
  '0x7B4EB56E7CD4b454BA8ff71E4518426369a138a3';
const createEvmProvider = () => {
  const rpcUrls = getFreeRPCUrl('ethereum');
  const rpcUrl = Array.isArray(rpcUrls) ? rpcUrls[0] : rpcUrls;
  const fetchRequest = new FetchRequest(rpcUrl);
  return new JsonRpcProvider(fetchRequest, undefined, {staticNetwork: true});
};

// Each provider defines its own fetchData({evmProvider, contractAddress, walletAddress, tokenDecimals})
// Returns {apy, stakedAmount, stakedAmountRaw} or null on failure

const aaveFetchData = async ({
  evmProvider,
  contractAddress,
  walletAddress,
  tokenDecimals,
  poolContractAddress,
  poolABI,
  dataProviderContractAddress,
  dataProviderABI,
}) => {
  const pool = new ethers.Contract(poolContractAddress, poolABI, evmProvider);
  const reserveData = await pool.getReserveData(contractAddress);
  const liquidityRate = reserveData[2];
  const apy = (parseFloat(formatUnits(liquidityRate, 27)) * 100).toFixed(2);

  let stakedAmount = null;
  let stakedAmountRaw = null;
  if (walletAddress && dataProviderContractAddress && dataProviderABI) {
    const dataProvider = new ethers.Contract(
      dataProviderContractAddress,
      dataProviderABI,
      evmProvider,
    );
    const [aTokenAddress] = await dataProvider.getReserveTokensAddresses(
      contractAddress,
    );
    const aToken = new ethers.Contract(aTokenAddress, erc20, evmProvider);
    const balance = await aToken.balanceOf(walletAddress);
    stakedAmount = formatUnits(balance, tokenDecimals);
    stakedAmountRaw = balance.toString();
  }

  return {apy, stakedAmount, stakedAmountRaw};
};

// Add new providers here — each must implement fetchData or leave it undefined for static data
const providers = [
  {
    icon: 'https://cdn-icons-png.flaticon.com/512/17978/17978942.png',
    name: 'Aave',
    apy: '0% APY',
    stakedAmount: '0',
    stakedAmountRaw: null,
    poolContractAddress: aavePoolContractAddress,
    poolABI: aavePoolABI,
    dataProviderContractAddress: aaveDataProviderContractAddress,
    dataProviderABI: aaveDataProviderABI,
    fetchData: async (
      {evmProvider, contractAddress, walletAddress, tokenDecimals},
      provider,
    ) =>
      aaveFetchData({
        evmProvider,
        contractAddress,
        walletAddress,
        tokenDecimals,
        poolContractAddress: provider.poolContractAddress,
        poolABI: provider.poolABI,
        dataProviderContractAddress: provider.dataProviderContractAddress,
        dataProviderABI: provider.dataProviderABI,
      }),
  },
];

export const EvmStakingProvider = {
  getlistOfProviders: async ({
    contractAddress,
    walletAddress,
    tokenDecimals = 6,
  }) => {
    const evmProvider = createEvmProvider();

    const results = await Promise.all(
      providers.map(async provider => {
        if (typeof provider.fetchData !== 'function' || !contractAddress) {
          return provider;
        }
        try {
          const data = await provider.fetchData(
            {evmProvider, contractAddress, walletAddress, tokenDecimals},
            provider,
          );
          if (!data) {
            return provider;
          }
          const updates = {apy: `${data.apy}% APY`};
          if (data.stakedAmount !== null) {
            updates.stakedAmount = data.stakedAmount;
            updates.stakedAmountRaw = data.stakedAmountRaw;
          }
          return {...provider, ...updates};
        } catch (e) {
          console.warn(
            `[EvmStakingProvider] Failed to fetch data for ${provider.name}:`,
            e,
          );
          return provider;
        }
      }),
    );
    return results;
  },
};
