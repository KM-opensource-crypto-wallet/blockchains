import {ethers, formatUnits, parseUnits} from 'ethers';
import erc20 from '../../abis/erc20.json';
import aavePoolABI from '../../abis/aave_pool.json';
import aaveDataProviderABI from '../../abis/aave_data_provider.json';

export const aavePoolContractAddress =
  '0x87870Bca3F3fD6335C3F4ce8392D69350B4fA4E2';
export const aaveDataProviderContractAddress =
  '0x7B4EB56E7CD4b454BA8ff71E4518426369a138a3';

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
  if (walletAddress && dataProviderContractAddress && dataProviderABI) {
    const dataProvider = new ethers.Contract(
      dataProviderContractAddress,
      dataProviderABI,
      evmProvider,
    );
    const [aTokenAddress] = await dataProvider.getReserveTokensAddresses(
      contractAddress,
    );
    const aToken = new ethers.Contract(aTokenAddress, erc20, evmProvider);
    const balance = await aToken.balanceOf(walletAddress);
    stakedAmount = formatUnits(balance, tokenDecimals);
    stakedAmountRaw = balance.toString();
  }

  return {apy, stakedAmount, stakedAmountRaw};
};

export const aaveProvider = {
  icon: 'https://cdn-icons-png.flaticon.com/512/17978/17978942.png',
  name: 'Aave',
  apy: '0% APY',
  stakedAmount: '0',
  stakedAmountRaw: null,
  poolContractAddress: aavePoolContractAddress,
  poolABI: aavePoolABI,
  dataProviderContractAddress: aaveDataProviderContractAddress,
  dataProviderABI: aaveDataProviderABI,
  createStaking: async (
    {from, amount, privateKey, contractAddress, decimals, evmProvider},
    provider,
  ) => {
    const wallet = new ethers.Wallet(privateKey);
    const walletSigner = wallet.connect(evmProvider);
    const tokenContract = new ethers.Contract(
      contractAddress,
      erc20,
      walletSigner,
    );
    const amountInWei = parseUnits(amount.toString(), decimals);

    const balance = await tokenContract.balanceOf(from);
    if (balance < amountInWei) {
      throw new Error('Insufficient balance');
    }

    const allowance = await tokenContract.allowance(
      from,
      aavePoolContractAddress,
    );
    if (allowance < amountInWei) {
      const approveTx = await tokenContract.approve(
        aavePoolContractAddress,
        amountInWei,
      );
      await approveTx.wait();
    }

    const pool = new ethers.Contract(
      aavePoolContractAddress,
      aavePoolABI,
      walletSigner,
    );
    const gasLimit = await pool.supply.estimateGas(
      contractAddress,
      amountInWei,
      from,
      0,
    );

    await pool.supply.staticCall(contractAddress, amountInWei, from, 0, {
      gasLimit,
    });

    const tx = await pool.supply(contractAddress, amountInWei, from, 0, {
      gasLimit,
    });
    await tx.wait();

    return tx.hash;
  },
  getEstimateFeeForStaking: async (
    {from, amount, privateKey, contractAddress, decimals, evmProvider},
    provider,
  ) => {
    const wallet = new ethers.Wallet(privateKey);
    const walletSigner = wallet.connect(evmProvider);
    const tokenContract = new ethers.Contract(
      contractAddress,
      erc20,
      walletSigner,
    );
    const amountInWei = parseUnits(amount.toString(), decimals);
    const pool = new ethers.Contract(
      aavePoolContractAddress,
      aavePoolABI,
      walletSigner,
    );
    let estimateGas;
    try {
      // Works when allowance is already set
      estimateGas = await pool.supply.estimateGas(
        contractAddress,
        amountInWei,
        from,
        0,
      );
    } catch {
      // Allowance not yet set — estimate approve gas + known Aave v3 supply cost
      const approveGas = await tokenContract.approve.estimateGas(
        aavePoolContractAddress,
        amountInWei,
      );
      // Aave v3 supply consistently costs 220k-280k gas for USDT/USDC
      estimateGas = approveGas + 300000n;
    }
    return {estimateGas};
  },
  unStaking: async (
    {from, amount, privateKey, contractAddress, evmProvider},
    provider,
  ) => {
    try {
      const wallet = new ethers.Wallet(privateKey);
      const walletSigner = wallet.connect(evmProvider);
      const pool = new ethers.Contract(
        aavePoolContractAddress,
        aavePoolABI,
        walletSigner,
      );

      const gasLimit = await pool.withdraw.estimateGas(
        contractAddress,
        ethers.MaxUint256,
        from,
      );

      await pool.withdraw.staticCall(contractAddress, ethers.MaxUint256, from);

      const tx = await pool.withdraw(contractAddress, ethers.MaxUint256, from, {
        gasLimit,
      });
      await tx.wait();

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
    privateKey,
    contractAddress,
    evmProvider,
  }) => {
    try {
      const wallet = new ethers.Wallet(privateKey);
      const walletSigner = wallet.connect(evmProvider);
      const pool = new ethers.Contract(
        aavePoolContractAddress,
        aavePoolABI,
        walletSigner,
      );
      const estimateGas = await pool.withdraw.estimateGas(
        contractAddress,
        ethers.MaxUint256,
        from,
      );
      return {estimateGas};
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
};
