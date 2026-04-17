import {ethers, formatUnits, parseUnits} from 'ethers';
import erc20 from '../../abis/erc20.json';
import sparkAbi from '../../abis/spark_abi.json';
const SPARK_VAULT_BY_TOKEN = {
  '0xdAC17F958D2ee523a2206206994597C13D831ec7':
    '0xe2e7a17dFf93280dec073C995595155283e3C372', // USDT → spUSDT
  '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48':
    '0x28b3a8fb53b741a8fd78c0fb9a6b2393d896a43d', // USDC → spUSDC
};

export const sparkProvider = {
  icon: 'https://pbs.twimg.com/profile_images/1856332015341084672/lF5ZZXRm_400x400.jpg',
  name: 'Spark',
  apy: '0% APY',
  stakedAmount: '0',
  stakedAmountRaw: null,
  poolContractAddress: 'aavePoolContractAddress',
  poolABI: 'aavePoolABI',
  dataProviderContractAddress: 'aaveDataProviderContractAddress',
  dataProviderABI: 'aaveDataProviderABI',
  createStaking: async (
    {from, amount, privateKey, contractAddress, decimals, evmProvider},
    provider,
  ) => {
    try {
      const wallet = new ethers.Wallet(privateKey);
      const walletSigner = wallet.connect(evmProvider);
      const vaultAddress = SPARK_VAULT_BY_TOKEN[contractAddress];
      const amountInWei = parseUnits(amount.toString(), decimals);
      if (!vaultAddress)
        throw new Error(`No Spark vault for token: ${contractAddress}`);
      const vault = new ethers.Contract(vaultAddress, sparkAbi, walletSigner);
      const tokenContract = new ethers.Contract(
        contractAddress,
        erc20,
        walletSigner,
      );
      const allowance = await tokenContract.allowance(from, vaultAddress);
      if (allowance > 0n) {
        console.log('Resetting allowance to 0...');
        const resetTx = await tokenContract.approve(vaultAddress, 0n);
        await resetTx.wait();
      }
      console.log('Approving...');
      const approveTx = await tokenContract.approve(vaultAddress, amountInWei);
      await approveTx.wait();

      console.log('Depositing into Spark savings vault...');
      const tx = await vault.deposit(amountInWei, from);
      const receipt = await tx.wait();

      console.log('Stake successful:', receipt.hash);
      return receipt.hash;
    } catch (error) {
      console.log(error);
      throw error;
    }
  },
  getEstimateFeeForStaking: async (
    {from, amount, privateKey, contractAddress, decimals, evmProvider},
    provider,
  ) => {
    const vaultAddress = SPARK_VAULT_BY_TOKEN[contractAddress];
    if (!vaultAddress)
      throw new Error(`No Spark vault found for token: ${contractAddress}`);

    const wallet = new ethers.Wallet(privateKey);
    const walletSigner = wallet.connect(evmProvider);
    const amountInWei = parseUnits(amount.toString(), decimals);

    const tokenContract = new ethers.Contract(
      contractAddress,
      erc20,
      walletSigner,
    );
    const vault = new ethers.Contract(vaultAddress, sparkAbi, walletSigner);

    let estimateGas;
    try {
      // Works when allowance is already sufficient
      estimateGas = await vault.deposit.estimateGas(amountInWei, from);
    } catch {
      // Allowance not yet set — estimate approve gas + known Spark deposit cost
      const approveGas = await tokenContract.approve.estimateGas(
        vaultAddress,
        amountInWei,
      );
      // Spark ERC4626 deposit consistently costs ~150k-200k gas
      estimateGas = approveGas + 250000n;
    }
    return {estimateGas};
  },
  unStaking: async (
    {from, amount, privateKey, contractAddress, evmProvider},
    provider,
  ) => {
    try {
      const vaultAddress = SPARK_VAULT_BY_TOKEN[contractAddress];
      const wallet = new ethers.Wallet(privateKey);
      const walletSigner = wallet.connect(evmProvider);
      const vault = new ethers.Contract(vaultAddress, sparkAbi, walletSigner);

      // Redeem all shares
      const shares = await vault.balanceOf(from);

      const tx = await vault.redeem(shares, from, from);
      const receipt = await tx.wait();

      console.log('Unstake successful:', receipt.hash);
      return receipt.hash;
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
      const vaultAddress = SPARK_VAULT_BY_TOKEN[contractAddress];
      if (!vaultAddress)
        throw new Error(`No Spark vault for token: ${contractAddress}`);

      const vault = new ethers.Contract(vaultAddress, sparkAbi, evmProvider);

      const [assetsInWei, sharesInWei] = await Promise.all([
        vault.assetsOf(address),
        vault.balanceOf(address),
      ]);

      const assets = formatUnits(assetsInWei, 6); // both USDT & USDC are 6 decimals
      const shares = formatUnits(sharesInWei, 18); // vault shares are 18 decimals
      return {
        stakingBalance: shares.toString() || '0',
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
    privateKey,
    contractAddress,
    evmProvider,
  }) => {
    try {
      const vaultAddress = SPARK_VAULT_BY_TOKEN[contractAddress];
      if (!vaultAddress)
        throw new Error(`No Spark vault found for token: ${contractAddress}`);

      const wallet = new ethers.Wallet(privateKey);
      const walletSigner = wallet.connect(evmProvider);
      const vault = new ethers.Contract(vaultAddress, sparkAbi, walletSigner);

      const shares = await vault.balanceOf(from);
      const estimateGas = await vault.redeem.estimateGas(shares, from, from);
      return {estimateGas};
    } catch (e) {
      console.error('Error in EVMChain getEstimateFeeForDeactivateStaking', e);
      throw e;
    }
  },
  fetchData: async (
    {evmProvider, contractAddress, walletAddress, tokenDecimals},
    provider,
  ) => {
    try {
      const vaultAddress = SPARK_VAULT_BY_TOKEN[contractAddress];
      if (!vaultAddress)
        throw new Error(`No Spark vault found for token: ${contractAddress}`);

      const vault = new ethers.Contract(vaultAddress, sparkAbi, evmProvider);

      const vsr = await vault.vsr();

      const RAY = 1e27;
      const SECONDS_PER_YEAR = 31536000;

      const vsrFloat = Number(vsr) / RAY;
      const supplyAPY = (Math.pow(vsrFloat, SECONDS_PER_YEAR) - 1) * 100;

      const result = supplyAPY.toFixed(2);
      console.log(`Spark Supply APY for ${contractAddress}:`, result + '%');

      let stakedAmount = null;
      let stakedAmountRaw = null;
      if (walletAddress) {
        const shares = await vault.balanceOf(walletAddress);
        const assets = await vault.convertToAssets(shares);
        stakedAmountRaw = assets.toString();
        stakedAmount = formatUnits(assets, tokenDecimals);
      }

      return {apy: result, stakedAmount, stakedAmountRaw};
    } catch (error) {
      console.log(error);
      throw error;
    }
  },
  getRewards: async ({from, evmProvider, contractAddress}) => {
    try {
      const vaultAddress = SPARK_VAULT_BY_TOKEN[contractAddress];
      if (!vaultAddress)
        throw new Error(`No Spark vault for token: ${contractAddress}`);

      const vault = new ethers.Contract(vaultAddress, sparkAbi, evmProvider);

      const [depositEvents, withdrawEvents, currentAssetsInWei] =
        await Promise.all([
          vault.queryFilter(vault.filters.Deposit(null, from)),
          vault.queryFilter(vault.filters.Withdraw(null, null, from)),
          vault.assetsOf(from),
        ]);

      const totalDeposited = depositEvents.reduce(
        (sum, e) => sum + e.args.assets,
        0n,
      );
      const totalWithdrawn = withdrawEvents.reduce(
        (sum, e) => sum + e.args.assets,
        0n,
      );
      const principal = totalDeposited - totalWithdrawn;

      const rewardsInWei = currentAssetsInWei - principal;

      return {
        token: contractAddress, // USDT or USDC — yield is paid in the same underlying asset
        amount: formatUnits(rewardsInWei > 0n ? rewardsInWei : 0n, 6),
      };
    } catch (error) {
      console.log(error);
      throw error;
    }
  },
  claimRewards: async ({from, contractAddress, privateKey, evmProvider}) => {
    try {
      const wallet = new ethers.Wallet(privateKey);
      const walletSigner = wallet.connect(evmProvider);
      const vaultAddress = SPARK_VAULT_BY_TOKEN[contractAddress];
      if (!vaultAddress)
        throw new Error(`No Spark vault for token: ${contractAddress}`);

      const vault = new ethers.Contract(vaultAddress, sparkAbi, walletSigner);

      const [depositEvents, withdrawEvents, currentAssetsInWei] =
        await Promise.all([
          vault.queryFilter(vault.filters.Deposit(null, from)),
          vault.queryFilter(vault.filters.Withdraw(null, null, from)),
          vault.assetsOf(from),
        ]);

      const totalDeposited = depositEvents.reduce(
        (sum, e) => sum + e.args.assets,
        0n,
      );
      const totalWithdrawn = withdrawEvents.reduce(
        (sum, e) => sum + e.args.assets,
        0n,
      );
      const principal = totalDeposited - totalWithdrawn;
      const rewardsInWei = currentAssetsInWei - principal;

      if (rewardsInWei <= 0n) {
        console.log('No rewards to claim');
        return true;
      }

      // Convert reward assets → shares first, then redeem exact shares
      // redeem() rounds DOWN (safe), withdraw() rounds UP (causes insufficient-balance)
      const rewardShares = await vault.convertToShares(rewardsInWei);

      if (rewardShares <= 0n) {
        console.log('Reward shares too small to claim');
        return true;
      }

      console.log('Claiming rewards:', formatUnits(rewardsInWei, 6));
      const tx = await vault.redeem(rewardShares, from, from);
      const receipt = await tx.wait();

      console.log('Rewards claimed:', receipt.hash);
      return receipt.hash;
    } catch (error) {
      console.log(error);
      throw error;
    }
  },
};
