import {ethers, formatUnits, parseUnits} from 'ethers';
import erc20 from '../../abis/erc20.json';
import maplePoolABI from '../../abis/maple_pool.json';
import mapleSyrupRouterABI from '../../abis/maple_syrup_router.json';

const POOL_PERMISSION_MANAGER = '0xBe10aDcE8B6E3E02Db384E7FaDA5395DD113D8b3';
const POOL_PERMISSION_MANAGER_ABI = [
  'function hasPermission(address poolManager, address lender, bytes32 functionId) view returns (bool)',
];

const checkMapleAuthorization = async (
  evmProvider,
  poolAddress,
  walletAddress,
) => {
  const ppm = new ethers.Contract(
    POOL_PERMISSION_MANAGER,
    POOL_PERMISSION_MANAGER_ABI,
    evmProvider,
  );
  return ppm.hasPermission(poolAddress, walletAddress, ethers.id('P:deposit'));
};

// Maple Finance syrupUSDC and syrupUSDT vaults on Ethereum mainnet
const MAPLE_VAULT_BY_TOKEN = {
  '0xdAC17F958D2ee523a2206206994597C13D831ec7': {
    poolAddress: '0x356B8d89c1e1239Cbbb9dE4815c39A1474d5BA7D',
    routerAddress: '0xF007476Bb27430795138C511F18F821e8D1e5Ee2',
  },
  '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48': {
    poolAddress: '0x80ac24aA929eaF5013f6436cdA2a7ba190f5Cc0b',
    routerAddress: '0x134cCaaA4F1e4552eC8aEcb9E4A2360dDcF8df76',
  },
};

const MAPLE_GRAPHQL_URL = 'https://api.maple.finance/v2/graphql';

const getVaultConfig = contractAddress =>
  MAPLE_VAULT_BY_TOKEN[
    Object.keys(MAPLE_VAULT_BY_TOKEN).find(
      key => key.toLowerCase() === contractAddress?.toLowerCase(),
    )
  ];

const fetchMapleAPY = async poolAddress => {
  const query = `{ poolV2(id: "${poolAddress.toLowerCase()}") { weeklyApy } }`;
  const response = await fetch(MAPLE_GRAPHQL_URL, {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({query}),
  });
  const json = await response.json();
  const raw = json?.data?.poolV2?.weeklyApy;
  if (raw == null) return null;
  // Maple returns raw integer; APY % = rawValue / 1e28
  return (parseFloat(raw) / 1e28).toFixed(2);
};

export const mapleProvider = {
  icon: 'https://s2.coinmarketcap.com/static/img/coins/200x200/33824.png',
  name: 'Maple',
  apy: '0% APY',
  stakedAmount: '0',
  stakedAmountRaw: null,
  createStaking: async (
    {from, amount, privateKey, contractAddress, decimals, evmProvider},
    provider,
  ) => {
    try {
      const config = getVaultConfig(contractAddress);
      if (!config)
        throw new Error(`No Maple vault for token: ${contractAddress}`);

      const isAuthorized = await checkMapleAuthorization(
        evmProvider,
        config.poolAddress,
        from,
      );
      if (!isAuthorized)
        throw new Error(
          'Your wallet is not authorized to deposit into Maple Finance. Please complete verification at app.maple.finance before staking.',
        );

      const wallet = new ethers.Wallet(privateKey);
      const walletSigner = wallet.connect(evmProvider);
      const amountInWei = parseUnits(amount.toString(), decimals);

      const tokenContract = new ethers.Contract(
        contractAddress,
        erc20,
        walletSigner,
      );

      // USDT requires resetting allowance to 0 before setting a new value
      const allowance = await tokenContract.allowance(
        from,
        config.routerAddress,
      );
      if (allowance > 0n) {
        const resetTx = await tokenContract.approve(config.routerAddress, 0n);
        await resetTx.wait();
      }
      const approveTx = await tokenContract.approve(
        config.routerAddress,
        amountInWei,
      );
      await approveTx.wait();

      const router = new ethers.Contract(
        config.routerAddress,
        mapleSyrupRouterABI,
        walletSigner,
      );
      const tx = await router.deposit(amountInWei, ethers.ZeroHash);
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
    const config = getVaultConfig(contractAddress);
    if (!config)
      throw new Error(`No Maple vault found for token: ${contractAddress}`);

    const isAuthorized = await checkMapleAuthorization(
      evmProvider,
      config.poolAddress,
      from,
    );
    if (!isAuthorized)
      throw new Error(
        'Your wallet is not authorized to deposit into Maple Finance. Please complete verification at app.maple.finance before staking.',
      );

    const wallet = new ethers.Wallet(privateKey);
    const walletSigner = wallet.connect(evmProvider);
    const amountInWei = parseUnits(amount.toString(), decimals);

    const tokenContract = new ethers.Contract(
      contractAddress,
      erc20,
      walletSigner,
    );
    const router = new ethers.Contract(
      config.routerAddress,
      mapleSyrupRouterABI,
      walletSigner,
    );

    let estimateGas;
    try {
      estimateGas = await router.deposit.estimateGas(
        amountInWei,
        ethers.ZeroHash,
      );
    } catch {
      const approveGas = await tokenContract.approve.estimateGas(
        config.routerAddress,
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
      const config = getVaultConfig(contractAddress);
      if (!config)
        throw new Error(`No Maple vault for token: ${contractAddress}`);

      const wallet = new ethers.Wallet(privateKey);
      const walletSigner = wallet.connect(evmProvider);
      const pool = new ethers.Contract(
        config.poolAddress,
        maplePoolABI,
        walletSigner,
      );

      const shares = await pool.balanceOf(from);
      const tx = await pool.requestRedeem(shares, from);
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
      const config = getVaultConfig(contractAddress);
      if (!config)
        throw new Error(`No Maple vault found for token: ${contractAddress}`);

      const wallet = new ethers.Wallet(privateKey);
      const walletSigner = wallet.connect(evmProvider);
      const pool = new ethers.Contract(
        config.poolAddress,
        maplePoolABI,
        walletSigner,
      );

      const shares = await pool.balanceOf(from);
      const estimateGas = await pool.requestRedeem.estimateGas(shares, from);
      return {estimateGas};
    } catch (e) {
      console.error(
        'Error in mapleProvider getEstimateFeeForDeactivateStaking',
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
      const config = getVaultConfig(contractAddress);
      if (!config)
        throw new Error(`No Maple vault for token: ${contractAddress}`);

      const pool = new ethers.Contract(
        config.poolAddress,
        maplePoolABI,
        evmProvider,
      );
      const shares = await pool.balanceOf(address);

      return {
        stakingBalance: shares.toString() || '0',
        energyBalance: '0',
        bandwidthBalance: '0',
      };
    } catch (error) {
      console.error('[mapleProvider getStakingBalance] error:', error?.message);
      throw error;
    }
  },
  fetchData: async (
    {evmProvider, contractAddress, walletAddress, tokenDecimals},
    provider,
  ) => {
    try {
      const config = getVaultConfig(contractAddress);
      if (!config) return null;

      const apy = await fetchMapleAPY(config.poolAddress);

      const pool = new ethers.Contract(
        config.poolAddress,
        maplePoolABI,
        evmProvider,
      );

      const [totalAssets, userShares] = await Promise.all([
        pool.totalAssets(),
        walletAddress ? pool.balanceOf(walletAddress) : Promise.resolve(null),
      ]);

      const totalStaked = formatUnits(totalAssets, tokenDecimals);

      let stakedAmount = null;
      let stakedAmountRaw = null;
      if (userShares !== null) {
        const assets = await pool.convertToExitAssets(userShares);
        stakedAmountRaw = assets.toString();
        stakedAmount = formatUnits(assets, tokenDecimals);
      }

      return {apy, stakedAmount, stakedAmountRaw, totalStaked};
    } catch (error) {
      console.warn('[mapleProvider] fetchData error:', error);
      return null;
    }
  },
};
