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
    amountInWei,
    tokenBalance,
    contractAddress,
    walletSigner,
    stakingProviderName,
    estimateGas,
    nonce,
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
      amountInWei,
      tokenBalance,
      contractAddress,
      walletSigner,
      estimateGas,
      nonce,
    });
  },
  getStakingAddress: async ({contractAddress, stakingProviderName}) => {
    const provider = stakingProviderName
      ? providers.find(p => p.name === stakingProviderName)
      : providers[0];
    if (!provider || typeof provider.getStakingAddress !== 'function') {
      throw new Error(
        `[EvmStakingProvider] No getStakingAddress found: ${stakingProviderName}`,
      );
    }
    return provider.getStakingAddress({
      contractAddress,
    });
  },
  getEstimateFeeForStaking: async ({
    from,
    amountInWei,
    contractAddress,
    stakingProviderName,
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
      amountInWei,
      contractAddress,
      walletSigner,
    });
  },
  unStaking: async ({
    from,
    contractAddress,
    stakingProviderName,
    walletSigner,
    estimateGas,
    amountInWei,
  }) => {
    const provider = stakingProviderName
      ? providers.find(p => p.name === stakingProviderName)
      : providers[0];
    if (!provider || typeof provider.unStaking !== 'function') {
      throw new Error(
        `[EvmStakingProvider] No unstaking provider found: ${stakingProviderName}`,
      );
    }
    return provider.unStaking({
      from,
      contractAddress,
      walletSigner,
      estimateGas,
      amountInWei,
    });
  },
  getEstimateFeeForDeactivateStaking: async ({
    from,
    contractAddress,
    stakingProviderName,
    walletSigner,
    evmProvider: externalEvmProvider,
    amountInWei,
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
      amountInWei,
    });
  },
  getEstimateFeeForClaimRewards: async ({
    from,
    contractAddress,
    stakingProviderName,
    evmProvider: externalEvmProvider,
  }) => {
    const evmProvider = externalEvmProvider;
    const provider = stakingProviderName
      ? providers.find(p => p.name === stakingProviderName)
      : providers[0];
    if (
      !provider ||
      typeof provider.getEstimateFeeForClaimRewards !== 'function'
    ) {
      return null;
    }
    return provider.getEstimateFeeForClaimRewards({
      from,
      contractAddress,
      evmProvider,
    });
  },
  claimRewards: async ({
    from,
    contractAddress,
    stakingProviderName,
    privateKey,
    evmProvider: externalEvmProvider,
    options,
  }) => {
    const evmProvider = externalEvmProvider;
    const provider = stakingProviderName
      ? providers.find(p => p.name === stakingProviderName)
      : providers[0];
    if (!provider || typeof provider.claimRewards !== 'function') {
      return null;
    }
    return provider.claimRewards({
      from,
      contractAddress,
      privateKey,
      evmProvider,
      options,
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
