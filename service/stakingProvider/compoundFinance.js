import {ethers} from 'ethers';
import cometContractABI from '../../abis/comet_compound_abi.json';
import {getTokenLogoUrl} from 'dok-wallet-blockchain-networks/helper';

// token contract address → Compound V3 Comet contract address
export const TOKEN_TO_COMET_ADDRESS = {
  '0xdAC17F958D2ee523a2206206994597C13D831ec7':
    '0x3Afdc9BCA9213A35503b077a6072F3D0d5AB0840', // USDT
  '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48':
    '0xc3d688B66703497DAA19211EEdff47f25384cdc3', // USDC
};
export const cometRewardAddress = '0x1B0e765F6224C21223AeA2af16c1C46E38885a40';
const getCometAddress = contractAddress =>
  TOKEN_TO_COMET_ADDRESS[
    Object.keys(TOKEN_TO_COMET_ADDRESS).find(
      key => key.toLowerCase() === contractAddress?.toLowerCase(),
    )
  ];

export const compoundProvider = {
  icon: 'https://assets.kimlgrow.com/common/compound.png',
  name: 'Compound',
  apy: '0% APY',
  stakedAmount: '0',
  stakedAmountRaw: null,
  createStaking: async ({
    from,
    amountInWei,
    tokenBalance,
    contractAddress,
    walletSigner,
    estimateGas,
    nonce,
  }) => {
    try {
      const cometAddress = getCometAddress(contractAddress);
      const comet = new ethers.Contract(
        cometAddress,
        cometContractABI,
        walletSigner,
      );
      const baseToken = await comet.baseToken();
      if (contractAddress.toLowerCase() !== baseToken.toLowerCase()) {
        throw new Error(
          '❌ This Comet only supports its base asset (e.g., USDC)',
        );
      }
      if (tokenBalance < amountInWei) {
        throw new Error('❌ Insufficient token balance');
      }

      let currentNonce = nonce;
      const gasLimit =
        typeof estimateGas === 'bigint'
          ? estimateGas
          : await comet.supply.estimateGas(contractAddress, amountInWei);
      const tx = await comet.supply.populateTransaction(
        contractAddress,
        amountInWei,
        {gasLimit},
      );
      tx.nonce = currentNonce;

      return tx;
    } catch (error) {
      console.log(error);
      throw error;
    }
  },
  getStakingAddress: async ({contractAddress}) => {
    const cometAddress = getCometAddress(contractAddress);
    return {
      stakingProviderAddress: cometAddress,
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
      const cometAddress = getCometAddress(contractAddress);
      const comet = new ethers.Contract(
        cometAddress,
        cometContractABI,
        walletSigner,
      );

      const withdrawAmount =
        amountInWei === ethers.MaxUint256
          ? await comet.balanceOf(from)
          : amountInWei;

      const gasLimit =
        typeof estimateGas === 'bigint'
          ? estimateGas
          : await comet.withdraw.estimateGas(contractAddress, withdrawAmount);

      const tx = await comet.withdraw.populateTransaction(
        contractAddress,
        withdrawAmount,
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
    _provider,
  ) => {
    try {
      const cometAddress = getCometAddress(contractAddress);
      const comet = new ethers.Contract(
        cometAddress,
        cometContractABI,
        evmProvider,
      );

      const balance = await comet.balanceOf(address);
      const formatted = ethers.formatUnits(balance, 6);
      return {
        stakingBalance: formatted || '0',
        energyBalance: '0',
        bandwidthBalance: '0',
      };
    } catch (error) {
      console.error('[aaveProvider getStakingBalance] error:', error?.message);
      throw error;
    }
  },
  getEstimateFeeForStaking: async ({
    amountInWei,
    contractAddress,
    walletSigner,
  }) => {
    try {
      const cometAddress = getCometAddress(contractAddress);
      const comet = new ethers.Contract(
        cometAddress,
        cometContractABI,
        walletSigner,
      );
      let estimateGas;
      try {
        // Works when allowance is already set
        estimateGas = await comet.supply.estimateGas(
          contractAddress,
          amountInWei,
        );
        estimateGas = (estimateGas * 110n) / 100n; // add 10% buffer
      } catch (e) {
        console.error('Error in estimateGas:', e?.message);
        estimateGas = 220_000n; // fallback when allowance not yet set
      }
      return {
        estimateGas,
        toAddress: cometAddress,
        value: amountInWei,
      };
    } catch (e) {
      console.error('Error in compoundProvider getEstimateFeeForStaking', e);
      throw e;
    }
  },
  getEstimateFeeForDeactivateStaking: async ({
    from,
    contractAddress,
    walletSigner,
    amountInWei,
  }) => {
    try {
      const cometAddress = getCometAddress(contractAddress);
      const comet = new ethers.Contract(
        cometAddress,
        cometContractABI,
        walletSigner,
      );
      const withdrawAmount =
        amountInWei === ethers.MaxUint256
          ? await comet.balanceOf(from)
          : amountInWei;
      const estimateGas = await comet.withdraw.estimateGas(
        contractAddress,
        withdrawAmount,
      );
      return {
        estimateGas,
        toAddress: cometAddress,
        value: withdrawAmount,
      };
    } catch (e) {
      console.error(
        'Error in compoundProvider getEstimateFeeForDeactivateStaking',
        e,
      );
      throw e;
    }
  },
  fetchData: async ({
    evmProvider,
    contractAddress,
    walletAddress,
    tokenDecimals,
  }) => {
    try {
      const cometAddress = getCometAddress(contractAddress);
      const comet = new ethers.Contract(
        cometAddress,
        cometContractABI,
        evmProvider,
      );
      const utilization = await comet.getUtilization();
      const supplyRatePerSecond = await comet.getSupplyRate(utilization);
      const secondsPerYear = 365 * 24 * 60 * 60;
      const apy = (
        (parseFloat(supplyRatePerSecond.toString()) / 1e18) *
        secondsPerYear *
        100
      ).toFixed(2);

      const [totalSupply, userBalance] = await Promise.all([
        comet.totalSupply(),
        walletAddress ? comet.balanceOf(walletAddress) : Promise.resolve(null),
      ]);

      const totalStaked = ethers.formatUnits(totalSupply, tokenDecimals);

      let stakedAmount = null;
      let stakedAmountRaw = null;
      if (userBalance !== null) {
        stakedAmountRaw = userBalance.toString();
        stakedAmount = ethers.formatUnits(userBalance, tokenDecimals);
      }

      return {apy, stakedAmount, stakedAmountRaw, totalStaked};
    } catch (e) {
      console.warn('[compoundProvider] fetchData error:', e);
      return null;
    }
  },
  getEstimateFeeForClaimRewards: async ({
    from,
    evmProvider,
    contractAddress,
  }) => {
    try {
      const cometAddress = getCometAddress(contractAddress);
      const rewardsContract = new ethers.Contract(
        cometRewardAddress,
        cometContractABI,
        evmProvider,
      );
      const estimateGas = await rewardsContract.claim.estimateGas(
        cometAddress,
        from,
        true,
      );
      return {estimateGas, toAddress: cometRewardAddress, value: 0n};
    } catch (e) {
      console.error(
        'Error in compoundProvider getEstimateFeeForClaimRewards',
        e,
      );
      throw e;
    }
  },
  getRewards: async ({from, evmProvider, contractAddress}) => {
    try {
      const cometAddress = getCometAddress(contractAddress);
      const rewardsContract = new ethers.Contract(
        cometRewardAddress,
        cometContractABI,
        evmProvider,
      );
      const result = await rewardsContract.getRewardOwed(cometAddress, from);
      const rewardToken = result[0];
      const rewardAmount = result[1];
      return {
        token: rewardToken,
        amount: ethers.formatUnits(rewardAmount, 18), // COMP = 18 decimals
        symbol: 'COMP',
        logo: getTokenLogoUrl(rewardToken),
      };
    } catch (error) {}
  },
  claimRewards: async ({
    from,
    contractAddress,
    privateKey,
    evmProvider,
    options,
  }) => {
    try {
      const cometAddress = getCometAddress(contractAddress);
      const wallet = new ethers.Wallet(privateKey);
      const walletSigner = wallet.connect(evmProvider);
      const rewardsContract = new ethers.Contract(
        cometRewardAddress,
        cometContractABI,
        walletSigner,
      );
      const tx = await rewardsContract.claim.populateTransaction(
        cometAddress,
        from,
        options,
        true, // accrue first
      );

      return tx;
    } catch (error) {
      console.log(error);
      throw error;
    }
  },
};
