import {aaveProvider} from './aave';
import {compoundProvider} from './compoundFinance';
import {sparkProvider} from './spark';
import {morphoProvider} from './morpho';
import {mapleProvider} from './maple';
import {fluidProvider} from './fluid';

export {aavePoolContractAddress, aaveDataProviderContractAddress} from './aave';

// Add new providers here — each must implement fetchData or leave it undefined for static data
const providers = [
  aaveProvider,
  compoundProvider,
  sparkProvider,
  morphoProvider,
  mapleProvider,
  fluidProvider,
];

export const EvmStakingProvider = {
  createStaking: async ({
    from,
    amount,
    contractAddress,
    decimals,
    tokenContract,
    walletSigner,
    stakingProviderName,
  }) => {
    const provider = stakingProviderName
      ? providers.find(p => p.name === stakingProviderName)
      : providers[0];
    if (!provider || typeof provider.createStaking !== 'function') {
      throw new Error(
        `[EvmStakingProvider] No staking provider found: ${stakingProviderName}`,
      );
    }
    return provider.createStaking({
      from,
      amount,
      contractAddress,
      decimals,
      tokenContract,
      walletSigner,
    });
  },
  getEstimateFeeForStaking: async ({
    from,
    amount,
    contractAddress,
    decimals,
    stakingProviderName,
    tokenContract,
    walletSigner,
  }) => {
    const provider = stakingProviderName
      ? providers.find(p => p.name === stakingProviderName)
      : providers[0];
    if (!provider || typeof provider.createStaking !== 'function') {
      throw new Error(
        `[EvmStakingProvider] No staking provider found: ${stakingProviderName}`,
      );
    }
    return provider.getEstimateFeeForStaking({
      from,
      amount,
      contractAddress,
      decimals,
      tokenContract,
      walletSigner,
    });
  },
  unStaking: async ({
    from,
    contractAddress,
    stakingProviderName,
    walletSigner,
  }) => {
    const provider = stakingProviderName
      ? providers.find(p => p.name === stakingProviderName)
      : providers[0];
    if (!provider || typeof provider.unStaking !== 'function') {
      throw new Error(
        `[EvmStakingProvider] No unstaking provider found: ${stakingProviderName}`,
      );
    }
    return provider.unStaking({from, contractAddress, walletSigner});
  },
  getEstimateFeeForDeactivateStaking: async ({
    from,
    contractAddress,
    stakingProviderName,
    walletSigner,
    evmProvider: externalEvmProvider,
  }) => {
    const evmProvider = externalEvmProvider;
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
    if (typeof provider.getStakingBalance === 'function') {
      const {stakingBalance} = await provider.getStakingBalance(
        {evmProvider, address: from, contractAddress},
        provider,
      );
      if (!parseFloat(stakingBalance)) {
        throw new Error(
          `Insufficient balance: No balance to withdraw from ${provider.name}`,
        );
      }
    }
    return provider.getEstimateFeeForDeactivateStaking({
      from,
      contractAddress,
      walletSigner,
    });
  },
  getStakingBalance: async ({
    address,
    contractAddress,
    stakingProviderName,
    evmProvider: externalEvmProvider,
  }) => {
    const evmProvider = externalEvmProvider;
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
    evmProvider,
  }) => {
    const results = await Promise.all(
      providers.map(async provider => {
        if (typeof provider.fetchData !== 'function' || !contractAddress) {
          return provider;
        }
        let result = provider;
        try {
          const data = await provider.fetchData(
            {evmProvider, contractAddress, walletAddress, tokenDecimals},
            provider,
          );
          if (data) {
            const updates = {apy: `${data.apy}% APY`};
            if (data.stakedAmount !== null) {
              updates.stakedAmount = data.stakedAmount;
              updates.stakedAmountRaw = data.stakedAmountRaw;
            }
            if (data.totalStaked !== null && data.totalStaked !== undefined) {
              updates.totalStaked = data.totalStaked;
            }
            result = {...provider, ...updates};
          }
        } catch (e) {
          console.warn(
            `[EvmStakingProvider] Failed to fetch data for ${provider.name}:`,
            e,
          );
        }
        if (typeof provider.getRewards === 'function' && walletAddress) {
          try {
            result = {
              ...result,
              reward: await provider.getRewards({
                from: walletAddress,
                evmProvider,
                contractAddress,
              }),
            };
          } catch (e) {
            result = {...result, reward: null};
          }
        }
        return result;
      }),
    );
    return results;
  },
};
