import {
  getCoin,
  getHashString,
} from 'dok-wallet-blockchain-networks/cryptoChain';
import {createAsyncThunk, createSlice} from '@reduxjs/toolkit';
import {
  clearSelectedUTXOs,
  setCurrentTransferSubmitting,
  setPendingTransferSubmitting,
  setUpdateTransactionSubmitting,
} from 'dok-wallet-blockchain-networks/redux/currentTransfer/currentTransferSlice';
import {getPrice} from 'dok-wallet-blockchain-networks/service/coinMarketCap';
import {
  fetchCoinByChainAPI,
  fetchCurrenciesAPI,
  registerUserAPI,
} from 'dok-wallet-blockchain-networks/service/dokApi';
import {
  addExistingDeriveAddress,
  createCoin,
  createCoins,
  fetchBatchTransactionBalances,
  getCoinSnapshot,
  getNativeCoin,
} from 'dok-wallet-blockchain-networks/service/wallet.service';
import {
  _currentWalletIndexSelector,
  getCurrentWalletIndex,
  getMasterClientId,
  getSelectedNftData,
  selectAllCoins,
  selectAllCoinSymbol,
  selectAllWalletName,
  selectAllWallets,
  selectCoinsForCurrentWallet,
  selectCurrentCoin,
  selectCurrentWallet,
  selectUserCoins,
} from 'dok-wallet-blockchain-networks/redux/wallets/walletsSelector';
import {getTransferData} from 'dok-wallet-blockchain-networks/redux/currentTransfer/currentTransferSelector';
import {
  calculatePrice,
  checkValidChainForWalletImportWithPrivateKey,
  isEVMChain,
  generateUniqueKeyForChain,
  getNativeCoinByTokenCoin,
  isBitcoinChain,
  parseBalance,
  validateSupportedChain,
  isDeriveAddressSupportChain,
  MORALIS_CHAIN_TO_CHAIN,
  NFT_SUPPORTED_CHAIN,
  isStakingChain,
  moveItem,
  validateNumber,
  isPendingTransactionSupportedChain,
  createPendingTransactionKey,
  getIndexFromDerivePath,
  getLargestNumber,
} from 'dok-wallet-blockchain-networks/helper';
import {
  fetchEVMNftApi,
  fetchSolanaNftApi,
} from 'dok-wallet-blockchain-networks/service/moralis';
import {config} from 'dok-wallet-blockchain-networks/config/config';
import BigNumber from 'bignumber.js';
import {
  addCustomDeriveAddressToWallet,
  addDeriveAddresses,
  generateMnemonics,
} from 'myWallet/wallet.service';
import {APP_VERSION} from 'utils/common';
import {showToast} from 'utils/toast';
import {MainNavigation} from 'utils/navigation';
import {v4} from 'uuid';
import {
  setIsAddingGroup,
  setIsRemovingGroup,
} from 'dok-wallet-blockchain-networks/redux/currency/currencySlice';
import {getIsMaxWalletLimitReached} from 'dok-wallet-blockchain-networks/redux/cryptoProviders/cryptoProvidersSelectors';
import {clearTransactionsForSelectedChain} from 'dok-wallet-blockchain-networks/redux/batchTransaction/batchTransactionSlice';

const getUniqueAccounts = (oldAccounts, newAccounts) => {
  if (!Array.isArray(oldAccounts) && Array.isArray(newAccounts)) {
    return newAccounts;
  } else if (Array.isArray(oldAccounts) && Array.isArray(newAccounts)) {
    let newUniqueAccount = [];
    for (let i = 0; i < newAccounts.length; i++) {
      const tempNewAccount = newAccounts[i];
      const foundAccount = oldAccounts.find(
        item =>
          item.address === tempNewAccount.address ||
          item.derivePath === tempNewAccount.derivePath,
      );
      if (!foundAccount) {
        newUniqueAccount.push(tempNewAccount);
      }
    }
    return [...oldAccounts, ...newUniqueAccount];
  }
};

const getUniqueCoins = coins => {
  if (!Array.isArray(coins)) {
    return coins;
  } else if (Array.isArray(coins)) {
    let uniqueCoins = [];
    for (let i = 0; i < coins.length; i++) {
      const tempCoin = coins[i];
      const key = generateUniqueKeyForChain(tempCoin);
      const foundAccount = uniqueCoins.find(item => {
        const newKey = generateUniqueKeyForChain(item);
        return key === newKey;
      });
      if (!foundAccount) {
        uniqueCoins.push(tempCoin);
      }
    }
    return uniqueCoins;
  }
};

const refreshCoinData = (dispatch, currentCoin) => {
  if (
    MainNavigation.getCurrentRouteName() === 'TransactionList' ||
    MainNavigation.getCurrentRouteName() === '/home/transactions'
  ) {
    dispatch(
      refreshCurrentCoin({
        currentCoin,
        fetchTransaction: true,
      }),
    );
  } else {
    dispatch(refreshCoins());
  }
};

export const createWallet = createAsyncThunk(
  'wallets/createWallet',
  async (walletData, thunkAPI) => {
    //const {walletName, phrase} = walletData;
    const currentState = thunkAPI.getState();
    const allWalletsName = selectAllWalletName(currentState);
    const allWallets = selectAllWallets(currentState);
    const currentWallet = selectCurrentWallet(currentState);
    const isMaxWalletLimitReached = getIsMaxWalletLimitReached(currentState);
    if (isMaxWalletLimitReached) {
      const message =
        'You have reached the maximum wallet limit, For more details ask contact support';
      console.warn(message);
      showToast({
        type: 'errorToast',
        title: message,
      });
      return thunkAPI.rejectWithValue(message);
    }

    const newStoreWallet = {
      walletName: walletData.walletName ?? currentWallet.walletName,
      clientId: v4(),
    };
    let isFromImportWallet = !!walletData.phrase || !!walletData?.privateKey;
    let isImportWalletWithPrivateKey = !!walletData?.privateKey;
    let privateKey = null;
    let address = null;
    let chain_name = null;
    if (!walletData.phrase && !walletData?.privateKey) {
      const nativeWallet = await generateMnemonics();
      walletData.phrase = nativeWallet.mnemonic.phrase;
    }
    let coins;
    try {
      // coins = await createCoins(walletData.phrase);
      if (walletData?.privateKey && walletData?.chain_name) {
        const newCoin = await fetchCoinByChainAPI({
          chain_name: walletData?.chain_name,
        });
        if (!newCoin) {
          console.error('coin not found');
          return thunkAPI.rejectWithValue('coin not found');
        }
        const createdCoin = await createCoin(
          walletData,
          {...newCoin, isInWallet: true},
          currentState,
        );
        if (createdCoin?.address && createdCoin?.privateKey) {
          address = createdCoin?.address;
          privateKey = createdCoin?.privateKey;
          chain_name = walletData?.chain_name;
          coins = [createdCoin];
        } else {
          console.error('coin not created');
          return thunkAPI.rejectWithValue('coin not created');
        }
      } else {
        coins = await createCoins(walletData, currentState, true);
      }
    } catch (error) {
      console.error('error in createCoins', error);
      return thunkAPI.rejectWithValue(error);
      // throw error;
    }
    newStoreWallet.coins = coins;
    coins
      .filter(item => item?.status)
      .forEach(item => (item.isInWallet = true));
    if (walletData?.phrase) {
      newStoreWallet.phrase = walletData.phrase;
    }
    if (!walletData.replace) {
      if (allWallets.length === 0 && !newStoreWallet.walletName) {
        newStoreWallet.walletName = 'Main Wallet';
      } else if (
        allWalletsName.includes(newStoreWallet.walletName) ||
        !newStoreWallet.walletName
      ) {
        let newWalletName;
        if (allWallets.length) {
          let newWalletIndex = allWallets.length + 1;
          do {
            newWalletName = `Wallet ${newWalletIndex}`;
            newWalletIndex += 1;
          } while (allWalletsName.includes(newWalletName) === true);
        }
        newStoreWallet.walletName = newWalletName;
      }
      newStoreWallet.id = `${allWallets.length + 1}`;
    }
    walletData.newStoreWallet = newStoreWallet;
    const masterClientId = getMasterClientId(currentState);
    registerUserAPI({
      coins: walletData.newStoreWallet?.coins,
      clientId: walletData?.clientId,
      masterClientId,
      is_create_wallet: true,
      is_imported: isFromImportWallet,
    });
    return {
      newStoreWallet: newStoreWallet,
      replace: walletData.replace,
      isFromImportWallet,
      isImportWalletWithPrivateKey,
      address,
      privateKey,
      chain_name,
    };
  },
);

export const addToken = createAsyncThunk(
  'wallets/addToken',
  async (tokenData, thunkAPI) => {
    //const {walletName, phrase} = walletData;
    const validatedChainName = validateSupportedChain(tokenData?.chain_name);
    if (!validatedChainName) {
      console.error('chain not supported');
      return null;
    }
    const currentState = thunkAPI.getState();
    const allCoinSymbol = selectAllCoinSymbol(currentState);
    if (allCoinSymbol.includes(generateUniqueKeyForChain(tokenData))) {
      console.error(`${tokenData?.symbol} already added`);
      showToast({
        type: 'errorToast',
        title: 'Duplication',
        message: `${tokenData?.symbol} already added`,
      });

      return null;
    }

    const currentWallet = selectCurrentWallet(currentState);
    const nativeCoin = await getCoin(
      currentWallet.phrase,
      tokenData,
      null,
      currentWallet,
    );
    const isBitcoin = isBitcoinChain(tokenData?.chain_name);
    const isStaking = isStakingChain(tokenData?.chain_name);

    const symbol = tokenData.symbol;
    const localCurrency = currentState.settings.localCurrency || 'USD';
    const priceObj = await getPrice(symbol, localCurrency);
    const currentPrice = priceObj[tokenData.symbol] || 0;

    let balance = 0;
    let energyBalance = 0;
    let bandwidthBalance = 0;
    let deriveAddresses = [];
    let stakingBalance = 0;
    let stakingInfo = [];
    let staking = [];
    let finalStaking = [];
    let parseStakingBalance = 0;

    // It takes long time
    if (tokenData?.chain_name === 'tron' && tokenData?.type === 'coin') {
      const stakingBalanceInfo = (await nativeCoin.getStakingBalance?.()) || {};
      stakingBalance = stakingBalanceInfo?.stakingBalance || 0;
      energyBalance = stakingBalanceInfo?.energyBalance || 0;
      bandwidthBalance = stakingBalanceInfo?.bandwidthBalance || 0;
    }
    if (isStaking && tokenData?.type !== 'coin') {
      staking = (await nativeCoin.getStaking?.()) || [];
      finalStaking = staking.map(item => {
        const amount = item?.amount;
        return {
          ...item,
          fiatAmount: calculatePrice(amount, tokenData?.decimal, currentPrice),
          amount: parseBalance(amount, tokenData?.decimal),
        };
      });
      parseStakingBalance = parseBalance(stakingBalance, tokenData?.decimal);
      stakingInfo =
        (await nativeCoin.getStakingInfo({
          staking: finalStaking,
          stakingBalance: parseStakingBalance,
        })) || [];
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

    const totalBalanceString = new BigNumber(stakingBalance)
      .plus(new BigNumber(balance))
      .toString();
    let coinObj = {
      ...tokenData,
      isInWallet: true,
      address: nativeCoin.address,
      privateKey: nativeCoin.privateKey,
      publicKey: nativeCoin.publicKey,
      phrase: nativeCoin.phrase,
      totalCourse: calculatePrice(balance, tokenData?.decimal, currentPrice),
      currencyRate: currentPrice,
      totalAmount: parseBalance(balance, tokenData?.decimal),
      appVersion: APP_VERSION,
      transactions: [],
      stakingCourse: calculatePrice(
        stakingBalance,
        tokenData?.decimal,
        currentPrice,
      ),
      stakingBalance: parseBalance(stakingBalance, tokenData?.decimal),
      totalBalanceCourse: calculatePrice(
        totalBalanceString,
        tokenData?.decimal,
        currentPrice,
      ),
      totalBalance: parseBalance(totalBalanceString, tokenData?.decimal),
      stakingInfo,
      energyBalance: parseBalance(energyBalance, tokenData?.decimal),
      bandwidthBalance: parseBalance(bandwidthBalance, tokenData?.decimal),
    };
    if (isBitcoin) {
      coinObj.deriveAddresses = deriveAddresses;
    }
    coinObj = addExistingDeriveAddress(currentWallet, coinObj);
    if (currentWallet.clientId) {
      const masterClientId = getMasterClientId(currentState);
      registerUserAPI({
        coins: [coinObj],
        clientId: currentWallet.clientId,
        masterClientId,
        is_imported: currentWallet?.isBackedup,
      });
    }
    return coinObj;
  },
);

export const refreshCoins = createAsyncThunk(
  'wallets/refreshCoins',
  async (refreshData, thunkAPI) => {
    try {
      const currentState = thunkAPI.getState();
      const currentWallet = selectCurrentWallet(currentState);
      const currentWalletIndex = _currentWalletIndexSelector(currentState);
      const oldCoins = selectAllCoins(currentState);
      const filterCoins = oldCoins.filter(
        item => !!validateSupportedChain(item?.chain_name),
      );
      const allSymbols = oldCoins?.map(item => item.symbol)?.join(',');
      const localCurrency = currentState.settings.localCurrency || 'USD';
      const priceObj = await getPrice(allSymbols, localCurrency);
      const resp = await Promise.all(
        filterCoins.map(async coin => {
          return await getCoinSnapshot(
            currentState,
            coin,
            currentWallet,
            priceObj,
            false,
            false,
            false,
            false,
          );
        }),
      );
      return {coinData: resp, currentWalletIndex};
    } catch (e) {
      console.error('Error in refreshCoins', e);
      return thunkAPI.rejectWithValue('Something went wrong refreshCoins');
    }
  },
);

export const refreshCurrentCoin = createAsyncThunk(
  'wallets/refreshCurrentCoin',
  async (refreshData, thunkAPI) => {
    const currentState = thunkAPI.getState();
    const currentWallet = selectCurrentWallet(currentState);
    const currentCoin =
      refreshData?.currentCoin || selectCurrentCoin(currentState);
    const isFetchTransactions = refreshData?.fetchTransaction || false;
    const isFetchUTXOs = refreshData?.fetchUTXOs || false;
    const isFetchStaking = refreshData?.isFetchStaking || false;
    const allCoins = selectUserCoins(currentState);
    const parentCoin = getNativeCoinByTokenCoin(allCoins, currentCoin);
    const validatedChainName = validateSupportedChain(currentCoin?.chain_name);
    if (!currentCoin || !validatedChainName) {
      console.error('chain not supported');
      return null;
    }
    const symbol = currentCoin?.symbol;
    const localCurrency = currentState.settings.localCurrency || 'USD';
    const priceObj = await getPrice(symbol, localCurrency);
    const updatedCurrentCoin = await getCoinSnapshot(
      currentState,
      currentCoin,
      currentWallet,
      priceObj,
      false,
      isFetchTransactions,
      isFetchStaking,
      isFetchUTXOs,
    );
    let updatedNativeCoin;
    if (parentCoin) {
      const parentPriceObj = await getPrice(parentCoin?.symbol, localCurrency);
      updatedNativeCoin = await getCoinSnapshot(
        currentState,
        parentCoin,
        currentWallet,
        parentPriceObj,
        false,
        false,
        false,
        false,
      );
    }
    return {updatedCurrentCoin, updatedNativeCoin};
  },
);

export const syncCoinsWithServer = createAsyncThunk(
  'wallets/syncCoinsWithServer',
  async (_, thunkAPI) => {
    let toastId;
    try {
      toastId = showToast({
        type: 'progressToast',
        title: 'Sync In-progress',
        message: 'New coins are being added to the wallets.',
        autoHide: false,
      });
      const currentState = thunkAPI.getState();
      const resp = await fetchCurrenciesAPI({limit: 200, status: true});
      const newCoins = Array?.isArray(resp?.data?.data) ? resp?.data?.data : [];
      const allWallets = selectAllWallets(currentState) || [];
      const finalAllCoins = [];
      for (let i = 0; i < allWallets?.length; i++) {
        const currentWallet = allWallets[i];
        let allNewCoins = [];
        if (currentWallet.isImportWalletWithPrivateKey) {
          finalAllCoins.push(allNewCoins);
          continue;
        }
        const allCoins = Array.isArray(currentWallet?.coins)
          ? currentWallet.coins
          : [];
        const needToAddNewCoins = newCoins?.filter(
          item =>
            allCoins.findIndex(
              subItem =>
                item.chain_name === subItem.chain_name &&
                item.symbol === subItem.symbol,
            ) === -1,
        );

        for (let i = 0; i < needToAddNewCoins.length; i++) {
          const item = needToAddNewCoins[i];
          const createdCoins = await createCoin(
            currentWallet,
            {...item, isInWallet: true},
            currentState,
          );
          if (createdCoins) {
            allNewCoins.push(createdCoins);
          }
        }
        finalAllCoins.push(allNewCoins);
      }
      showToast({
        type: 'successToast',
        title: 'Sync Successful',
        message: 'New coins are added to the wallets.',
        toastId,
      });
      return {allNewCoins: finalAllCoins};
    } catch (e) {
      console.error('Error in sync', e);
      showToast({
        type: 'errorToast',
        title: 'Sync Failed',
        message: 'Something went wrong',
        toastId,
      });
      return thunkAPI.rejectWithValue('Something went wrong while syncing');
    }
  },
);

const generateCoinsAndDeriveAddress = async (
  currentState,
  currentWallet,
  coin,
) => {
  let newCoin = await createCoin(
    currentWallet,
    {...coin, isInWallet: true},
    currentState,
  );
  newCoin = addExistingDeriveAddress(currentWallet, newCoin);
  if (!newCoin) {
    throw new Error(`Failed create new coin: ${coin?.name}`);
  }
  return newCoin;
};

export const addCoinGroup = createAsyncThunk(
  'wallets/addCoinGroup',
  async (payload, thunkAPI) => {
    const dispatch = thunkAPI.dispatch;
    try {
      dispatch(setIsAddingGroup(payload?._id));
      const currentState = thunkAPI.getState();
      const allCoins = selectCoinsForCurrentWallet(currentState);
      const currentWallet = selectCurrentWallet(currentState);
      const currentWalletIndex = getCurrentWalletIndex(currentState);
      const allCoinsForAdd = Array.isArray(payload?.coins)
        ? payload?.coins
        : [];
      const isValidCoin = allCoinsForAdd.every(
        coin =>
          checkValidChainForWalletImportWithPrivateKey({
            currentWallet,
            currentCoin: coin,
          }) === true,
      );
      if (!isValidCoin) {
        throw new Error('Some coins is missing');
      }
      let newCoins = [];
      const existingCoins = [];
      for (let i = 0; i < allCoinsForAdd.length; i++) {
        const item = allCoinsForAdd[i];
        const currentKey = generateUniqueKeyForChain(item);
        const foundCoin = allCoins.find(subItem => {
          const tempKey = generateUniqueKeyForChain(subItem);
          return currentKey === tempKey;
        });
        if (foundCoin) {
          existingCoins.push(item);
        } else {
          newCoins.push(item);
        }
      }
      if (newCoins.length) {
        newCoins = await Promise.all(
          newCoins.map(coin =>
            generateCoinsAndDeriveAddress(currentState, currentWallet, coin),
          ),
        );
        if (currentWallet.clientId) {
          const masterClientId = getMasterClientId(currentState);
          registerUserAPI({
            coins: newCoins,
            clientId: currentWallet?.clientId,
            masterClientId,
            is_imported: currentWallet?.isBackedup,
          });
        }
      }
      dispatch(setIsRemovingGroup(payload?._id));
      return {newCoins, existingCoins, currentWalletIndex};
    } catch (e) {
      console.error('Error in add coins', e);
      showToast({
        type: 'errorToast',
        title: 'Group not added',
        message: e?.message,
      });
      dispatch(setIsRemovingGroup(payload?._id));
      return thunkAPI.rejectWithValue(e?.message);
    }
  },
);

export const addOrToggleCoinInWallet = createAsyncThunk(
  'wallets/addOrToggleCoinInWallet',
  async (payload, thunkAPI) => {
    const currentState = thunkAPI.getState();
    const allCoins = selectCoinsForCurrentWallet(currentState);
    const currentWallet = selectCurrentWallet(currentState);
    if (
      !checkValidChainForWalletImportWithPrivateKey({
        currentWallet,
        currentCoin: payload,
      })
    ) {
      console.error('coin chain not match');
      return thunkAPI.rejectWithValue('coin chain not match');
    }
    let isNew = true;
    for (let i = 0; i < allCoins.length; i++) {
      const item = allCoins[i];
      if (item?._id === payload?._id) {
        isNew = false;
        break;
      }
    }
    if (!isNew) {
      return {newCoin: null, existingCoinId: payload?._id};
    } else {
      let newCoin = await createCoin(
        currentWallet,
        {...payload, isInWallet: true},
        currentState,
      );
      newCoin = addExistingDeriveAddress(currentWallet, newCoin);

      if (!newCoin) {
        console.error('new coin not created');
        return null;
      }
      if (currentWallet.clientId) {
        const masterClientId = getMasterClientId(currentState);
        registerUserAPI({
          coins: [newCoin],
          clientId: currentWallet?.clientId,
          masterClientId,
          is_imported: currentWallet?.isBackedup,
        });
      }
      return {newCoin, existingCoinId: null};
    }
  },
);

export const sendFunds = createAsyncThunk(
  'wallets/sendFunds',
  async (txData, thunkAPI) => {
    let toastId;
    try {
      //const {walletName, phrase} = walletData;
      const currentState = thunkAPI.getState();
      thunkAPI.dispatch(setCurrentTransferSubmitting(true));
      const navigation = txData?.navigation;
      const router = txData?.router;
      const currentCoin = txData?.currentCoin;
      const currentWallet = txData?.currentWallet;
      const nativeCoin = await getNativeCoin(
        currentState,
        currentCoin,
        currentWallet,
      );
      if (!nativeCoin) {
        return null;
      }
      const transferData = getTransferData(currentState);
      if (txData?.isBatchTransaction && txData?.transactionsData) {
        await fetchBatchTransactionBalances(
          txData?.transactionsData,
          currentState,
          true,
        );
      }

      //
      const res = txData?.isNFT
        ? await nativeCoin?.sendNFT({
            to: txData.to,
            from: txData.from,
            amount: txData.amount,
            gasFee: transferData?.gasFee,
            estimateGas: transferData?.estimateGas,
            nonce: transferData?.nonce,
            maxPriorityFeePerGas: transferData?.maxPriorityFeePerGas,
            transactionFee: transferData?.transactionFee,
            contract_type: txData?.contract_type,
            tokenId: txData?.tokenId,
            tokenAmount: txData.tokenAmount,
            contractAddress: txData?.contractAddress,
            mint: txData?.mint,
            memo: txData?.memo,
          })
        : txData?.isCreateStaking
        ? await nativeCoin.createStaking({
            from: txData?.from,
            amount: txData.amount,
            gasFee: transferData?.gasFee,
            estimateGas: transferData?.estimateGas,
            nonce: transferData?.nonce,
            transactionFee: transferData?.transactionFee,
            phrase: txData?.phrase,
            validatorPubKey: txData?.validatorPubKey,
            numberOfStakeAccount: txData?.numberOfStakeAccount,
            stakingBalance: txData?.stakingBalance,
            resourceType: txData?.resourceType,
            memo: txData?.memo,
          })
        : txData?.isCreateVote
        ? await nativeCoin.createStakingWithValidator({
            from: txData?.from,
            amount: txData.amount,
            gasFee: transferData?.gasFee,
            estimateGas: transferData?.estimateGas,
            nonce: transferData?.nonce,
            transactionFee: transferData?.transactionFee,
            phrase: txData?.phrase,
            validatorPubKey: txData?.validatorPubKey,
            numberOfStakeAccount: txData?.numberOfStakeAccount,
            stakingBalance: txData?.stakingBalance,
            resourceType: txData?.resourceType,
            selectedVotes: txData?.selectedVotes,
            memo: txData?.memo,
          })
        : txData?.isDeactivateStaking
        ? await nativeCoin.deactivateStaking({
            from: txData?.from,
            amount: txData.amount,
            gasFee: transferData?.gasFee,
            estimateGas: transferData?.estimateGas,
            transactionFee: transferData?.transactionFee,
            nonce: transferData?.nonce,
            phrase: txData?.phrase,
            validatorPubKey: txData?.validatorPubKey,
            stakingAddress: txData?.stakingAddress,
            resourceType: txData?.resourceType,
            memo: txData?.memo,
          })
        : txData?.isWithdrawStaking
        ? await nativeCoin.withdrawStaking({
            from: txData?.from,
            amount: txData.amount,
            gasFee: transferData?.gasFee,
            estimateGas: transferData?.estimateGas,
            transactionFee: transferData?.transactionFee,
            phrase: txData?.phrase,
            validatorPubKey: txData?.validatorPubKey,
            stakingAddress: txData?.stakingAddress,
            memo: txData?.memo,
          })
        : txData?.isStakingRewards
        ? await nativeCoin.stakingRewards({
            from: txData?.from,
            amount: txData.amount,
            gasFee: transferData?.gasFee,
            estimateGas: transferData?.estimateGas,
            nonce: transferData?.nonce,
            transactionFee: transferData?.transactionFee,
            phrase: txData?.phrase,
            validatorPubKey: txData?.validatorPubKey,
            stakingAddress: txData?.stakingAddress,
            memo: txData?.memo,
          })
        : txData?.isBatchTransaction
        ? await nativeCoin.sendBatchTransaction({
            calls: txData.calls,
            gasFee: transferData?.gasFee,
            maxPriorityFeePerGas: transferData?.maxPriorityFeePerGas,
            estimateGas: transferData?.estimateGas,
            nonce: transferData?.nonce,
            transactionFee: transferData?.transactionFee,
          })
        : await nativeCoin.send({
            to: txData.to,
            amount: txData.amount,
            gasFee: transferData?.gasFee,
            maxPriorityFeePerGas: transferData?.maxPriorityFeePerGas,
            isMax: transferData?.isMax,
            estimateGas: transferData?.estimateGas,
            nonce: transferData?.nonce,
            transactionFee: transferData?.transactionFee,
            phrase: txData?.phrase,
            memo: txData?.memo,
            selectedUTXOs: transferData?.selectedUTXOs,
          });
      let confirmTransaction;

      if (res) {
        if (navigation) {
          navigation.navigate('Sidebar', {
            screen: 'Home',
          });
        } else if (router) {
          router.replace('/home');
        }
        thunkAPI.dispatch(clearSelectedUTXOs());
        thunkAPI.dispatch(setCurrentTransferSubmitting(false));
        const batchTransactionChainName =
          txData?.transactionsData?.[0]?.coinInfo?.chain_name;
        const batchTransactionChainAddress =
          txData?.transactionsData?.[0]?.coinInfo?.address;
        const batchTransactionWalletId =
          txData?.transactionsData?.[0]?.wallet_id;
        if (
          txData?.isBatchTransaction &&
          batchTransactionChainName &&
          batchTransactionChainAddress &&
          batchTransactionWalletId
        ) {
          thunkAPI.dispatch(
            clearTransactionsForSelectedChain({
              chain_name: batchTransactionChainName,
              address: batchTransactionChainAddress,
              wallet_id: batchTransactionWalletId,
            }),
          );
        }

        toastId = showToast({
          type: 'progressToast',
          title: `${
            txData?.isExchange ? 'Exchange ' : ''
          }Transaction In-progress`,
          message: `Your ${
            txData?.isExchange ? 'exchange' : ''
          } transaction submitted successfully. Once the transaction completed you will be notified.`,
          autoHide: false,
        });
        if (isPendingTransactionSupportedChain(currentCoin?.chain_name)) {
          const key = createPendingTransactionKey({
            chain_name: currentCoin?.chain_name,
            symbol: currentCoin?.symbol,
            address: currentCoin?.address,
          });
          thunkAPI.dispatch(
            addPendingTransactions({
              key,
              value: {hash: res.hash, date: new Date().toISOString()},
            }),
          );
        }
        const tx_hash = getHashString(res, currentCoin?.chain_name);
        confirmTransaction = await nativeCoin.waitForConfirmation({
          transaction: res,
          interval: 5000,
          retries: 15,
        });
        if (confirmTransaction === 'pending') {
          showToast({
            type: 'warningToast',
            title: 'Transaction pending',
            message: 'Transaction take too long. Please check again later',
            toastId,
          });
        } else if (confirmTransaction && !txData?.isExchange) {
          showToast({
            type: 'successToast',
            title: 'Transaction Successful',
            message: `Your transaction completed successfully.${
              txData?.isBatchTransaction
                ? 'Batch transactions are completed successfully.'
                : txData?.isCreateStaking
                ? `Your staking : ${txData?.amount} ${txData?.currentCoin?.symbol} will be reflects in couple of minutes.`
                : txData?.isNFT
                ? 'You just sent NFT'
                : txData?.isCreateVote
                ? 'Your Votes is submitted successfully'
                : `You just sent: ${txData?.amount} ${txData?.currentCoin?.symbol}`
            }`,
            toastId,
          });
        }
        refreshCoinData(thunkAPI.dispatch, txData.currentCoin);
        return {tx_hash, status: confirmTransaction === 'pending' ? 2 : 3};
      } else {
        thunkAPI.dispatch(setCurrentTransferSubmitting(false));
        console.error('Something went wrong');
        showToast({
          type: 'errorToast',
          title: 'Something Went wrong',
          autoHide: true,
          toastId,
        });
        return {tx_hash: '', status: 1};
      }
    } catch (e) {
      console.error('Error in send fund', e);
      thunkAPI.dispatch(setCurrentTransferSubmitting(false));
      if (isEVMChain(txData?.currentCoin?.chain_name)) {
        if (
          e?.message === 'could not coalesce error' ||
          e?.message?.includes('nonce too low')
        ) {
          showToast({
            type: 'errorToast',
            title: 'Already sent',
            message: 'please check transaction explorer',
          });
        } else {
          showToast({
            type: 'errorToast',
            title: e?.message,
          });
        }
        const flPayload = {
          fromAddress: txData?.currentCoin?.address || txData?.from,
          amount: txData?.amount,
          toAddress: txData?.to,
          timestamp: new Date().toISOString(),
        };
        const contractAddress =
          txData?.contractAddress || txData?.currentCoin?.contractAddress;
        if (contractAddress) {
          flPayload.contractAddress = contractAddress;
        }
        if (txData?.calls) {
          flPayload.calls = txData?.calls;
        }
        if (txData?.currentCoin?.chain_name) {
          flPayload.chain_name = txData?.currentCoin?.chain_name;
        }
        if (txData?.currentCoin?.symbol) {
          flPayload.symbol = txData?.currentCoin?.symbol;
        }
        thunkAPI.dispatch(setFailedTransaction(flPayload));

        return;
      }
      if (e?.message?.includes('transaction underpriced')) {
        showToast({
          type: 'errorToast',
          title: 'Transaction fees is low.',
          message: 'Please add a custom transaction fees',
        });
        return;
      }
      if (e?.message === 'polkadot_receiver_should_1_dot') {
        showToast({
          type: 'errorToast',
          title: 'Polkadot warning',
          message: 'Receiver address should have minimum 1 DOT',
        });
        return;
      }
      showToast({
        type: 'errorToast',
        title: 'Something Went wrong',
        autoHide: true,
      });
    }
  },
);

export const sendPendingTransactions = createAsyncThunk(
  'wallets/sendPendingTransactions',
  async (payload, thunkAPI) => {
    let toastId;
    const isFromUpdateScreen = payload?.isFromUpdateScreen;
    try {
      //const {walletName, phrase} = walletData;
      const currentState = thunkAPI.getState();
      isFromUpdateScreen
        ? thunkAPI.dispatch(setUpdateTransactionSubmitting(true))
        : thunkAPI.dispatch(setPendingTransferSubmitting(true));
      const navigation = payload?.navigation;
      const router = payload?.router;
      const currentCoin = selectCurrentCoin(currentState);
      const currentWallet = selectCurrentWallet(currentState);
      const nativeCoin = await getNativeCoin(
        currentState,
        currentCoin,
        currentWallet,
      );
      if (!nativeCoin) {
        return null;
      }

      const res = payload?.isCancelTransaction
        ? await nativeCoin?.cancelTransaction(payload)
        : await nativeCoin?.accelerateTransaction(payload);
      let confirmTransaction;

      if (res) {
        if (navigation) {
          navigation.navigate('Sidebar', {
            screen: 'Home',
          });
        } else if (router) {
          router.replace('/home');
        }
        isFromUpdateScreen
          ? thunkAPI.dispatch(setUpdateTransactionSubmitting(false))
          : thunkAPI.dispatch(setPendingTransferSubmitting(false));

        toastId = showToast({
          type: 'progressToast',
          title: 'Updated Transaction In-progress',
          message:
            'Your Updated transaction submitted successfully. Once the transaction completed you will be notified.',
          autoHide: false,
        });
        let key = null;
        if (isPendingTransactionSupportedChain(currentCoin?.chain_name)) {
          key = createPendingTransactionKey({
            chain_name: currentCoin?.chain_name,
            symbol: currentCoin?.symbol,
            address: currentCoin?.address,
          });
          if (!isFromUpdateScreen) {
            thunkAPI.dispatch(
              addPendingTransactions({
                key,
                value: {hash: res.hash, date: new Date().toISOString()},
              }),
            );
          }
        }
        confirmTransaction = await nativeCoin.waitForConfirmation({
          transaction: res,
          interval: 5000,
          retries: 15,
        });
        if (confirmTransaction === 'pending') {
          showToast({
            type: 'warningToast',
            title: 'Transaction pending',
            message: 'Transaction take too long. Please check again later',
            toastId,
          });
        } else if (confirmTransaction) {
          if (payload?.pendingTxHash) {
            thunkAPI.dispatch(
              removePendingTransactions({
                key,
                value: payload?.pendingTxHash,
              }),
            );
          }
          showToast({
            type: 'successToast',
            title: 'Transaction Successful',
            message: 'Your transaction completed successfully',
            toastId,
          });
        }
        refreshCoinData(thunkAPI.dispatch, null);
      } else {
        isFromUpdateScreen
          ? thunkAPI.dispatch(setUpdateTransactionSubmitting(false))
          : thunkAPI.dispatch(setPendingTransferSubmitting(false));
        console.error('Something went wrong in');
        showToast({
          type: 'errorToast',
          title: 'Something Went wrong',
          autoHide: true,
          toastId,
        });
      }
    } catch (e) {
      console.error('Error in send pending transactions', e);
      isFromUpdateScreen
        ? thunkAPI.dispatch(setUpdateTransactionSubmitting(false))
        : thunkAPI.dispatch(setPendingTransferSubmitting(false));
      showToast({
        type: 'errorToast',
        title: e?.message,
        autoHide: true,
      });
    }
  },
);

// Then, create the slice
// Create a slice for the wallets state

const initialState = {
  allWallets: [],
  currentWalletIndex: 0,
  pendingTransactions: {},
  masterClientId: null,
  failedTransaction: null,
};

export const createIfNotExistsMasterClientId = createAsyncThunk(
  'wallets/createIfNotExistsMasterClientId',
  async (_, thunkAPI) => {
    const currentState = thunkAPI.getState();
    const masterClientId = getMasterClientId(currentState);
    if (!masterClientId) {
      const clientId = v4();
      thunkAPI.dispatch(setMasterClientId(clientId));
    }
  },
);

export const fetchNft = createAsyncThunk(
  'wallets/fetchNft',
  async (payload, thunkAPI) => {
    const currentState = thunkAPI.getState();
    const currentWalletIndex = _currentWalletIndexSelector(currentState);
    const {selectedNftChain, cursor: previousCursor} = payload;
    const dispatch = thunkAPI.dispatch;
    try {
      if (!NFT_SUPPORTED_CHAIN.includes(selectedNftChain)) {
        console.warn('Fetch nft chain not supported');
        return;
      }
      const currentWallet = selectCurrentWallet(currentState);
      const previousNftData = getSelectedNftData(currentState);
      dispatch(
        setNftLoading({selectedNftChain, isLoading: true, currentWalletIndex}),
      );
      const our_chain = MORALIS_CHAIN_TO_CHAIN[selectedNftChain];
      const foundCoin = currentWallet?.coins?.find(
        item => item?.chain_name === our_chain && item?.type === 'coin',
      );
      let resp;
      const isSolana = selectedNftChain === 'Solana';
      if (isSolana) {
        resp = await fetchSolanaNftApi(
          foundCoin?.address,
          config.MORALIS_CHAIN[selectedNftChain],
        );
      } else {
        resp = await fetchEVMNftApi(
          foundCoin?.address,
          config.MORALIS_CHAIN[selectedNftChain],
          previousCursor,
        );
      }
      let data =
        isSolana && Array.isArray(resp)
          ? resp
          : Array.isArray(resp?.result)
          ? resp?.result
          : [];
      const cursor = resp?.cursor;
      if (previousCursor) {
        data = [...previousNftData, ...data];
      }
      dispatch(
        setNft({currentWalletIndex, data, selectedNftChain, available: cursor}),
      );
    } catch (e) {
      console.error('Error in fetch nft', e);
      dispatch(
        setNftLoading({selectedNftChain, isLoading: false, currentWalletIndex}),
      );
    }
  },
);

export const addEVMAndTronDeriveAddresses = createAsyncThunk(
  'wallets/addEVMAndTronDeriveAddresses',
  async (payload, thunkAPI) => {
    const dispatch = thunkAPI.dispatch;
    let toastId;
    try {
      dispatch(setIsAddMoreAddressPopupHidden(true));
      const currentState = thunkAPI.getState();
      const currentWalletIndex =
        payload?.index ?? _currentWalletIndexSelector(currentState);
      dispatch(
        updateIsEVMAddressesAdded({index: currentWalletIndex, value: true}),
      );
      const wallet = payload?.wallet || selectCurrentWallet(currentState);
      toastId = showToast({
        type: 'progressToast',
        title: `Adding to the ${wallet.walletName}`,
        message:
          'New addresses for EVM, SOL and TRX are being added to the wallets.',
        autoHide: false,
      });
      const evmAddresses = await addDeriveAddresses('ethereum', wallet.phrase);
      const tronAddresses = await addDeriveAddresses('tron', wallet.phrase);
      const solanaAddresses = await addDeriveAddresses('solana', wallet.phrase);
      showToast({
        type: 'successToast',
        title: 'Success',
        message: 'EVM, SOL and TRX addresses have been added',
        autoHide: true,
        toastId,
      });
      return {
        currentWalletIndex,
        evmDeriveAddresses: evmAddresses?.deriveAddresses || null,
        tronDeriveAddresses: tronAddresses?.deriveAddresses || null,
        solanaDeriveAddresses: solanaAddresses?.deriveAddresses || null,
      };
    } catch (e) {
      showToast({
        type: 'errorToast',
        title: 'Something Went wrong',
        autoHide: true,
        toastId,
      });
      return thunkAPI.rejectWithValue('Something went wrong');
    }
  },
);

export const add50AddressesOnCurrentCoin = createAsyncThunk(
  'wallets/add50AddressesOnCurrentCoin',
  async (payload, thunkAPI) => {
    const dispatch = thunkAPI.dispatch;
    let toastId;
    try {
      dispatch(setIsAdding50MoreAddresses(true));
      const currentState = thunkAPI.getState();
      const currentWalletIndex =
        payload?.index ?? _currentWalletIndexSelector(currentState);
      const wallet = payload?.wallet || selectCurrentWallet(currentState);
      const currentCoin =
        payload?.currentCoin ?? selectCurrentCoin(currentState);

      toastId = showToast({
        type: 'progressToast',
        title: `Adding 50 more addresses to the ${wallet.walletName}`,
        message: `New addresses for ${currentCoin?.chain_symbol} are being added to the wallets.`,
        autoHide: false,
      });
      const allDeriveAddress = Array.isArray(currentCoin?.deriveAddresses)
        ? currentCoin?.deriveAddresses
        : [];
      const chainName = isEVMChain(currentCoin?.chain_name)
        ? 'ethereum'
        : currentCoin?.chain_name;
      if (!isDeriveAddressSupportChain(chainName)) {
        throw new Error('Unsupported chain');
      }
      const deriveIndices = allDeriveAddress.map(item =>
        getIndexFromDerivePath(item.derivePath, chainName),
      );
      const largestIndex = getLargestNumber(deriveIndices);
      const addresses = await addDeriveAddresses(
        chainName,
        wallet.phrase,
        largestIndex,
      );
      showToast({
        type: 'successToast',
        title: 'Success',
        message: `${currentCoin?.chain_symbol} addresses have been added`,
        autoHide: true,
        toastId,
      });
      dispatch(setIsAdding50MoreAddresses(false));
      return {
        currentWalletIndex,
        chain_name: chainName,
        deriveAddresses: addresses?.deriveAddresses || null,
      };
    } catch (e) {
      dispatch(setIsAdding50MoreAddresses(false));
      console.error('error in add 50 more address', e);
      showToast({
        type: 'errorToast',
        title: 'Something Went wrong',
        autoHide: true,
        toastId,
      });
      return thunkAPI.rejectWithValue('Something went wrong');
    }
  },
);

export const addCustomDeriveAddress = createAsyncThunk(
  'wallets/addCustomDeriveAddress',
  async (payload, thunkAPI) => {
    let toastId;
    try {
      const currentState = thunkAPI.getState();
      const currentWalletIndex =
        payload?.index ?? _currentWalletIndexSelector(currentState);

      const wallet = payload?.wallet || selectCurrentWallet(currentState);
      const derivePath = payload?.derivePath;
      const chain_name =
        payload?.chain_name || selectCurrentCoin(currentState)?.chain_name;
      toastId = showToast({
        type: 'progressToast',
        title: `Adding to the ${wallet.walletName}`,
        message: 'New account is adding',
        autoHide: false,
      });
      const accountData = await addCustomDeriveAddressToWallet(
        chain_name,
        wallet.phrase,
        derivePath,
      );
      if (accountData?.account) {
        showToast({
          type: 'successToast',
          title: 'Success',
          message: 'New account successfully added',
          autoHide: true,
          toastId,
        });
        return {
          currentWalletIndex,
          chain_name,
          account: accountData?.account || {},
        };
      } else {
        throw new Error('no account data found');
      }
    } catch (e) {
      showToast({
        type: 'errorToast',
        title: 'Something Went wrong',
        autoHide: true,
        toastId,
      });
      return thunkAPI.rejectWithValue('Something went wrong');
    }
  },
);

export const searchCoinFromCurrency = createAsyncThunk(
  'wallets/searchCoinFromCurrency',
  async (refreshData, thunkAPI) => {
    const currentState = thunkAPI.getState();
    const dispatch = thunkAPI.dispatch;
    const currency = refreshData.currency?.toLowerCase();
    const allCoins = selectUserCoins(currentState);
    const foundCoin = allCoins?.find(item => {
      const oldPatter = `${item?.chain_symbol}:${item?.symbol}`?.toLowerCase();
      const pattern = `${item?.chain_name}:${item?.symbol}`?.toLowerCase();
      return currency === oldPatter || currency === pattern;
    });
    if (!foundCoin) {
      showToast({
        type: 'errorToast',
        title: 'Currency not found in the selected wallet',
      });
      throw new Error('currency not found in the selected wallet');
    }
    dispatch(setCurrentCoin(foundCoin?._id));
    dispatch(refreshCurrentCoin({currentCoin: foundCoin}));
  },
);

export const walletsSlice = createSlice({
  name: 'wallets',
  initialState,
  reducers: {
    setCoinsInCurrentWallet: (state, action) => {
      // get the current wallet
      const allWallets = state.allWallets;
      const currentWalletIndex = state.currentWalletIndex;
      const currentWallet = allWallets[currentWalletIndex] || {};
      if (Array.isArray(action?.payload)) {
        currentWallet.coins = action?.payload;
      }
    },
    setWalletPosition: (state, {payload}) => {
      const index = validateNumber(payload?.index);
      const isMoveUp = payload?.isMoveUp;
      const previousAllWallets = state.allWallets;
      let previousCurrentWalletIndex = state.currentWalletIndex;
      if (previousAllWallets.length === 1) {
        console.warn('Can not move because it have only 1 item');
        return;
      }
      if (
        index === null ||
        index < 0 ||
        index > previousAllWallets.length - 1
      ) {
        console.warn('invalid index');
        return;
      }
      const updateArr = moveItem(
        previousAllWallets,
        index,
        isMoveUp ? index - 1 : index + 1,
      );
      if (updateArr) {
        state.allWallets = updateArr;
      }
      if (
        (isMoveUp && previousCurrentWalletIndex === index) ||
        (!isMoveUp && previousCurrentWalletIndex === index + 1)
      ) {
        previousCurrentWalletIndex = previousCurrentWalletIndex - 1;
      } else if (
        (!isMoveUp && previousCurrentWalletIndex === index) ||
        (isMoveUp && previousCurrentWalletIndex === index - 1)
      ) {
        previousCurrentWalletIndex = previousCurrentWalletIndex + 1;
      }
      state.currentWalletIndex = previousCurrentWalletIndex;
    },
    rearrangeWallet: (state, {payload}) => {
      const newWallets = payload?.allWallets;
      const newCurrentWalletIndex = validateNumber(payload?.currentWalletIndex);
      const previousAllWallets = state.allWallets;
      if (previousAllWallets.length === newWallets.length) {
        state.allWallets = newWallets;
        if (
          newCurrentWalletIndex !== null &&
          newCurrentWalletIndex >= 0 &&
          newCurrentWalletIndex < previousAllWallets.length
        ) {
          state.currentWalletIndex = newCurrentWalletIndex;
        }
      }
    },
    setBackedUp: state => {
      const currentWallet = state.allWallets[state.currentWalletIndex];
      currentWallet.isBackedup = true;
    },
    setCurrentCoin: (state, action) => {
      const currentWallet = state.allWallets[state.currentWalletIndex];
      const id = action.payload;
      const findCoin = currentWallet.coins.find(item => item?._id === id);
      if (!findCoin) {
        const e = Error('Coin id does not exist');
        console.error(e.stack);
        throw e;
      }
      currentWallet.selectedCoin = id;
    },
    updateContractAddress: (state, action) => {
      const payload = action?.payload;
      const chain_name = payload?.chain_name;
      const symbol = payload?.symbol;
      const tempContractAddress = payload?.contractAddress;
      if (chain_name && symbol && tempContractAddress) {
        const currentWallet = state.allWallets[state.currentWalletIndex];
        currentWallet.coins = currentWallet.coins.map(item => {
          if (item?.chain_name === chain_name && item?.symbol === symbol) {
            return {
              ...item,
              contractAddress: tempContractAddress,
            };
          }
          return item;
        });
      }
    },
    resetWallet: () => initialState,
    updateWalletName: (state, action) => {
      const updateWalletIndex = action?.payload?.index;
      const updateWalletName = action?.payload?.walletName;
      const allWallets = state.allWallets;
      if (!allWallets[updateWalletIndex]) {
        throw new Error('cannot update name because invalid index.js');
      }
      const currentWallet = allWallets[updateWalletIndex];
      currentWallet.walletName = updateWalletName;
    },
    setCurrentWalletIndex: (state, action) => {
      const index = action.payload;
      if (isNaN(Number(index)) || !state?.allWallets[index]) {
        throw new Error(
          `setCurrentWalletIndex: missing or invalid action payload: ${index}`,
        );
      }
      state.currentWalletIndex = index;
    },
    deleteWallet: (state, action) => {
      const index = action?.payload;
      const allWallets = state.allWallets;
      if (allWallets?.length === 1) {
        throw new Error('cannot deleted because there is only 1 wallet');
      }
      if (index === state.currentWalletIndex) {
        throw new Error('cannot deleted because it is selected wallet');
      }
      if (!allWallets[index]) {
        throw new Error('wallet not available');
      }
      state.allWallets = allWallets.filter((_, i) => i !== Number(index));
      if (state.currentWalletIndex > index) {
        state.currentWalletIndex = state.currentWalletIndex - 1;
      }
    },
    deleteCoin: (state, action) => {
      const coinId = action?.payload;
      const allWallets = state.allWallets;
      const currentWalletIndex = state.currentWalletIndex;
      if (!coinId) {
        throw new Error('Id is not found ');
      }
      const currentWallet = allWallets[currentWalletIndex];
      const allCoins = [...currentWallet.coins];
      currentWallet.coins = allCoins.filter(item => item?._id !== coinId);
      state.allWallets[currentWalletIndex] = currentWallet;
    },
    setWalletConnect(state, {payload}) {
      const currentWalletIndex = state.currentWalletIndex;
      const currentWallet = state.allWallets[currentWalletIndex];
      const previousSession = currentWallet?.session || {};
      currentWallet.session = {...previousSession, ...payload};
    },
    setWalletConnectWalletData(state, {payload}) {
      const currentWalletIndex = state.currentWalletIndex;
      const currentWallet = state.allWallets[currentWalletIndex];
      const previousSession = currentWallet?.walletData || {};
      currentWallet.walletData = {...previousSession, ...payload};
    },
    setNftSelectedChain(state, {payload}) {
      if (NFT_SUPPORTED_CHAIN.includes(payload)) {
        const allWallet = state.allWallets;
        const currentWalletIndex = state.currentWalletIndex;
        const currentWallet = allWallet[currentWalletIndex];
        currentWallet.selectedNftChain = payload;
      } else {
        console.error('setNftSelectedChain Invalid payload:', payload);
      }
    },
    resetNfts(state) {
      const allWallet = state.allWallets;
      state.allWallets = allWallet.map(item => ({
        ...item,
        nft: {},
        selectedNftChain: 'Ethereum',
        selectedNft: null,
      }));
    },
    setNftLoading(state, {payload}) {
      const {currentWalletIndex, isLoading, selectedNftChain} = payload;
      const allWallet = state.allWallets;
      const currentWallet = allWallet[currentWalletIndex];
      const nft = currentWallet.nft;
      currentWallet.nft = {...nft, [`${selectedNftChain}_loading`]: isLoading};
    },
    setNft(state, {payload}) {
      const {currentWalletIndex, data, selectedNftChain, available} = payload;
      if (Array.isArray(data)) {
        const allWallet = state.allWallets;
        const currentWallet = allWallet[currentWalletIndex];
        const nft = currentWallet.nft;
        currentWallet.nft = {
          ...nft,
          [`${selectedNftChain}_data`]: data,
          [`${selectedNftChain}_loading`]: false,
          [`${selectedNftChain}_available`]: available,
        };
      }
    },
    setSelectedNft(state, {payload}) {
      const allWallet = state.allWallets;
      const currentWalletIndex = state.currentWalletIndex;
      const currentWallet = allWallet[currentWalletIndex];
      const selectedChain = currentWallet.selectedNftChain;
      const ownChain = MORALIS_CHAIN_TO_CHAIN[selectedChain];
      const allCoins = currentWallet.coins;
      const foundCoin = allCoins.find(
        item => item?.chain_name === ownChain && item?.type === 'coin',
      );
      currentWallet.selectedNft = {...payload, coin: foundCoin};
    },
    removeWalletConnectSession(state, {payload}) {
      const currentWalletIndex = state.currentWalletIndex;
      const currentWallets = state.allWallets[currentWalletIndex];
      const tempSession = {...currentWallets.session};
      delete tempSession[payload];
      const tempWalletData = {...currentWallets.walletData};
      delete tempWalletData[payload];
      currentWallets.session = tempSession;
      currentWallets.walletData = tempWalletData;
    },
    removeAllWalletConnectSession(state) {
      const currentWalletIndex = state.currentWalletIndex;
      const currentWallets = state.allWallets[currentWalletIndex];
      currentWallets.session = {};
      currentWallets.walletData = {};
    },
    setIsAddMoreAddressPopupHidden(state, {payload}) {
      const currentWalletIndex = state.currentWalletIndex;
      const currentWallet = state.allWallets[currentWalletIndex];
      currentWallet.isAddMoreAddressPopupHidden = payload;
    },
    setIsAdding50MoreAddresses(state, {payload}) {
      const currentWalletIndex = state.currentWalletIndex;
      const currentWallet = state.allWallets[currentWalletIndex];
      currentWallet.isAdding50MoreAddresses = payload;
    },
    resetIsAdding50MoreAddresses(state) {
      const allWallets = state.allWallets;
      state.allWallets = allWallets.map(item => ({
        ...item,
        isAdding50MoreAddresses: false,
      }));
    },
    setSelectedDeriveAddress(state, {payload}) {
      if (!payload?.chain_name) {
        console.warn('chain_name is required');
        return;
      }
      if (!payload?.address) {
        console.warn('address is required');
        return;
      }
      const {chain_name, address} = payload;
      const currentWalletIndex = state.currentWalletIndex;
      const currentWallet = state.allWallets[currentWalletIndex];
      currentWallet.coins = currentWallet?.coins.map(item => {
        const allDeriveAddresses = Array.isArray(item?.deriveAddresses)
          ? item?.deriveAddresses
          : [];
        const isFoundWallet = allDeriveAddresses.find(
          subItem => subItem?.address === address,
        );
        if (item?.chain_name === chain_name && isFoundWallet) {
          return {
            ...item,
            address: isFoundWallet?.address,
            privateKey: isFoundWallet?.privateKey,
          };
        }
        return item;
      });
    },
    updateCurrentCoin(state, {payload}) {
      const currentWalletIndex = state.currentWalletIndex;
      const currentWallet = state.allWallets[currentWalletIndex];
      const selectedCoinId = currentWallet?.selectedCoin;
      currentWallet.coins = currentWallet?.coins.map(item => {
        if (item?._id === selectedCoinId) {
          return {
            ...item,
            ...payload,
          };
        }
        return item;
      });
    },
    deleteDeriveAddressInCurrentCoin(state, {payload}) {
      if (!payload?.address) {
        console.warn('address payload is required for delete derive address');
        return;
      }
      const currentWalletIndex = state.currentWalletIndex;
      const currentWallet = state.allWallets[currentWalletIndex];
      const selectedCoinId = currentWallet?.selectedCoin;
      const selectedCoin = currentWallet?.coins.find(
        item => item?._id === selectedCoinId,
      );
      if (!selectedCoin) {
        console.warn('No selected coin found');
        return;
      }
      const deriveAddresses = Array.isArray(selectedCoin?.deriveAddresses)
        ? selectedCoin?.deriveAddresses
        : [];
      if (deriveAddresses?.length === 1) {
        console.warn("you can't delete because there is only 1 address");
        return;
      }
      const updateDeriveAddress = deriveAddresses?.filter(
        item => item?.address !== payload?.address,
      );
      if (updateDeriveAddress.length === deriveAddresses.length) {
        console.warn('derive address for delete not found :', payload?.address);
        return;
      }
      selectedCoin.deriveAddresses = updateDeriveAddress;
    },
    updateIsEVMAddressesAdded: (state, action) => {
      const updateWalletIndex = action?.payload?.index;
      const value = action?.payload?.value;
      const allWallets = state.allWallets;
      if (!allWallets[updateWalletIndex]) {
        throw new Error('cannot update status because invalid index.js');
      }
      const currentWallet = allWallets[updateWalletIndex];
      currentWallet.isEVMAddressesAdded = value;
    },
    rearrangeCurrentWalletCoins: (state, {payload}) => {
      const allWallets = state.allWallets;
      const currentWallet = allWallets[state.currentWalletIndex] || {};
      const rearrangeCoins = payload?.rearrangeCoins;
      if (Array.isArray(rearrangeCoins)) {
        currentWallet.coins = rearrangeCoins;
      } else {
        console.log('rearrangeCoins is not valid array');
      }
    },
    setCurrentWalletCoinsPosition: (state, {payload}) => {
      const index = validateNumber(payload?.index);
      const isMoveUp = payload?.isMoveUp;
      const allWallets = state.allWallets;
      const currentWallet = allWallets[state.currentWalletIndex] || {};
      const allCoins = Array.isArray(currentWallet?.coins)
        ? [...currentWallet?.coins]
        : [];
      if (allCoins.length <= 1) {
        console.warn(
          'coins can not move because it have less than or equal 1 item',
        );
        return;
      }
      if (index === null || index < 0 || index > allCoins.length - 1) {
        console.warn('invalid index');
        return;
      }
      const updateArr = moveItem(
        allCoins,
        index,
        isMoveUp ? index - 1 : index + 1,
      );
      if (updateArr) {
        currentWallet.coins = updateArr;
      }
    },
    togglePrivacyMode: (state, {payload}) => {
      const walletIndex = payload?.walletIndex;
      const allWallets = state.allWallets;
      const currentWallet = allWallets[walletIndex];
      if (currentWallet) {
        currentWallet.privacyMode = !currentWallet.privacyMode;
      } else {
        console.warn('No wallet found for privacy mode');
      }
    },
    resetCoinsToDefaultAddressForPrivacyMode: (state, {payload}) => {
      const allWallets = Array.isArray(state.allWallets)
        ? [...state.allWallets]
        : [];
      const newWallet = [];
      for (let i = 0; i < allWallets.length; i++) {
        const currentWallet = allWallets[i] || {};
        if (currentWallet?.privacyMode) {
          currentWallet.coins = currentWallet.coins.map(item => ({
            ...item,
            address: item?.deriveAddresses?.[0]?.address || item?.address,
            privateKey:
              item?.deriveAddresses?.[0]?.privateKey || item?.privateKey,
          }));
        }
        newWallet[i] = currentWallet;
      }
      state.allWallets = newWallet;
    },
    removeEVMDeriveAddresses: (state, action) => {
      const updateWalletIndex = action?.payload?.index;
      const allWallets = state.allWallets;
      if (!allWallets[updateWalletIndex]) {
        throw new Error('cannot update name because invalid index.js');
      }
      const currentWallet = allWallets[updateWalletIndex];
      const allCoins = [...currentWallet.coins];
      currentWallet.coins = allCoins.map(item => {
        const deriveAddressSupportChain = isDeriveAddressSupportChain(
          item?.chain_name,
        );
        if (deriveAddressSupportChain) {
          const customDeriveAddresses =
            item?.deriveAddresses?.filter(
              (subItem, index) => !index || !!subItem?.isCustom,
            ) || [];
          return {
            ...item,
            address: item?.deriveAddresses?.[0]?.address || item?.address,
            privateKey:
              item?.deriveAddresses?.[0]?.privateKey || item?.privateKey,
            deriveAddresses:
              customDeriveAddresses?.length > 1 ? customDeriveAddresses : null,
          };
        } else {
          return item;
        }
      });
      currentWallet.isEVMAddressesAdded = false;
    },
    addPendingTransactions: (state, action) => {
      const key = action?.payload?.key;
      const value = action?.payload?.value;
      const previousPendingTransactions = Array.isArray(
        state.pendingTransactions[key],
      )
        ? state.pendingTransactions[key]
        : [];
      if (key && value) {
        state.pendingTransactions[key] = [
          value,
          ...previousPendingTransactions,
        ];
      } else {
        console.warn('addPendingTransactions not have correct payload');
      }
    },
    setPendingTransactions: (state, action) => {
      const key = action?.payload?.key;
      const value = action?.payload?.value;
      if (key && Array.isArray(value)) {
        state.pendingTransactions[key] = value;
      } else {
        console.warn('setPendingTransactions not have correct payload');
      }
    },
    removePendingTransactions: (state, action) => {
      const key = action?.payload?.key;
      const value = action?.payload?.value;
      const previousPendingTransactions = Array.isArray(
        state.pendingTransactions[key],
      )
        ? state.pendingTransactions[key]
        : [];
      if (key && value) {
        state.pendingTransactions[key] = previousPendingTransactions.filter(
          item => item.hash?.toLowerCase() !== value?.toLowerCase(),
        );
      } else {
        console.warn('removePendingTransactions not have correct payload');
      }
    },
    setMasterClientId: (state, action) => {
      state.masterClientId = action?.payload;
    },
    createClientIdIfNotExist: state => {
      const allWallets = state.allWallets;
      state.allWallets = allWallets.map(item => ({
        ...item,
        clientId: item?.clientId || v4(),
      }));
    },
    setFailedTransaction: (state, action) => {
      state.failedTransaction = action?.payload;
    },
  },
  extraReducers: builder => {
    builder.addCase(refreshCoins.fulfilled, (state, {payload}) => {
      const coinData = payload.coinData;
      const currentWalletIndex = payload.currentWalletIndex;
      if (Array.isArray(coinData) && !isNaN(Number(currentWalletIndex))) {
        const allWallets = state.allWallets;
        const currentWallets = allWallets[currentWalletIndex] || {};
        currentWallets.coins = coinData;
      }
    });
    builder.addCase(syncCoinsWithServer.fulfilled, (state, {payload}) => {
      const allNewCoins = payload?.allNewCoins;
      const tempAllWallets = state.allWallets || [];
      const allWallets = Array.isArray(tempAllWallets)
        ? [...tempAllWallets]
        : [];
      if (
        Array.isArray(allNewCoins) &&
        allWallets.length === allNewCoins.length
      ) {
        for (let i = 0; i < allWallets.length; i++) {
          const tempWallet = allWallets[i];
          const newCoins = allNewCoins[i];
          tempWallet.coins = [...tempWallet.coins, ...newCoins];
          allWallets[i] = tempWallet;
        }
        state.allWallets = allWallets;
      }
    });
    builder.addCase(refreshCurrentCoin.fulfilled, (state, {payload}) => {
      if (payload?.updatedCurrentCoin) {
        const allWallets = state.allWallets;
        const currentWallets = allWallets[state.currentWalletIndex] || {};
        const allCoins = [...currentWallets.coins];
        const updatedCurrentCoin = payload?.updatedCurrentCoin;
        const updatedNativeCoin = payload?.updatedNativeCoin;
        const foundIndex = allCoins.findIndex(
          item => item?._id === updatedCurrentCoin?._id,
        );
        if (foundIndex !== -1) {
          allCoins[foundIndex] = updatedCurrentCoin;
          if (updatedNativeCoin) {
            const foundNativeCoinIndex = allCoins.findIndex(
              item => item?._id === updatedNativeCoin?._id,
            );
            if (foundNativeCoinIndex !== -1) {
              allCoins[foundNativeCoinIndex] = updatedNativeCoin;
            }
          }
          currentWallets.coins = allCoins;
        } else {
          currentWallets.coins = allCoins;
        }
      }
    });
    builder.addCase(addOrToggleCoinInWallet.fulfilled, (state, {payload}) => {
      const newCoin = payload.newCoin;
      const existingCoinId = payload.existingCoinId;
      const allWallets = state.allWallets;
      const currentWalletIndex = state.currentWalletIndex;
      const currentWallet = allWallets[currentWalletIndex] || {};
      const previousCoins = currentWallet.coins;
      if (newCoin) {
        currentWallet.coins = [...previousCoins, newCoin];
      } else if (existingCoinId) {
        currentWallet.coins = previousCoins.map(item => {
          if (item._id === existingCoinId) {
            return {...item, isInWallet: !item?.isInWallet};
          }
          return item;
        });
      }
    });
    builder.addCase(addCoinGroup.fulfilled, (state, {payload}) => {
      const newCoins = Array.isArray(payload.newCoins) ? payload.newCoins : [];
      const existingCoins = Array.isArray(payload.existingCoins)
        ? payload.existingCoins
        : [];
      const currentWalletIndex = payload.currentWalletIndex;
      const allWallets = state.allWallets;
      const currentWallet = allWallets[currentWalletIndex] || {};
      const previousCoins = currentWallet.coins;
      if (!existingCoins.length) {
        currentWallet.coins = getUniqueCoins([...previousCoins, ...newCoins]);
      } else {
        currentWallet.coins = getUniqueCoins([
          ...previousCoins.map(item => {
            const currentKey = generateUniqueKeyForChain(item);
            const foundCoin = previousCoins.find(subItem => {
              const tempKey = generateUniqueKeyForChain(subItem);
              return currentKey === tempKey;
            });
            if (foundCoin) {
              return {...item, ...foundCoin, isInWallet: true};
            }
            return item;
          }),
          ...newCoins,
        ]);
      }
    });
    builder.addCase(addToken.fulfilled, (state, {payload}) => {
      if (payload) {
        const allWallets = state.allWallets;
        const currentWallets = allWallets[state.currentWalletIndex] || {};
        currentWallets.coins = [...currentWallets.coins, payload];
      }
    });
    builder.addCase(createWallet.fulfilled, (state, {payload}) => {
      const newStoreWallet = payload?.newStoreWallet;
      const isFromImportWallet = payload?.isFromImportWallet;
      const privateKey = payload?.privateKey;
      const address = payload?.address;
      const chain_name = payload?.chain_name;
      const isImportWalletWithPrivateKey =
        payload?.isImportWalletWithPrivateKey;
      newStoreWallet.updateTimestamp = Date.now();
      newStoreWallet.isBackedup = isFromImportWallet;
      newStoreWallet.isImportWalletWithPrivateKey =
        isImportWalletWithPrivateKey;
      newStoreWallet.privateKey = privateKey;
      newStoreWallet.address = address;
      newStoreWallet.chain_name = chain_name;
      newStoreWallet.isEVMAddressesAdded = false;

      // coinsAdapter.addMany(newCoinsState, payload.newStoreWallet.coins);
      // Add the new wallet to the wallets state
      if (payload.replace) {
        state.allWallets = [newStoreWallet];
      } else {
        const allWallets = state.allWallets;
        state.allWallets = [...allWallets, newStoreWallet];
        state.currentWalletIndex = state.allWallets.length - 1;
      }
    });
    builder.addCase(
      addEVMAndTronDeriveAddresses.fulfilled,
      (state, {payload}) => {
        const currentWalletIndex = payload?.currentWalletIndex;
        const tronDeriveAddresses = payload?.tronDeriveAddresses;
        const evmDeriveAddresses = payload?.evmDeriveAddresses;
        const solanaDeriveAddresses = payload?.solanaDeriveAddresses;
        if (
          currentWalletIndex !== undefined &&
          Array.isArray(evmDeriveAddresses) &&
          evmDeriveAddresses.length
        ) {
          const allWallets = state.allWallets;
          const currentWallets = allWallets[currentWalletIndex] || {};
          const allCoins = [...currentWallets.coins];

          currentWallets.coins = allCoins.map(item => {
            const oldDeriveAddress = item?.deriveAddresses;

            const isEVM = isEVMChain(item?.chain_name);
            if (isEVM) {
              return {
                ...item,
                deriveAddresses: getUniqueAccounts(
                  oldDeriveAddress,
                  evmDeriveAddresses,
                ),
              };
            } else if (item?.chain_name === 'tron') {
              return {
                ...item,
                deriveAddresses: getUniqueAccounts(
                  oldDeriveAddress,
                  tronDeriveAddresses,
                ),
              };
            } else if (item?.chain_name === 'solana') {
              return {
                ...item,
                deriveAddresses: getUniqueAccounts(
                  oldDeriveAddress,
                  solanaDeriveAddresses,
                ),
              };
            } else {
              return item;
            }
          });
        }
      },
    );
    builder.addCase(
      add50AddressesOnCurrentCoin.fulfilled,
      (state, {payload}) => {
        const currentWalletIndex = payload?.currentWalletIndex;
        const chainName = payload?.chain_name;
        const deriveAddresses = payload?.deriveAddresses;
        if (
          currentWalletIndex !== undefined &&
          Array.isArray(deriveAddresses) &&
          deriveAddresses.length &&
          chainName
        ) {
          const allWallets = state.allWallets;
          const currentWallets = allWallets[currentWalletIndex] || {};
          const allCoins = [...currentWallets.coins];

          currentWallets.coins = allCoins.map(item => {
            const oldDeriveAddress = item?.deriveAddresses;
            const isSelectedEvm = isEVMChain(chainName);
            const isEVM = isEVMChain(item?.chain_name);
            if ((isEVM && isSelectedEvm) || item?.chain_name === chainName) {
              return {
                ...item,
                deriveAddresses: getUniqueAccounts(
                  oldDeriveAddress,
                  deriveAddresses,
                ),
              };
            } else {
              return item;
            }
          });
        }
      },
    );
    builder.addCase(addCustomDeriveAddress.fulfilled, (state, {payload}) => {
      const currentWalletIndex = payload?.currentWalletIndex;
      const chain_name = payload?.chain_name;
      const account = payload?.account;
      if (
        currentWalletIndex !== undefined &&
        account?.privateKey &&
        account?.address &&
        account?.derivePath &&
        chain_name
      ) {
        const allWallets = state.allWallets;
        const currentWallets = allWallets[currentWalletIndex] || {};
        const allCoins = [...currentWallets.coins];
        const isEVM = isEVMChain(chain_name);
        currentWallets.coins = allCoins.map(item => {
          if (
            (isEVM && isEVMChain(item?.chain_name)) ||
            chain_name === item?.chain_name
          ) {
            const deriveAddresses = Array.isArray(item?.deriveAddresses)
              ? [...item?.deriveAddresses]
              : [];
            if (!deriveAddresses.length) {
              deriveAddresses.push({
                address: item?.address,
                privateKey: item?.privateKey,
              });
            }
            const foundAccount = deriveAddresses?.find(
              subItem =>
                subItem?.address === account?.address ||
                subItem?.derivePath === account?.derivePath,
            );
            if (!foundAccount) {
              deriveAddresses.push({...account, isCustom: true});
            }
            return {
              ...item,
              deriveAddresses: deriveAddresses,
            };
          } else {
            return item;
          }
        });
      } else {
        console.warn('some payload missing addCustomDeriveAddress', payload);
      }
    });
  },
});

export const {
  setCurrentCoin,
  updateWalletName,
  setCurrentWalletIndex,
  updateUserCoins,
  setCoinsInCurrentWallet,
  deleteWallet,
  resetWallet,
  setBackedUp,
  setWalletConnect,
  setWalletConnectWalletData,
  removeWalletConnectSession,
  removeAllWalletConnectSession,
  resetNfts,
  setNftSelectedChain,
  setNft,
  setNftLoading,
  setSelectedNft,
  setIsAddMoreAddressPopupHidden,
  updateCurrentCoin,
  updateIsEVMAddressesAdded,
  removeEVMDeriveAddresses,
  deleteDeriveAddressInCurrentCoin,
  setSelectedDeriveAddress,
  updateContractAddress,
  setWalletPosition,
  rearrangeWallet,
  addPendingTransactions,
  setPendingTransactions,
  removePendingTransactions,
  setIsAdding50MoreAddresses,
  rearrangeCurrentWalletCoins,
  setCurrentWalletCoinsPosition,
  togglePrivacyMode,
  resetCoinsToDefaultAddressForPrivacyMode,
  setMasterClientId,
  resetIsAdding50MoreAddresses,
  createClientIdIfNotExist,
  deleteCoin,
  setFailedTransaction,
} = walletsSlice.actions;
// export default walletsSlice.reducer;
// // Export the action creators
// export const {updateWalletName, setCurrentWalletIndex, updateUserCoins} =
//   walletsSlice.actions;

// // Export the reducer
