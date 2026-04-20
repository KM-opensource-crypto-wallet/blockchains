import {ethers, formatUnits, parseUnits} from 'ethers';
import erc20 from '../../abis/erc20.json';
import morphoVaultAbi from '../../abis/spark_abi.json'; // MetaMorpho vaults implement ERC4626

// Steakhouse MetaMorpho vaults on Ethereum mainnet
const MORPHO_VAULT_BY_TOKEN = {
  '0xdAC17F958D2ee523a2206206994597C13D831ec7':
    '0xdaD4e51d64c3B65A9d27aD9F3185B09449712065', // USDT → Steakhouse USDT
  '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48':
    '0xBEEF01735c132Ada46AA9aA4c54623cAA92A64CB', // USDC → Steakhouse USDC
};

const MORPHO_GRAPHQL_URL = 'https://blue-api.morpho.org/graphql';

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
  return (parseFloat(raw) * 100).toFixed(2);
};

export const morphoProvider = {
  icon: 'https://image.gatedataimg.com/big_data/173210946183b5009e040969ee7b60362ad7426573.jpeg',
  name: 'Morpho',
  apy: '0% APY',
  stakedAmount: '0',
  stakedAmountRaw: null,
  createStaking: async (
    {from, amount, privateKey, contractAddress, decimals, evmProvider},
    provider,
  ) => {
    try {
      const vaultAddress = getVaultAddress(contractAddress);
      if (!vaultAddress)
        throw new Error(`No Morpho vault for token: ${contractAddress}`);

      const wallet = new ethers.Wallet(privateKey);
      const walletSigner = wallet.connect(evmProvider);
      const amountInWei = parseUnits(amount.toString(), decimals);

      const tokenContract = new ethers.Contract(
        contractAddress,
        erc20,
        walletSigner,
      );
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

      const tx = await vault.deposit(amountInWei, from);
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
    const vaultAddress = getVaultAddress(contractAddress);
    if (!vaultAddress)
      throw new Error(`No Morpho vault found for token: ${contractAddress}`);

    const wallet = new ethers.Wallet(privateKey);
    const walletSigner = wallet.connect(evmProvider);
    const amountInWei = parseUnits(amount.toString(), decimals);

    const tokenContract = new ethers.Contract(
      contractAddress,
      erc20,
      walletSigner,
    );
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
    return {estimateGas};
  },
  unStaking: async (
    {from, privateKey, contractAddress, evmProvider},
    provider,
  ) => {
    try {
      const vaultAddress = getVaultAddress(contractAddress);
      if (!vaultAddress)
        throw new Error(`No Morpho vault for token: ${contractAddress}`);

      const wallet = new ethers.Wallet(privateKey);
      const walletSigner = wallet.connect(evmProvider);
      const vault = new ethers.Contract(
        vaultAddress,
        morphoVaultAbi,
        walletSigner,
      );

      const shares = await vault.balanceOf(from);
      const tx = await vault.redeem(shares, from, from);
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
      const vaultAddress = getVaultAddress(contractAddress);
      if (!vaultAddress)
        throw new Error(`No Morpho vault found for token: ${contractAddress}`);

      const wallet = new ethers.Wallet(privateKey);
      const walletSigner = wallet.connect(evmProvider);
      const vault = new ethers.Contract(
        vaultAddress,
        morphoVaultAbi,
        walletSigner,
      );

      const shares = await vault.balanceOf(from);
      const estimateGas = await vault.redeem.estimateGas(shares, from, from);
      return {estimateGas};
    } catch (e) {
      console.error(
        'Error in morphoProvider getEstimateFeeForDeactivateStaking',
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
  fetchData: async (
    {evmProvider, contractAddress, walletAddress, tokenDecimals},
    provider,
  ) => {
    try {
      const vaultAddress = getVaultAddress(contractAddress);
      if (!vaultAddress) return null;

      const apy = await fetchMorphoVaultAPY(vaultAddress);

      const vault = new ethers.Contract(
        vaultAddress,
        morphoVaultAbi,
        evmProvider,
      );

      let stakedAmount = null;
      let stakedAmountRaw = null;
      if (walletAddress) {
        const shares = await vault.balanceOf(walletAddress);
        const assets = await vault.convertToAssets(shares);
        stakedAmountRaw = assets.toString();
        stakedAmount = formatUnits(assets, tokenDecimals);
      }

      return {apy, stakedAmount, stakedAmountRaw};
    } catch (error) {
      console.warn('[morphoProvider] fetchData error:', error);
      return null;
    }
  },
};
