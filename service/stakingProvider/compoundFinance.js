import {ethers, parseUnits} from 'ethers';
import erc20 from '../../abis/erc20.json';
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
  icon: 'https://img.bgstatic.com/multiLang/coinPriceLogo/1x1/compound.jpg',
  name: 'Compound',
  apy: '0% APY',
  stakedAmount: '0',
  stakedAmountRaw: null,
  createStaking: async (
    {from, amount, privateKey, contractAddress, decimals, evmProvider},
    provider,
  ) => {
    try {
      const cometAddress = getCometAddress(contractAddress);
      const wallet = new ethers.Wallet(privateKey);
      const walletSigner = wallet.connect(evmProvider);
      const tokenContract = new ethers.Contract(
        contractAddress,
        erc20,
        walletSigner,
      );
      const amountInWei = parseUnits(amount.toString(), decimals);
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
      const balance = await tokenContract.balanceOf(from);

      console.log('Wallet Balance:', ethers.formatUnits(balance, 6));
      if (balance < amountInWei) {
        throw new Error('❌ Insufficient token balance');
      }

      // USDT requires resetting allowance to 0 before setting a new value
      const currentAllowance = await tokenContract.allowance(
        from,
        cometAddress,
      );
      if (currentAllowance > 0n) {
        const resetTx = await tokenContract.approve(cometAddress, 0n);
        await resetTx.wait();
      }
      const approveTx = await tokenContract.approve(cometAddress, amountInWei);
      await approveTx.wait();
      // � Step 4: Supply (THIS = staking)
      const tx = await comet.supply(contractAddress, amountInWei);
      await tx.wait();

      console.log('✅ Successfully supplied to Compound V3');

      return tx.hash;
    } catch (error) {
      console.log(error);
      throw error;
    }
  },
  unStaking: async (
    {from, amount, privateKey, contractAddress, evmProvider},
    provider,
  ) => {
    try {
      const cometAddress = getCometAddress(contractAddress);
      const wallet = new ethers.Wallet(privateKey);
      const walletSigner = wallet.connect(evmProvider);
      const comet = new ethers.Contract(
        cometAddress,
        cometContractABI,
        walletSigner,
      );
      //  const amountInWei = ethers.parseUnits(amount.toString(), 6);
      // � Parse amount (USDC = 6 decimals)
      const baseToken = await comet.baseToken();
      console.log('baseToken:', baseToken);

      if (contractAddress.toLowerCase() !== baseToken.toLowerCase()) {
        throw new Error(
          ' This Comet only supports its base asset (e.g., USDC)',
        );
      }
      const suppliedBalance = await comet.balanceOf(from);

      console.log('Supplied Balance:', ethers.formatUnits(suppliedBalance, 6));

      // if (suppliedBalance < amountInWei) {
      //   throw new Error(' Not enough supplied balance');
      // }

      // � Step 3: Withdraw (unstake)
      const tx = await comet.withdraw(
        contractAddress,
        ethers.MaxUint256, // � withdraw ALL
      );
      await tx.wait();

      console.log('✅ Withdraw successful');

      return tx.hash;
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
      const cometAddress = getCometAddress(contractAddress);
      const comet = new ethers.Contract(
        cometAddress,
        cometContractABI,
        provider,
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
    amount,
    privateKey,
    contractAddress,
    decimals,
    evmProvider,
  }) => {
    try {
      const cometAddress = getCometAddress(contractAddress);
      const wallet = new ethers.Wallet(privateKey);
      const walletSigner = wallet.connect(evmProvider);
      const tokenContract = new ethers.Contract(
        contractAddress,
        erc20,
        walletSigner,
      );
      const amountInWei = parseUnits(amount.toString(), decimals);
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
      } catch {
        // Allowance not yet set — estimate approve gas + known Compound V3 supply cost
        const approveGas = await tokenContract.approve.estimateGas(
          cometAddress,
          amountInWei,
        );
        // Compound V3 supply consistently costs ~150k-200k gas
        estimateGas = approveGas + 250000n;
      }
      return {estimateGas};
    } catch (e) {
      console.error('Error in compoundProvider getEstimateFeeForStaking', e);
      throw e;
    }
  },
  getEstimateFeeForDeactivateStaking: async ({
    privateKey,
    contractAddress,
    evmProvider,
  }) => {
    try {
      const cometAddress = getCometAddress(contractAddress);
      const wallet = new ethers.Wallet(privateKey);
      const walletSigner = wallet.connect(evmProvider);
      const comet = new ethers.Contract(
        cometAddress,
        cometContractABI,
        walletSigner,
      );
      const estimateGas = await comet.withdraw.estimateGas(
        contractAddress,
        ethers.MaxUint256,
      );
      return {estimateGas};
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
  claimRewards: async ({from, contractAddress, privateKey, evmProvider}) => {
    try {
      const cometAddress = getCometAddress(contractAddress);
      const wallet = new ethers.Wallet(privateKey);
      const walletSigner = wallet.connect(evmProvider);
      const rewardsContract = new ethers.Contract(
        cometRewardAddress,
        cometContractABI,
        walletSigner,
      );
      const tx = await rewardsContract.claim(
        cometAddress,
        from,
        true, // accrue first
      );

      await tx.wait();
      return tx.hash;
    } catch (error) {
      console.log(error);
      throw error;
    }
  },
};
