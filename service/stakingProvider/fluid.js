import {ethers, formatUnits, parseUnits} from 'ethers';
import erc20 from '../../abis/erc20.json';
import fluidFTokenAbi from '../../abis/spark_abi.json';

// Fluid fToken vaults on Ethereum mainnet (ERC4626-compliant)
const FLUID_FTOKEN_BY_TOKEN = {
  '0xdAC17F958D2ee523a2206206994597C13D831ec7':
    '0x5C20B550819128074FD538Edf79791733ccEdd18', // USDT → fUSDT
  '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48':
    '0x9Fb7b4477576Fe5B32be4C1843aFB1e55F251B33', // USDC → fUSDC
};

const FLUID_LENDING_RESOLVER = '0x48D32f49aFeAEC7AE66ad7B9264f446fc11a1569';

// supplyRate and rewardsRate use 1e12 precision (1% = 1e10)
const fluidLendingResolverAbi = [
  'function getFTokenDetails(address fToken_) view returns ((address tokenAddress, bool eip2612Deposits, bool isNativeUnderlying, string name, string symbol, uint256 decimals, address asset, uint256 totalAssets, uint256 totalSupply, uint256 convertToShares, uint256 convertToAssets, uint256 rewardsRate, uint256 supplyRate, int256 rebalanceDifference))',
];

const getFTokenAddress = contractAddress =>
  FLUID_FTOKEN_BY_TOKEN[
    Object.keys(FLUID_FTOKEN_BY_TOKEN).find(
      key => key.toLowerCase() === contractAddress?.toLowerCase(),
    )
  ];

const fetchFluidAPY = async (evmProvider, fTokenAddress) => {
  try {
    const resolver = new ethers.Contract(
      FLUID_LENDING_RESOLVER,
      fluidLendingResolverAbi,
      evmProvider,
    );
    const details = await resolver.getFTokenDetails(fTokenAddress);
    const totalRate = details.supplyRate + details.rewardsRate;
    return (parseFloat(formatUnits(totalRate, 12)) * 100).toFixed(2);
  } catch (e) {
    console.warn('[fluidProvider] APY fetch error:', e?.message);
    return '0.00';
  }
};

export const fluidProvider = {
  icon: 'https://icons.llamao.fi/icons/protocols/fluid?w=48&h=48',
  name: 'Fluid',
  apy: '0% APY',
  stakedAmount: '0',
  stakedAmountRaw: null,

  createStaking: async (
    {from, amount, privateKey, contractAddress, decimals, evmProvider},
    provider,
  ) => {
    try {
      const fTokenAddress = getFTokenAddress(contractAddress);
      if (!fTokenAddress)
        throw new Error(`No Fluid fToken for token: ${contractAddress}`);

      const wallet = new ethers.Wallet(privateKey);
      const walletSigner = wallet.connect(evmProvider);
      const amountInWei = parseUnits(amount.toString(), decimals);

      const tokenContract = new ethers.Contract(
        contractAddress,
        erc20,
        walletSigner,
      );
      const fToken = new ethers.Contract(
        fTokenAddress,
        fluidFTokenAbi,
        walletSigner,
      );

      // USDT requires resetting allowance to 0 before setting a new value
      const allowance = await tokenContract.allowance(from, fTokenAddress);
      if (allowance > 0n) {
        const resetTx = await tokenContract.approve(fTokenAddress, 0n);
        await resetTx.wait();
      }
      const approveTx = await tokenContract.approve(fTokenAddress, amountInWei);
      await approveTx.wait();

      const tx = await fToken.deposit(amountInWei, from);
      const receipt = await tx.wait();
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
    const fTokenAddress = getFTokenAddress(contractAddress);
    if (!fTokenAddress)
      throw new Error(`No Fluid fToken found for token: ${contractAddress}`);

    const wallet = new ethers.Wallet(privateKey);
    const walletSigner = wallet.connect(evmProvider);
    const amountInWei = parseUnits(amount.toString(), decimals);

    const tokenContract = new ethers.Contract(
      contractAddress,
      erc20,
      walletSigner,
    );
    const fToken = new ethers.Contract(
      fTokenAddress,
      fluidFTokenAbi,
      walletSigner,
    );

    let estimateGas;
    try {
      estimateGas = await fToken.deposit.estimateGas(amountInWei, from);
    } catch {
      const approveGas = await tokenContract.approve.estimateGas(
        fTokenAddress,
        amountInWei,
      );
      estimateGas = approveGas + 250000n;
    }
    return {estimateGas};
  },

  unStaking: async (
    {from, privateKey, contractAddress, evmProvider},
    provider,
  ) => {
    try {
      const fTokenAddress = getFTokenAddress(contractAddress);
      if (!fTokenAddress)
        throw new Error(`No Fluid fToken for token: ${contractAddress}`);

      const wallet = new ethers.Wallet(privateKey);
      const walletSigner = wallet.connect(evmProvider);
      const fToken = new ethers.Contract(
        fTokenAddress,
        fluidFTokenAbi,
        walletSigner,
      );

      const shares = await fToken.balanceOf(from);
      const tx = await fToken.redeem(shares, from, from);
      const receipt = await tx.wait();
      return receipt.hash;
    } catch (error) {
      console.log(error);
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
      const fTokenAddress = getFTokenAddress(contractAddress);
      if (!fTokenAddress)
        throw new Error(`No Fluid fToken found for token: ${contractAddress}`);

      const wallet = new ethers.Wallet(privateKey);
      const walletSigner = wallet.connect(evmProvider);
      const fToken = new ethers.Contract(
        fTokenAddress,
        fluidFTokenAbi,
        walletSigner,
      );

      const shares = await fToken.balanceOf(from);
      const estimateGas = await fToken.redeem.estimateGas(shares, from, from);
      return {estimateGas};
    } catch (e) {
      console.error(
        'Error in fluidProvider getEstimateFeeForDeactivateStaking',
        e,
      );
      throw e;
    }
  },

  getStakingBalance: async (
    {evmProvider, address, contractAddress},
    provider,
  ) => {
    try {
      const fTokenAddress = getFTokenAddress(contractAddress);
      if (!fTokenAddress)
        throw new Error(`No Fluid fToken for token: ${contractAddress}`);

      const fToken = new ethers.Contract(
        fTokenAddress,
        fluidFTokenAbi,
        evmProvider,
      );
      const shares = await fToken.balanceOf(address);

      return {
        stakingBalance: shares.toString() || '0',
        energyBalance: '0',
        bandwidthBalance: '0',
      };
    } catch (error) {
      console.error('[fluidProvider getStakingBalance] error:', error?.message);
      throw error;
    }
  },

  fetchData: async (
    {evmProvider, contractAddress, walletAddress, tokenDecimals},
    provider,
  ) => {
    try {
      const fTokenAddress = getFTokenAddress(contractAddress);
      if (!fTokenAddress) return null;

      const fToken = new ethers.Contract(
        fTokenAddress,
        fluidFTokenAbi,
        evmProvider,
      );

      const [totalAssets, userShares, apy] = await Promise.all([
        fToken.totalAssets(),
        walletAddress ? fToken.balanceOf(walletAddress) : Promise.resolve(null),
        fetchFluidAPY(evmProvider, fTokenAddress),
      ]);

      const totalStaked = formatUnits(totalAssets, tokenDecimals);

      let stakedAmount = null;
      let stakedAmountRaw = null;
      if (userShares !== null) {
        const assets = await fToken.convertToAssets(userShares);
        stakedAmountRaw = assets.toString();
        stakedAmount = formatUnits(assets, tokenDecimals);
      }

      return {apy, stakedAmount, stakedAmountRaw, totalStaked};
    } catch (error) {
      console.warn('[fluidProvider] fetchData error:', error);
      return null;
    }
  },
};
