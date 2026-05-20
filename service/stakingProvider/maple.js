import {ethers, formatUnits, parseUnits} from 'ethers';
import erc20 from '../../abis/erc20.json';
import maplePoolABI from '../../abis/maple_pool.json';
import mapleSyrupRouterABI from '../../abis/maple_syrup_router.json';

const MAPLE_DEPOSIT_DATA = ethers.encodeBytes32String('0:dokwallet');

// Returns { isSyrupLender: boolean }
const checkMapleSyrupLender = async walletAddress => {
  const query = `{ account(id: "${walletAddress.toLowerCase()}") { isSyrupLender } }`;
  const response = await fetch(MAPLE_GRAPHQL_URL, {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({query}),
  });
  const json = await response.json();
  return json?.data?.account?.isSyrupLender === true;
};

// Fetches authorization signature via Maple GraphQL for non-whitelisted wallets.
// v is raw (0 or 1) from the API and must be converted to 27/28 per Maple docs.
const fetchMapleAuthSignature = async (walletAddress, poolAddress) => {
  try {
    const query = `{ getPoolSignature(lender: "${walletAddress}", poolId: "${poolAddress}") { deadline bitmap r s v } }`;
    const response = await fetch(MAPLE_GRAPHQL_URL, {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({query}),
    });
    const json = await response.json();
    const sig = json?.data?.getPoolSignature;
    if (!sig?.bitmap || !sig?.deadline || sig?.v == null) return null;
    const rawV = Number(sig.v);
    const v = rawV === 0 ? 27 : 28;
    const toHex = val => (String(val).startsWith('0x') ? val : `0x${val}`);
    return {
      bitmap: sig.bitmap,
      deadline: sig.deadline,
      v,
      r: toHex(sig.r),
      s: toHex(sig.s),
    };
  } catch {
    return null;
  }
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
    _provider,
  ) => {
    try {
      const config = getVaultConfig(contractAddress);
      if (!config)
        throw new Error(`No Maple vault for token: ${contractAddress}`);

      const [isSyrupLender, authSig] = await Promise.all([
        checkMapleSyrupLender(from),
        fetchMapleAuthSignature(from, config.poolAddress),
      ]);

      if (!isSyrupLender && !authSig)
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

      let tx;
      if (isSyrupLender) {
        tx = await router.deposit(amountInWei, MAPLE_DEPOSIT_DATA);
      } else {
        tx = await router.authorizeAndDeposit(
          authSig.bitmap,
          authSig.deadline,
          authSig.v,
          authSig.r,
          authSig.s,
          amountInWei,
          MAPLE_DEPOSIT_DATA,
        );
      }
      const receipt = await tx.wait();

      return receipt.hash;
    } catch (error) {
      console.log(error);
      throw error;
    }
  },
  getEstimateFeeForStaking: async (
    {from, amount, privateKey, contractAddress, decimals, evmProvider},
    _provider,
  ) => {
    const config = getVaultConfig(contractAddress);
    if (!config)
      throw new Error(`No Maple vault found for token: ${contractAddress}`);

    const [isSyrupLender, authSig] = await Promise.all([
      checkMapleSyrupLender(from),
      fetchMapleAuthSignature(from, config.poolAddress),
    ]);

    if (!isSyrupLender && !authSig)
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
        MAPLE_DEPOSIT_DATA,
      );
    } catch {
      const approveGas = await tokenContract.approve.estimateGas(
        config.routerAddress,
        amountInWei,
      );
      // authorizeAndDeposit costs slightly more than a plain deposit
      estimateGas = approveGas + (isSyrupLender ? 250000n : 300000n);
    }
    return {estimateGas};
  },
  unStaking: async (
    {from, privateKey, contractAddress, evmProvider},
    _provider,
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
      const tx = await pool.requestRedeem(shares, from); // NOTE: Withdrawals are processed automatically by Maple. If there is sufficient liquidity in the pool, the withdrawal will be processed within a few minutes. Expected processing time is typically less than 2 days, but it can take up to 30 days depending on available liquidity.
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
    _provider,
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
    _provider,
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
