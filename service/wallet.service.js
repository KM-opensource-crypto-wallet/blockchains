import { getCoin } from 'dok-wallet-blockchain-networks/cryptoChain';
import { getTransferDataEstimateFee } from 'dok-wallet-blockchain-networks/redux/currentTransfer/currentTransferSelector';
import { getPrice } from 'dok-wallet-blockchain-networks/service/coinMarketCap';
import {
  getPendingTransactions,
  getPendingTransactionsWithKey,
  selectCurrentCoin,
  selectCurrentWallet,
} from 'dok-wallet-blockchain-networks/redux/wallets/walletsSelector';
import { selectAllActiveCurrencies } from 'dok-wallet-blockchain-networks/redux/currency/currencySelectors';
import {
  calculatePrice,
  createBalanceKey,
  createPendingTransactionKey,
  isBitcoinChain,
  isEVMChain,
  isPendingTransactionSupportedChain,
  isStakingChain,
  parseBalance,
  validateSupportedChain,
} from 'dok-wallet-blockchain-networks/helper';
import BigNumber from 'bignumber.js';
import { APP_VERSION } from '../../src/utils/common';

export const getCoinSnapshot = async (
  state,
  _coinDef,
  _wallet,
  priceObj,
  skipData,
  fetchTransactions,
  isFetchStaking,
  fetchUTXOs,
) => {
  try {
    const coinDef = _coinDef ?? selectCurrentCoin(state);
    const wallet = _wallet ?? selectCurrentWallet(state);
    const nativeCoin = await getCoin(wallet.phrase, coinDef, null, wallet);
    let trxs = [];
    let utxos = [];
    let balance = 0;
    let deriveAddresses = [];
    const isBitcoin = isBitcoinChain(coinDef?.chain_name);
    const isStaking = isStakingChain(coinDef?.chain_name);
    let staking = [];
    let finalStaking = [];
    let stakingBalance = 0;
    let energyBalance = 0;
    let bandwidthBalance = 0;
    let parseStakingBalance = 0;
    let stakingInfo = [];
    const currentPrice = priceObj[coinDef.symbol] || 0;
    if (coinDef?.chain_name === 'tron' && coinDef?.type === 'coin') {
      const stakingBalanceInfo = (await nativeCoin.getStakingBalance?.()) || {};
      stakingBalance = stakingBalanceInfo?.stakingBalance || 0;
      energyBalance = stakingBalanceInfo?.energyBalance || 0;
      bandwidthBalance = stakingBalanceInfo?.bandwidthBalance || 0;
    }
    if (isStaking && coinDef?.type === 'coin' && isFetchStaking) {
      staking = (await nativeCoin.getStaking?.()) || [];
      finalStaking = staking.map(item => {
        const amount = item?.amount;
        return {
          ...item,
          fiatAmount: calculatePrice(amount, coinDef?.decimal, currentPrice),
          amount: parseBalance(amount, coinDef?.decimal),
        };
      });
      parseStakingBalance = parseBalance(stakingBalance, coinDef?.decimal);
      stakingInfo =
        (await nativeCoin.getStakingInfo({
          staking: finalStaking,
          stakingBalance: parseStakingBalance,
        })) || [];
    }
    if (!skipData) {
      if (fetchTransactions) {
        let pendingTransactions = [];
        let key = null;
        if (isPendingTransactionSupportedChain(coinDef?.chain_name)) {
          const tempTransactions = getPendingTransactions(state);
          key = createPendingTransactionKey({
            chain_name: coinDef?.chain_name,
            symbol: coinDef?.symbol,
            address: coinDef?.address,
          });
          pendingTransactions = getPendingTransactionsWithKey(
            tempTransactions,
            key,
          );
        }
        trxs = await nativeCoin.getTransactions?.({
          pendingTransactions,
          key,
          deriveAddresses: coinDef?.deriveAddresses,
        });
      }
      if (fetchUTXOs) {
        utxos = await nativeCoin.getUTXOs?.();
      }
      if (isBitcoin) {
        const resp = (await nativeCoin.getBalance?.()) || 0;
        balance = resp?.totalBalance || 0;
        if (Array.isArray(resp?.deriveAddresses)) {
          deriveAddresses = resp?.deriveAddresses;
        }
      } else {
        balance = (await nativeCoin.getBalance?.()) || 0;
      }
    }
    const finalUTXOs = Array.isArray(utxos) ? utxos : [];
    const allTransactions = Array.isArray(trxs) ? trxs : [];
    const finalTransactions = allTransactions.map(item => {
      const amount = item?.amount;
      return {
        ...item,
        totalCourse: calculatePrice(amount, coinDef?.decimal, currentPrice),
        amount: parseBalance(amount, coinDef?.decimal),
      };
    });

    const totalBalanceString = new BigNumber(stakingBalance)
      .plus(new BigNumber(balance))
      .toString();
    const newCoin = {
      ...coinDef,
      appVersion: APP_VERSION,
      privateKey: nativeCoin.privateKey,
      phrase: nativeCoin.phrase,
      address: nativeCoin.address,
      publicKey: nativeCoin?.publicKey,
      extendedPublicKey: nativeCoin?.extendedPublicKey,
      extendedPrivateKey: nativeCoin?.extendedPrivateKey,
      totalCourse: calculatePrice(balance, coinDef?.decimal, currentPrice),
      totalAmount: parseBalance(balance, coinDef?.decimal),
      stakingCourse: calculatePrice(
        stakingBalance,
        coinDef?.decimal,
        currentPrice,
      ),
      stakingBalance: parseStakingBalance,
      totalBalanceCourse: calculatePrice(
        totalBalanceString,
        coinDef?.decimal,
        currentPrice,
      ),
      totalBalance: parseBalance(totalBalanceString, coinDef?.decimal),
      currencyRate: currentPrice,
      transactions: finalTransactions,
      staking: finalStaking,
      stakingInfo,
      energyBalance: parseBalance(energyBalance, coinDef?.decimal),
      bandwidthBalance: parseBalance(bandwidthBalance, coinDef?.decimal),
    };
    if (isBitcoin) {
      newCoin.deriveAddresses = deriveAddresses;
      newCoin.UTXOs = finalUTXOs;
    }
    return newCoin;
  } catch (err) {
    console.error('Error in getCoinSnapshot', err);
    throw err;
  }
};

export const getNativeCoin = async (state, coinSnapshot, walletSnapshot) => {
  const wallet = walletSnapshot || selectCurrentWallet(state);
  const coin = coinSnapshot || selectCurrentCoin(state);
  let transactionFee = null;
  const validatedChainName = validateSupportedChain(coin?.chain_name);
  if (!validatedChainName) {
    console.error('chain not supported');
    return null;
  }
  if (coin?.type === 'token') {
    transactionFee = getTransferDataEstimateFee(state);
  }
  return getCoin(wallet.phrase, coin, transactionFee, wallet);
};
export const createCoins = async (wallet, state, skipData) => {
  const coins = [];
  const allActiveCurrency = selectAllActiveCurrencies(state);
  const allSymbols = allActiveCurrency?.map(item => item.symbol)?.join(',');
  const localCurrency = state.settings.localCurrency || 'USD';
  let priceObj = {};
  if (!skipData) {
    priceObj = await getPrice(allSymbols, localCurrency);
  }

  for (const coin of allActiveCurrency) {
    const validatedChainName = validateSupportedChain(coin?.chain_name);
    if (!validatedChainName) {
      continue;
    }
    const newCoin = await getCoinSnapshot(
      state,
      coin,
      wallet,
      priceObj,
      skipData,
    );
    coins.push(newCoin);
  }
  return coins;
};

export const createCoin = async (wallet, coin, state) => {
  const symbol = coin?.symbol;
  const localCurrency = state.settings.localCurrency || 'USD';
  const priceObj = await getPrice(symbol, localCurrency);
  const validatedChainName = validateSupportedChain(coin?.chain_name);
  if (!validatedChainName) {
    return null;
  }
  return await getCoinSnapshot(
    state,
    coin,
    wallet,
    priceObj,
    false,
    false,
    false,
  );
};

const updateDeriveAddressesInCoin = (parentCoin, newCoin) => {
  const deriveAddresses = parentCoin?.deriveAddresses;
  const address = parentCoin?.address;
  if (Array.isArray(deriveAddresses) && deriveAddresses?.length) {
    return { ...newCoin, deriveAddresses, address };
  }
  console.warn('derive address not found while adding coin');
  return newCoin;
};

export const addExistingDeriveAddress = (currentWallet, coin) => {
  const coinType = coin?.type;
  const chainName = coin?.chain_name;
  const allCoins = Array.isArray(currentWallet?.coins)
    ? currentWallet?.coins
    : [];
  if (allCoins?.length) {
    if (coinType === 'token') {
      const parentCoin = allCoins.find(
        item => item.type === 'coin' && item?.chain_name === chainName,
      );
      if (parentCoin) {
        return updateDeriveAddressesInCoin(parentCoin, coin);
      }
    }
    if (isEVMChain(chainName)) {
      const ethereumCoin = allCoins.find(
        item => item.type === 'coin' && item?.chain_name === 'ethereum',
      );
      return updateDeriveAddressesInCoin(ethereumCoin, coin);
    }
  }
  return coin;
};

export const fetchBatchTransactionBalances = async (
  transactions,
  currentState,
  validateSufficientBalance = false,
) => {
  const uniqueCoins = {};
  const uniqueCoinDetails = [];
  const transactionAmounts = {}; // Track total amounts needed per coin using BigNumber

  // Process transactions and collect unique coins + required amounts
  transactions?.forEach(transaction => {
    const key = createBalanceKey(transaction?.coinInfo);

    if (!uniqueCoins[key]) {
      uniqueCoins[key] = true;
      uniqueCoinDetails.push(transaction?.coinInfo);
      transactionAmounts[key] = new BigNumber(0);
    }

    // Add transaction amount to total needed for this coin using BigNumber
    const amount = new BigNumber(transaction?.transferData?.amount || 0);
    transactionAmounts[key] = transactionAmounts[key].plus(amount);
  });

  // Fetch current balances
  const tPromises = uniqueCoinDetails.map(async item => {
    const chain = await getNativeCoin(currentState, item);
    const address = item?.address;
    const contractAddress = item?.contractAddress;
    const decimal = item?.decimal;
    const balance = await chain?.getBalance?.({ address, contractAddress });
    return parseBalance(balance, decimal);
  });

  const balances = await Promise.all(tPromises);
  const balanceObj = {};

  // Create balance object and validate if requested
  for (let i = 0; i < balances.length; i++) {
    const coinInfo = uniqueCoinDetails?.[i];
    const balance = balances[i];
    const key = createBalanceKey(coinInfo);
    balanceObj[key] = balance;

    // Balance validation using BigNumber for precise comparison
    if (validateSufficientBalance) {
      const transactionKey = createBalanceKey(coinInfo);
      const requiredAmount = transactionAmounts[transactionKey];
      const availableBalance = new BigNumber(balance || 0);

      if (availableBalance.isLessThan(requiredAmount)) {
        throw new Error(
          `Insufficient balance for ${coinInfo?.symbol || 'token'} on ${coinInfo?.chain_display_name || coinInfo?.chain_name
          }. ` +
          `Required: ${requiredAmount.toString()}, Available: ${availableBalance.toString()}`,
        );
      }
    }
  }

  return balanceObj;
};
