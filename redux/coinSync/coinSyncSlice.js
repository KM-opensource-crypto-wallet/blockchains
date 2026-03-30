import {createAsyncThunk, createSlice} from '@reduxjs/toolkit';
import {
  selectCurrentWallet,
  selectUserCoins,
  selectCoinsForCurrentWallet,
  _currentWalletIndexSelector,
} from 'dok-wallet-blockchain-networks/redux/wallets/walletsSelector';
import {getPrice} from 'dok-wallet-blockchain-networks/service/coinMarketCap';
import {
  validateSupportedChain,
  generateUniqueKeyForChain,
  isEVMChain,
  checkValidChainForWalletImportWithPrivateKey,
} from 'dok-wallet-blockchain-networks/helper';
import {fetchCurrenciesAPI} from 'dok-wallet-blockchain-networks/service/dokApi';
import {createWalletForChain} from 'dok-wallet-blockchain-networks/cryptoChain';
import {
  addLastCoinScanData,
  setWalletChainExistingCoin,
} from 'dok-wallet-blockchain-networks/redux/wallets/walletsSlice';
import {getCoinSnapshot} from 'dok-wallet-blockchain-networks/service/wallet.service';
import BigNumber from 'bignumber.js';
import {selectCustomRpcUrlByChainAndWallet} from 'dok-wallet-blockchain-networks/redux/customRpc/customRpcSelectors';

const initialState = {
  // Status: 'idle' | 'fetching' | 'creating_wallets' | 'syncing' | 'completed' | 'error'
  status: 'idle',

  // Only coins with balance (not all coins)
  coinsWithBalance: [],

  // Progress tracking
  totalCoins: 0,
  scannedCoins: 0,

  // Current coin being scanned (for display)
  currentSyncingCoin: null,

  // Wallet index where syncing started (to add coins to correct wallet)
  syncingWalletIndex: null,

  // Wallet name where syncing started (for display)
  syncingWalletName: null,

  // Error
  error: null,

  // Banner dismissed by user
  isBannerDismissed: false,
};

// Get unique chain keys from coins (EVM chains share 'ethereum' key)
const getUniqueChainKeys = coins => {
  const chainSet = new Set();
  coins.forEach(coin => {
    if (coin?.chain_name) {
      const key = isEVMChain(coin.chain_name) ? 'ethereum' : coin.chain_name;
      chainSet.add(key);
    }
  });
  return Array.from(chainSet);
};

// Get existing chain wallet from current wallet's coins
const getExistingChainWallet = (walletCoins, chainKey) => {
  const isEVM = chainKey === 'ethereum';
  const foundCoin = walletCoins.find(coin => {
    if (isEVM) {
      return isEVMChain(coin?.chain_name) && coin?.address && coin?.privateKey;
    }
    return coin?.chain_name === chainKey && coin?.address && coin?.privateKey;
  });

  if (foundCoin) {
    return foundCoin;
  }
  return null;
};

// Main sync thunk - seamless real-time flow
export const syncAllCoins = createAsyncThunk(
  'coinSync/syncAllCoins',
  async (_, thunkAPI) => {
    const state = thunkAPI.getState();
    const currentWallet = selectCurrentWallet(state);
    const currentWalletIndex = _currentWalletIndexSelector(state);
    const walletCoins = selectCoinsForCurrentWallet(state);
    const userCoins = selectUserCoins(state);
    const isPrivateKeyWallet = !!currentWallet?.isImportWalletWithPrivateKey;

    // Get existing chain wallets stored in the wallet
    const existingChainWallets = currentWallet?.chain_existing_coin || {};

    // Step 1: Fetch all supported coins
    thunkAPI.dispatch(setStatus('fetching'));
    thunkAPI.dispatch(setSyncingWalletIndex(currentWalletIndex));
    thunkAPI.dispatch(setSyncingWalletName(currentWallet?.walletName || null));
    const resp = await fetchCurrenciesAPI({status: false, ignoreLimit: true});
    const allCoins = Array.isArray(resp?.data?.data) ? resp.data.data : [];

    if (allCoins.length === 0) {
      return {success: true};
    }

    // Step 2: Filter out coins already in wallet
    const existingKeys = new Set(
      userCoins.map(c => generateUniqueKeyForChain(c)),
    );
    let coinsToCheck = allCoins.filter(
      coin => !existingKeys.has(generateUniqueKeyForChain(coin)),
    );

    // For private key wallets, filter to compatible chains only
    if (isPrivateKeyWallet) {
      coinsToCheck = coinsToCheck.filter(coin =>
        checkValidChainForWalletImportWithPrivateKey({
          currentWallet,
          currentCoin: coin,
        }),
      );
    }

    if (coinsToCheck.length === 0) {
      return {success: true};
    }

    // Set total coins for progress tracking
    thunkAPI.dispatch(setTotalCoins(coinsToCheck.length));

    // Step 3: Create wallets for unique chains (blocking)
    // First check existing wallets in redux state and current wallet coins
    thunkAPI.dispatch(setStatus('creating_wallets'));
    const uniqueChainKeys = getUniqueChainKeys(coinsToCheck);
    const chainWallets = {...existingChainWallets};

    for (const chainKey of uniqueChainKeys) {
      // Skip if already have wallet for this chain
      if (chainWallets[chainKey]) {
        continue;
      }

      // Check if current wallet already has a coin with this chain
      const existingWallet = getExistingChainWallet(walletCoins, chainKey);
      if (existingWallet) {
        chainWallets[chainKey] = existingWallet;
        continue;
      }

      try {
        if (isPrivateKeyWallet) {
          const isCompatible = checkValidChainForWalletImportWithPrivateKey({
            currentWallet,
            currentCoin: {chain_name: chainKey},
          });
          if (!isCompatible) continue;
        }
        const customRPC = selectCustomRpcUrlByChainAndWallet(
          chainKey,
          currentWallet?.clientId,
        )(state);

        const {wallet} = await createWalletForChain(
          currentWallet.phrase,
          {chain_name: chainKey},
          currentWallet,
          customRPC,
        );

        if (wallet) {
          chainWallets[chainKey] = {
            address: wallet.address,
            privateKey: wallet.privateKey,
            publicKey: wallet.publicKey,
            extendedPublicKey: wallet.extendedPublicKey,
            extendedPrivateKey: wallet.extendedPrivateKey,
          };
        }
      } catch (error) {
        console.warn(`Failed to create wallet for ${chainKey}:`, error);
      }
    }

    // Store wallets in the specific wallet's state for reuse
    thunkAPI.dispatch(
      setWalletChainExistingCoin({
        walletIndex: currentWalletIndex,
        chainWallets,
      }),
    );
    const currentUpdatedWallet = state?.allWallets?.[currentWalletIndex];
    if (currentUpdatedWallet && chainWallets) {
      currentUpdatedWallet.chain_existing_coin = chainWallets;
    }

    // Step 4: Check balances for all coins (real-time updates)
    thunkAPI.dispatch(setStatus('syncing'));

    // Get prices for all coins
    const symbols = [...new Set(coinsToCheck.map(c => c.symbol))].join(',');
    const localCurrency = state.settings?.localCurrency || 'USD';
    let priceObj = {};
    try {
      priceObj = await getPrice(symbols, localCurrency);
    } catch (e) {
      console.warn('Failed to fetch prices');
    }

    let cancelled = false;
    for (let i = 0; i < coinsToCheck.length; i++) {
      // Check if cancelled
      const currentState = thunkAPI.getState();
      if (currentState.coinSync.status === 'idle') {
        cancelled = true;
        break;
      }

      const coin = coinsToCheck[i];

      // Update current scanning coin and progress
      thunkAPI.dispatch(setCurrentSyncingCoin(coin));
      thunkAPI.dispatch(setScannedCoins(i + 1));

      // Validate chain support
      if (!validateSupportedChain(coin?.chain_name)) {
        continue;
      }
      try {
        const result = await getCoinSnapshot(
          state,
          coin,
          currentUpdatedWallet,
          priceObj,
          false,
          false,
          false,
          false,
          false,
        );

        if (
          new BigNumber(result?.totalAmount || 0).isGreaterThan(
            new BigNumber(0),
          )
        ) {
          thunkAPI.dispatch(
            addCoinWithBalance({
              ...result,
              isSelected: true,
            }),
          );
        }
      } catch (e) {
        console.error('error in sync coin', e);
      }
    }

    if (cancelled) {
      return {success: false, cancelled: true};
    }

    thunkAPI.dispatch(addLastCoinScanData({walletIndex: currentWalletIndex}));

    return {success: true};
  },
  {
    condition: (_, {getState}) => {
      const syncStatus = getState().coinSync?.status;
      // Prevent concurrent scans
      if (
        syncStatus === 'syncing' ||
        syncStatus === 'fetching' ||
        syncStatus === 'creating_wallets'
      ) {
        return false;
      }
    },
  },
);

export const coinSyncSlice = createSlice({
  name: 'coinSync',
  initialState,
  reducers: {
    resetCoinSync: state => {
      Object.assign(state, initialState);
    },
    cancelSync: state => {
      state.status = 'idle';
      state.currentSyncingCoin = null;
    },
    setStatus: (state, action) => {
      state.status = action.payload;
    },
    setSyncingWalletIndex: (state, action) => {
      state.syncingWalletIndex = action.payload;
    },
    setSyncingWalletName: (state, action) => {
      state.syncingWalletName = action.payload;
    },
    setTotalCoins: (state, action) => {
      state.totalCoins = action.payload;
    },
    setScannedCoins: (state, action) => {
      state.scannedCoins = action.payload;
    },
    setCurrentSyncingCoin: (state, action) => {
      state.currentSyncingCoin = action.payload;
    },
    addCoinWithBalance: (state, action) => {
      state.coinsWithBalance.push(action.payload);
    },
    toggleCoinSelection: (state, action) => {
      const index = action.payload;
      if (state.coinsWithBalance[index]) {
        state.coinsWithBalance[index].isSelected =
          !state.coinsWithBalance[index].isSelected;
      }
    },
    selectAllCoins: state => {
      state.coinsWithBalance.forEach(coin => {
        coin.isSelected = true;
      });
    },
    deselectAllCoins: state => {
      state.coinsWithBalance.forEach(coin => {
        coin.isSelected = false;
      });
    },
    dismissBanner: state => {
      state.isBannerDismissed = true;
    },
  },
  extraReducers: builder => {
    builder
      .addCase(syncAllCoins.pending, state => {
        state.status = 'fetching';
        state.error = null;
        state.coinsWithBalance = [];
        state.totalCoins = 0;
        state.scannedCoins = 0;
        state.currentSyncingCoin = null;
        state.syncingWalletName = null;
      })
      .addCase(syncAllCoins.fulfilled, state => {
        state.status = 'completed';
        state.currentSyncingCoin = null;
      })
      .addCase(syncAllCoins.rejected, (state, action) => {
        state.status = 'error';
        state.error = action.error.message;
        state.currentSyncingCoin = null;
      });
  },
});

export const {
  resetCoinSync,
  cancelSync,
  setStatus,
  setSyncingWalletIndex,
  setSyncingWalletName,
  setTotalCoins,
  setScannedCoins,
  setCurrentSyncingCoin,
  addCoinWithBalance,
  toggleCoinSelection,
  selectAllCoins,
  deselectAllCoins,
  dismissBanner,
} = coinSyncSlice.actions;

export default coinSyncSlice.reducer;
