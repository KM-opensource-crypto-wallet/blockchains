import {ethers, formatUnits} from 'ethers';
import erc20 from '../../abis/erc20.json';
import aavePoolABI from '../../abis/aave_pool.json';
import aaveDataProviderABI from '../../abis/aave_data_provider.json';
import aaveRewardsControllerABI from '../../abis/aave_rewards_controller.json';
import {getTokenLogoUrl} from 'dok-wallet-blockchain-networks/helper';

export const aavePoolContractAddress =
  '0x87870Bca3F3fD6335C3F4ce8392D69350B4fA4E2';
export const aaveDataProviderContractAddress =
  '0x7B4EB56E7CD4b454BA8ff71E4518426369a138a3';
export const aaveRewardsControllerAddress =
  '0x8164Cc65827dcFe994AB23944CBC90e0aa80bFcb';

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
  let totalStaked = null;

  if (dataProviderContractAddress && dataProviderABI) {
    const dataProvider = new ethers.Contract(
      dataProviderContractAddress,
      dataProviderABI,
      evmProvider,
    );
    const [aTokenAddress] = await dataProvider.getReserveTokensAddresses(
      contractAddress,
    );
    const aToken = new ethers.Contract(aTokenAddress, erc20, evmProvider);

    const [totalSupply, userBalance] = await Promise.all([
      aToken.totalSupply(),
      walletAddress ? aToken.balanceOf(walletAddress) : Promise.resolve(null),
    ]);

    totalStaked = formatUnits(totalSupply, tokenDecimals);

    if (userBalance !== null) {
      stakedAmount = formatUnits(userBalance, tokenDecimals);
      stakedAmountRaw = userBalance.toString();
    }
  }

  return {apy, stakedAmount, stakedAmountRaw, totalStaked};
};

export const aaveProvider = {
  icon: 'https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcQ5e9ziszHC3fEt6o0kQRkcvljRNKwcOi4-3w&s',
  name: 'Aave',
  apy: '0% APY',
  stakedAmount: '0',
  stakedAmountRaw: null,
  poolContractAddress: aavePoolContractAddress,
  poolABI: aavePoolABI,
  dataProviderContractAddress: aaveDataProviderContractAddress,
  dataProviderABI: aaveDataProviderABI,
  createStaking: async ({
    from,
    amountInWei,
    tokenBalance,
    contractAddress,
    walletSigner,
    estimateGas,
    nonce,
  }) => {
    if (tokenBalance < amountInWei) {
      throw new Error('Insufficient balance');
    }

    const pool = new ethers.Contract(
      aavePoolContractAddress,
      aavePoolABI,
      walletSigner,
    );
    const gasLimit =
      typeof estimateGas === 'bigint'
        ? estimateGas
        : await pool.supply.estimateGas(contractAddress, amountInWei, from, 0);

    const tx = await pool.supply.populateTransaction(
      contractAddress,
      amountInWei,
      from,
      0,
      {gasLimit},
    );
    tx.nonce = nonce;
    return tx;
  },
  getStakingAddress: async () => {
    return {
      stakingProviderAddress: aavePoolContractAddress,
    };
  },
  getEstimateFeeForStaking: async ({
    from,
    amountInWei,
    contractAddress,
    walletSigner,
  }) => {
    const pool = new ethers.Contract(
      aavePoolContractAddress,
      aavePoolABI,
      walletSigner,
    );
    let estimateGas;
    try {
      estimateGas = await pool.supply.estimateGas(
        contractAddress,
        amountInWei,
        from,
        0,
      );
      estimateGas = (estimateGas * 110n) / 100n; // add 10% buffer
    } catch (e) {
      console.error('Error in estimateGas:', e?.message);
      estimateGas = 330_000n; // fallback when allowance not yet set
    }
    return {
      estimateGas,
      toAddress: aavePoolContractAddress,
      value: amountInWei,
    };
  },
  unStaking: async ({
    from,
    contractAddress,
    walletSigner,
    estimateGas,
    amountInWei,
  }) => {
    try {
      const pool = new ethers.Contract(
        aavePoolContractAddress,
        aavePoolABI,
        walletSigner,
      );

      const dataProvider = new ethers.Contract(
        aaveDataProviderContractAddress,
        aaveDataProviderABI,
        walletSigner,
      );
      const [aTokenAddress] = await dataProvider.getReserveTokensAddresses(
        contractAddress,
      );
      const aToken = new ethers.Contract(aTokenAddress, erc20, walletSigner);
      const withdrawAmount =
        amountInWei === ethers.MaxUint256
          ? await aToken.balanceOf(from)
          : amountInWei;

      const gasLimit =
        typeof estimateGas === 'bigint'
          ? estimateGas
          : await pool.withdraw.estimateGas(
              contractAddress,
              withdrawAmount,
              from,
            );

      const tx = await pool.withdraw.populateTransaction(
        contractAddress,
        withdrawAmount,
        from,
        {gasLimit},
      );

      return tx;
    } catch (error) {
      console.log(error);
      throw error;
    }
  },
  getStakingBalance: async (
    {evmProvider, address, contractAddress},
    provider,
  ) => {
    try {
      const dataProvider = new ethers.Contract(
        provider.dataProviderContractAddress,
        provider.dataProviderABI,
        evmProvider,
      );
      const [aTokenAddress] = await dataProvider.getReserveTokensAddresses(
        contractAddress,
      );
      const aToken = new ethers.Contract(aTokenAddress, erc20, evmProvider);
      const balance = await aToken.balanceOf(address);
      return {
        stakingBalance: balance.toString() || '0',
        energyBalance: '0',
        bandwidthBalance: '0',
      };
    } catch (error) {
      console.error('[aaveProvider getStakingBalance] error:', error?.message);
      throw error;
    }
  },
  getEstimateFeeForDeactivateStaking: async ({
    from,
    contractAddress,
    walletSigner,
    amountInWei,
  }) => {
    try {
      const pool = new ethers.Contract(
        aavePoolContractAddress,
        aavePoolABI,
        walletSigner,
      );
      const dataProvider = new ethers.Contract(
        aaveDataProviderContractAddress,
        aaveDataProviderABI,
        walletSigner,
      );
      const [aTokenAddress] = await dataProvider.getReserveTokensAddresses(
        contractAddress,
      );
      const aToken = new ethers.Contract(aTokenAddress, erc20, walletSigner);
      const withdrawAmount =
        amountInWei === ethers.MaxUint256
          ? await aToken.balanceOf(from)
          : amountInWei;
      const estimateGas = await pool.withdraw.estimateGas(
        contractAddress,
        withdrawAmount,
        from,
      );
      return {
        estimateGas,
        toAddress: aavePoolContractAddress,
        value: withdrawAmount,
      };
    } catch (e) {
      console.error('Error in EVMChain getEstimateFeeForDeactivateStaking', e);
      throw e;
    }
  },
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
  getEstimateFeeForClaimRewards: async ({
    from,
    evmProvider,
    contractAddress,
  }) => {
    try {
      const dataProvider = new ethers.Contract(
        aaveDataProviderContractAddress,
        aaveDataProviderABI,
        evmProvider,
      );
      const [aTokenAddress] = await dataProvider.getReserveTokensAddresses(
        contractAddress,
      );
      const rewardsController = new ethers.Contract(
        aaveRewardsControllerAddress,
        aaveRewardsControllerABI,
        evmProvider,
      );
      const estimateGas = await rewardsController.claimAllRewards.estimateGas(
        [aTokenAddress],
        from,
      );
      return {estimateGas, toAddress: aaveRewardsControllerAddress, value: 0n};
    } catch (e) {
      console.error('Error in aaveProvider getEstimateFeeForClaimRewards', e);
      throw e;
    }
  },
  getRewards: async ({from, evmProvider, contractAddress}) => {
    try {
      const dataProvider = new ethers.Contract(
        aaveDataProviderContractAddress,
        aaveDataProviderABI,
        evmProvider,
      );
      const [aTokenAddress] = await dataProvider.getReserveTokensAddresses(
        contractAddress,
      );

      const rewardsController = new ethers.Contract(
        aaveRewardsControllerAddress,
        aaveRewardsControllerABI,
        evmProvider,
      );
      const [rewardsList, unclaimedAmounts] =
        await rewardsController.getAllUserRewards([aTokenAddress], from);

      if (!rewardsList.length) {
        return {token: null, amount: '0', symbol: 'AAVE', logo: null};
      }

      // Prefer first token with a non-zero balance; fall back to index 0
      let idx = rewardsList.findIndex((_, i) => unclaimedAmounts[i] > 0n);
      if (idx === -1) {
        idx = 0;
      }

      const rewardToken = rewardsList[idx];
      const rewardAmount = unclaimedAmounts[idx];

      const tokenContract = new ethers.Contract(
        rewardToken,
        erc20,
        evmProvider,
      );
      const [decimals, symbol] = await Promise.all([
        tokenContract.decimals(),
        tokenContract.symbol(),
      ]);

      return {
        token: rewardToken,
        amount: formatUnits(rewardAmount, decimals),
        symbol,
        logo: getTokenLogoUrl(rewardToken),
      };
    } catch (error) {
      console.warn('[aaveProvider getRewards] error:', error?.message);
      return {token: null, amount: '0', symbol: 'AAVE', logo: null};
    }
  },
  claimRewards: async ({from, contractAddress, privateKey, evmProvider}) => {
    try {
      const dataProvider = new ethers.Contract(
        aaveDataProviderContractAddress,
        aaveDataProviderABI,
        evmProvider,
      );
      const [aTokenAddress] = await dataProvider.getReserveTokensAddresses(
        contractAddress,
      );
      const walletSigner = new ethers.Wallet(privateKey).connect(evmProvider);
      const rewardsController = new ethers.Contract(
        aaveRewardsControllerAddress,
        aaveRewardsControllerABI,
        walletSigner,
      );
      return rewardsController.claimAllRewards.populateTransaction(
        [aTokenAddress],
        from,
      );
    } catch (error) {
      console.log('[aaveProvider claimRewards] error:', error);
      throw error;
    }
  },
};
