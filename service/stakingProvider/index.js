import {FetchRequest, JsonRpcProvider} from 'ethers';
import {getFreeRPCUrl} from 'dok-wallet-blockchain-networks/rpcUrls/rpcUrls';
import {aaveProvider} from './aave';
import {compoundProvider} from './compoundFinance';
import {sparkProvider} from './spark';
import {morphoProvider} from './morpho';

export {aavePoolContractAddress, aaveDataProviderContractAddress} from './aave';

const createEvmProvider = () => {
  const rpcUrls = getFreeRPCUrl('ethereum');
  const rpcUrl = Array.isArray(rpcUrls) ? rpcUrls[0] : rpcUrls;
  const fetchRequest = new FetchRequest(rpcUrl);
  return new JsonRpcProvider(fetchRequest, undefined, {staticNetwork: true});
};

// Add new providers here — each must implement fetchData or leave it undefined for static data
const providers = [
  aaveProvider,
  compoundProvider,
  sparkProvider,
  morphoProvider,
];

export const EvmStakingProvider = {
  createStaking: async ({
    from,
    amount,
    privateKey,
    contractAddress,
    decimals,
    stakingProviderName,
    evmProvider: externalEvmProvider,
  }) => {
    const evmProvider = externalEvmProvider || createEvmProvider();
    const provider = stakingProviderName
      ? providers.find(p => p.name === stakingProviderName)
      : providers[0];
    if (!provider || typeof provider.createStaking !== 'function') {
      throw new Error(
        `[EvmStakingProvider] No staking provider found: ${stakingProviderName}`,
      );
    }
    return provider.createStaking(
      {from, amount, privateKey, contractAddress, decimals, evmProvider},
      provider,
    );
  },
  getEstimateFeeForStaking: async ({
    from,
    amount,
    privateKey,
    contractAddress,
    decimals,
    stakingProviderName,
    evmProvider: externalEvmProvider,
  }) => {
    const evmProvider = externalEvmProvider || createEvmProvider();
    const provider = stakingProviderName
      ? providers.find(p => p.name === stakingProviderName)
      : providers[0];
    if (!provider || typeof provider.createStaking !== 'function') {
      throw new Error(
        `[EvmStakingProvider] No staking provider found: ${stakingProviderName}`,
      );
    }
    return provider.getEstimateFeeForStaking(
      {from, amount, privateKey, contractAddress, decimals, evmProvider},
      provider,
    );
  },
  unStaking: async ({
    from,
    privateKey,
    contractAddress,
    stakingProviderName,
    evmProvider: externalEvmProvider,
  }) => {
    const evmProvider = externalEvmProvider || createEvmProvider();
    const provider = stakingProviderName
      ? providers.find(p => p.name === stakingProviderName)
      : providers[0];
    if (!provider || typeof provider.unStaking !== 'function') {
      throw new Error(
        `[EvmStakingProvider] No unstaking provider found: ${stakingProviderName}`,
      );
    }
    return provider.unStaking(
      {from, privateKey, contractAddress, evmProvider},
      provider,
    );
  },
  getEstimateFeeForDeactivateStaking: async ({
    from,
    privateKey,
    contractAddress,
    stakingProviderName,
    evmProvider: externalEvmProvider,
  }) => {
    const evmProvider = externalEvmProvider || createEvmProvider();
    const provider = stakingProviderName
      ? providers.find(p => p.name === stakingProviderName)
      : providers[0];
    if (
      !provider ||
      typeof provider.getEstimateFeeForDeactivateStaking !== 'function'
    ) {
      throw new Error(
        `[EvmStakingProvider] No getEstimateFeeForDeactivateStaking found: ${stakingProviderName}`,
      );
    }
    return provider.getEstimateFeeForDeactivateStaking({
      from,
      privateKey,
      contractAddress,
      evmProvider,
    });
  },
  getStakingBalance: async ({
    address,
    contractAddress,
    stakingProviderName,
    evmProvider: externalEvmProvider,
  }) => {
    const evmProvider = externalEvmProvider || createEvmProvider();
    const provider = stakingProviderName
      ? providers.find(p => p.name === stakingProviderName)
      : providers[0];
    if (!provider || typeof provider.getStakingBalance !== 'function') {
      throw new Error(
        `[EvmStakingProvider] No getStakingBalance found: ${stakingProviderName}`,
      );
    }
    return provider.getStakingBalance(
      {evmProvider, address, contractAddress},
      provider,
    );
  },
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
