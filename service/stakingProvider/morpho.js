import {ethers, formatUnits} from 'ethers';
import morphoVaultAbi from '../../abis/spark_abi.json'; // MetaMorpho vaults implement ERC4626
import {getTokenLogoUrl} from 'dok-wallet-blockchain-networks/helper';

// Steakhouse MetaMorpho vaults on Ethereum mainnet
const MORPHO_VAULT_BY_TOKEN = {
  '0xdAC17F958D2ee523a2206206994597C13D831ec7':
    '0xbEef047a543E45807105E51A8BBEFCc5950fcfBa', // USDT → Steakhouse USDT
  '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48':
    '0xBEEF01735c132Ada46AA9aA4c54623cAA92A64CB', // USDC → Steakhouse USDC
};

const MORPHO_GRAPHQL_URL = 'https://blue-api.morpho.org/graphql';
const MERKL_API_BASE = 'https://api.merkl.xyz/v4';
const MERKL_DISTRIBUTOR = '0x3Ef3D8bA38EBe18DB133cEc108f4D14CE00Dd9Ae';
const MORPHO_TOKEN = '0x58D97B57BB95320F9a05dC918Aef65434969c2B2';
const MORPHO_TOKEN_DECIMALS = 18;

const merklDistributorAbi = [
  'function claim(address[] users, address[] tokens, uint256[] amounts, bytes32[][] proofs) external',
];

const getVaultAddress = contractAddress =>
  MORPHO_VAULT_BY_TOKEN[
    Object.keys(MORPHO_VAULT_BY_TOKEN).find(
      key => key.toLowerCase() === contractAddress?.toLowerCase(),
    )
  ];

const fetchMorphoVaultAPY = async vaultAddress => {
  const query = `
    query {
      vaultByAddress(address: "${vaultAddress}", chainId: 1) {
        state {
          apy
          netApy
        }
      }
    }
  `;
  const response = await fetch(MORPHO_GRAPHQL_URL, {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({query}),
  });
  const json = await response.json();
  const state = json?.data?.vaultByAddress?.state;
  const raw = state?.netApy ?? state?.apy ?? 0;
  return `${(parseFloat(raw) * 100).toFixed(2)}% APY`;
};

export const morphoProvider = {
  icon: 'https://image.gatedataimg.com/big_data/173210946183b5009e040969ee7b60362ad7426573.jpeg',
  name: 'Morpho',
  apy: '0% APY',
  stakedAmount: '0',
  stakedAmountRaw: null,
  createStaking: async ({
    from,
    amountInWei,
    contractAddress,
    tokenContract,
    walletSigner,
    estimateGas,
  }) => {
    try {
      const vaultAddress = getVaultAddress(contractAddress);
      if (!vaultAddress)
        throw new Error(`No Morpho vault for token: ${contractAddress}`);

      const vault = new ethers.Contract(
        vaultAddress,
        morphoVaultAbi,
        walletSigner,
      );

      // USDT requires resetting allowance to 0 before setting a new value
      const allowance = await tokenContract.allowance(from, vaultAddress);
      if (allowance > 0n) {
        const resetTx = await tokenContract.approve(vaultAddress, 0n);
        await resetTx.wait();
      }
      const approveTx = await tokenContract.approve(vaultAddress, amountInWei);
      await approveTx.wait();

      const gasLimit =
        typeof estimateGas === 'bigint'
          ? estimateGas
          : await vault.deposit.estimateGas(amountInWei, from);

      const tx = await vault.deposit.populateTransaction(amountInWei, from, {
        gasLimit,
      });

      return tx;
    } catch (error) {
      console.log(error);
      throw error;
    }
  },
  getEstimateFeeForStaking: async ({
    from,
    amountInWei,
    contractAddress,
    tokenContract,
    walletSigner,
  }) => {
    const vaultAddress = getVaultAddress(contractAddress);
    if (!vaultAddress)
      throw new Error(`No Morpho vault found for token: ${contractAddress}`);

    const vault = new ethers.Contract(
      vaultAddress,
      morphoVaultAbi,
      walletSigner,
    );

    let estimateGas;
    try {
      estimateGas = await vault.deposit.estimateGas(amountInWei, from);
    } catch {
      const approveGas = await tokenContract.approve.estimateGas(
        vaultAddress,
        amountInWei,
      );
      estimateGas = approveGas + 250000n;
    }
    return {
      estimateGas,
      toAddress: vaultAddress,
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
      const vaultAddress = getVaultAddress(contractAddress);
      if (!vaultAddress)
        throw new Error(`No Morpho vault for token: ${contractAddress}`);

      const vault = new ethers.Contract(
        vaultAddress,
        morphoVaultAbi,
        walletSigner,
      );

      const userShares = await vault.balanceOf(from);
      let shares;
      if (amountInWei !== undefined) {
        const rawShares = await vault.convertToShares(amountInWei);
        // Cap at actual balance — convertToShares can round UP and cause revert.
        shares = rawShares > userShares ? userShares : rawShares;
      } else {
        shares = userShares;
      }

      const gasLimit =
        typeof estimateGas === 'bigint'
          ? estimateGas
          : await vault.redeem.estimateGas(shares, from, from);

      const tx = await vault.redeem.populateTransaction(shares, from, from, {
        gasLimit,
      });
      return tx;
    } catch (error) {
      console.log(error);
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
      const vaultAddress = getVaultAddress(contractAddress);
      if (!vaultAddress)
        throw new Error(`No Morpho vault found for token: ${contractAddress}`);

      const vault = new ethers.Contract(
        vaultAddress,
        morphoVaultAbi,
        walletSigner,
      );

      const shares =
        amountInWei !== undefined
          ? await vault.convertToShares(amountInWei)
          : await vault.balanceOf(from);
      const estimateGas = await vault.redeem.estimateGas(shares, from, from);
      return {
        estimateGas,
        toAddress: vaultAddress,
        value: shares,
      };
    } catch (e) {
      console.error(
        'Error in morphoProvider getEstimateFeeForDeactivateStaking',
        e,
      );
      throw e;
    }
  },
  getStakingBalance: async ({evmProvider, address, contractAddress}) => {
    try {
      const vaultAddress = getVaultAddress(contractAddress);
      if (!vaultAddress)
        throw new Error(`No Morpho vault for token: ${contractAddress}`);

      const vault = new ethers.Contract(
        vaultAddress,
        morphoVaultAbi,
        evmProvider,
      );
      const shares = await vault.balanceOf(address);

      return {
        stakingBalance: shares.toString() || '0',
        energyBalance: '0',
        bandwidthBalance: '0',
      };
    } catch (error) {
      console.error(
        '[morphoProvider getStakingBalance] error:',
        error?.message,
      );
      throw error;
    }
  },
  fetchData: async ({
    evmProvider,
    contractAddress,
    walletAddress,
    tokenDecimals,
  }) => {
    try {
      const vaultAddress = getVaultAddress(contractAddress);
      if (!vaultAddress) return null;

      const apy = await fetchMorphoVaultAPY(vaultAddress);

      const vault = new ethers.Contract(
        vaultAddress,
        morphoVaultAbi,
        evmProvider,
      );

      const [totalAssets, userShares] = await Promise.all([
        vault.totalAssets(),
        walletAddress ? vault.balanceOf(walletAddress) : Promise.resolve(null),
      ]);

      const totalStaked = formatUnits(totalAssets, tokenDecimals);

      let stakedAmount = null;
      let stakedAmountRaw = null;
      if (userShares !== null) {
        const assets = await vault.convertToAssets(userShares);
        stakedAmountRaw = assets.toString();
        stakedAmount = formatUnits(assets, tokenDecimals);
      }

      return {apy, stakedAmount, stakedAmountRaw, totalStaked};
    } catch (error) {
      console.warn('[morphoProvider] fetchData error:', error);
      return null;
    }
  },
  getEstimateFeeForClaimRewards: async () => {
    // Merkl claim gas varies by proof size; 200k covers most cases
    return {estimateGas: 200000n, toAddress: MERKL_DISTRIBUTOR, value: 0n};
  },
  getRewards: async ({from}) => {
    const rewardBase = {
      token: MORPHO_TOKEN,
      symbol: 'MORPHO',
      logo: getTokenLogoUrl(MORPHO_TOKEN),
    };
    try {
      const response = await fetch(
        `${MERKL_API_BASE}/userRewards?user=${from}&chainId=1`,
      );
      if (!response.ok) throw new Error(`Merkl API error: ${response.status}`);
      const data = await response.json();
      // data is keyed by token address (may be checksummed or lowercase)
      const morphoKey = Object.keys(data).find(
        k => k.toLowerCase() === MORPHO_TOKEN.toLowerCase(),
      );
      const unclaimed = morphoKey ? data[morphoKey]?.unclaimed ?? '0' : '0';
      return {
        ...rewardBase,
        amount: formatUnits(BigInt(unclaimed), MORPHO_TOKEN_DECIMALS),
      };
    } catch (error) {
      console.warn('[morphoProvider getRewards] error:', error?.message);
      return {...rewardBase, amount: '0'};
    }
  },
  claimRewards: async ({from, privateKey, evmProvider}) => {
    try {
      const response = await fetch(
        `${MERKL_API_BASE}/claim?user=${from}&chainId=1`,
      );
      if (!response.ok) throw new Error(`Merkl API error: ${response.status}`);
      const claimData = await response.json();
      if (!claimData?.tokens?.length) {
        console.log('[morphoProvider] No claimable Merkl rewards');
        return null;
      }
      const wallet = new ethers.Wallet(privateKey);
      const walletSigner = wallet.connect(evmProvider);
      const distributor = new ethers.Contract(
        MERKL_DISTRIBUTOR,
        merklDistributorAbi,
        walletSigner,
      );
      const tx = await distributor.claim(
        claimData.users,
        claimData.tokens,
        claimData.amounts,
        claimData.proofs,
      );
      const receipt = await tx.wait();
      return receipt.hash;
    } catch (error) {
      console.log('[morphoProvider claimRewards] error:', error);
      throw error;
    }
  },
};
