import {createAsyncThunk, createSlice} from '@reduxjs/toolkit';
import {
  selectAllWallets,
  _currentWalletIndexSelector,
  isCoinScanAvailableForTimestamp,
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
import {selectIsSyncing} from 'dok-wallet-blockchain-networks/redux/coinSync/coinSyncSelectors';
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

  // requestId of the scan instance that owns this state. Stale thunk
  // instances (cancelled, then superseded by a new scan) check this and
  // stop touching the state.
  activeRequestId: null,
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
  async (args, thunkAPI) => {
    const state = thunkAPI.getState();
    // Scan the requested wallet (may differ from the active one), falling
    // back to the current wallet when no walletIndex is provided.
    const rawWalletIndex = args?.walletIndex;
    const targetWalletIndex =
      rawWalletIndex !== null &&
      rawWalletIndex !== undefined &&
      !isNaN(Number(rawWalletIndex))
        ? Number(rawWalletIndex)
        : _currentWalletIndexSelector(state);
    const targetWallet = selectAllWallets(state)?.[targetWalletIndex];
    if (!targetWallet) {
      return thunkAPI.rejectWithValue('Wallet not found');
    }

    // Every successful exit must record the scan timestamp so the 24-hour
    // cooldown arms even when a scan finds nothing new to check.
    const finishScanSuccess = () => {
      thunkAPI.dispatch(addLastCoinScanData({walletIndex: targetWalletIndex}));
      return {success: true};
    };

    // True once this scan was cancelled or superseded by a newer scan -
    // checked after every await so a stale instance stops touching state.
    const isScanAborted = () => {
      const currentState = thunkAPI.getState();
      return (
        currentState.coinSync.status === 'idle' ||
        currentState.coinSync.activeRequestId !== thunkAPI.requestId
      );
    };
    const walletCoins = targetWallet?.coins || [];
    const userCoins = walletCoins.filter(coin => coin?.isInWallet);
    const isPrivateKeyWallet = !!targetWallet?.isImportWalletWithPrivateKey;

    // Get existing chain wallets stored in the wallet
    const existingChainWallets = targetWallet?.chain_existing_coin || {};

    // Step 1: Fetch all supported coins
    thunkAPI.dispatch(setStatus('fetching'));
    thunkAPI.dispatch(setSyncingWalletIndex(targetWalletIndex));
    thunkAPI.dispatch(setSyncingWalletName(targetWallet?.walletName || null));
    const resp = await fetchCurrenciesAPI({status: false, ignoreLimit: true});
    if (isScanAborted()) {
      return {success: false, cancelled: true};
    }
    const allCoins = Array.isArray(resp?.data?.data) ? resp.data.data : [];

    if (allCoins.length === 0) {
      return finishScanSuccess();
    }

    // Step 2: Filter out coins already in wallet
    const existingKeys = new Set(
      userCoins.map(c => generateUniqueKeyForChain(c)),
    );
    let coinsToCheck = allCoins.filter(
      coin => !existingKeys.has(generateUniqueKeyForChain(coin)),
    );
    coinsToCheck = coinsToCheck.filter(coin =>
      validateSupportedChain(coin?.chain_name),
    );

    // For private key wallets, filter to compatible chains only
    if (isPrivateKeyWallet) {
      coinsToCheck = coinsToCheck.filter(coin =>
        checkValidChainForWalletImportWithPrivateKey({
          currentWallet: targetWallet,
          currentCoin: coin,
        }),
      );
    }

    if (coinsToCheck.length === 0) {
      return finishScanSuccess();
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
            currentWallet: targetWallet,
            currentCoin: {chain_name: chainKey},
          });
          if (!isCompatible) continue;
        }
        const customRPC = selectCustomRpcUrlByChainAndWallet(
          chainKey,
          targetWallet?.clientId,
        )(state);

        const {wallet} = await createWalletForChain(
          targetWallet.phrase,
          {chain_name: chainKey},
          targetWallet,
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

    if (isScanAborted()) {
      return {success: false, cancelled: true};
    }

    // Store wallets in the specific wallet's state for reuse
    thunkAPI.dispatch(
      setWalletChainExistingCoin({
        walletIndex: targetWalletIndex,
        chainWallets,
      }),
    );
    // Pass the target wallet explicitly to getCoinSnapshot (it falls back to
    // the CURRENT wallet when given null, which would scan the wrong wallet).
    const targetWalletWithChains = {
      ...targetWallet,
      chain_existing_coin: chainWallets,
    };

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
      // Check if cancelled or superseded by a newer scan
      if (isScanAborted()) {
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
          targetWalletWithChains,
          priceObj,
          false,
          false,
          false,
          false,
        );

        // Re-check after the await: a cancel/new scan may have happened
        // while this coin's balance was being fetched.
        if (isScanAborted()) {
          cancelled = true;
          break;
        }

        if (
          new BigNumber(result?.totalBalance || 0).isGreaterThan(
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

    return finishScanSuccess();
  },
  {
    condition: (args, {getState}) => {
      const state = getState();
      const syncStatus = state.coinSync?.status;
      // Prevent concurrent scans
      if (
        syncStatus === 'syncing' ||
        syncStatus === 'fetching' ||
        syncStatus === 'creating_wallets'
      ) {
        return false;
      }
      // Enforce 1 scan per 24 hours per wallet
      const rawWalletIndex = args?.walletIndex;
      const walletIndex =
        rawWalletIndex !== null &&
        rawWalletIndex !== undefined &&
        !isNaN(Number(rawWalletIndex))
          ? Number(rawWalletIndex)
          : state.wallets?.currentWalletIndex;
      const lastScanTimestamp =
        state.wallets?.allWallets?.[walletIndex]?.lastCoinsScanTimestamp;
      if (!isCoinScanAvailableForTimestamp(lastScanTimestamp)) {
        return false;
      }
    },
  },
);

// Cancel the running scan AND arm the 24h cooldown for the wallet being
// scanned, so start/cancel loops can't burn RPC resources. Reads the wallet
// index before cancelSync because cancelling may reset the slice state.
// Only arms the cooldown while a scan is actually running: a completed scan
// already recorded its timestamp (finishScanSuccess), and syncingWalletIndex
// survives completion/retained partial results, so re-arming here would
// extend the cooldown window.
export const cancelSyncWithCooldown = () => (dispatch, getState) => {
  const state = getState();
  const walletIndex = state.coinSync?.syncingWalletIndex;
  if (
    walletIndex !== null &&
    walletIndex !== undefined &&
    selectIsSyncing(state)
  ) {
    dispatch(addLastCoinScanData({walletIndex}));
  }
  dispatch(cancelSync());
};

export const coinSyncSlice = createSlice({
  name: 'coinSync',
  initialState,
  reducers: {
    resetCoinSync: state => {
      Object.assign(state, initialState);
    },
    cancelSync: state => {
      // Abort signal: nulling the requestId makes the running thunk
      // instance stop (isScanAborted checks the mismatch) without
      // relying on status being 'idle'.
      state.activeRequestId = null;
      state.currentSyncingCoin = null;
      if (state.coinsWithBalance.length > 0) {
        // Keep partial results so the user can still add the coins that
        // were already found; 'completed' shows the selection UI.
        state.status = 'completed';
      } else {
        // Nothing found - full reset so no stale data leaks into
        // another wallet's scan screen.
        Object.assign(state, initialState);
      }
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
    // Persistent per-wallet dismissal lives on the wallet object
    // (wallets slice, dismissCoinSyncBanner) - this only resets a finished
    // scan's status so the banner stops showing the result.
    dismissBanner: state => {
      if (state.status === 'completed' || state.status === 'error') {
        state.status = 'idle';
      }
    },
  },
  extraReducers: builder => {
    builder
      .addCase(syncAllCoins.pending, (state, action) => {
        state.status = 'fetching';
        state.error = null;
        state.coinsWithBalance = [];
        state.totalCoins = 0;
        state.scannedCoins = 0;
        state.currentSyncingCoin = null;
        state.syncingWalletName = null;
        state.activeRequestId = action.meta.requestId;
      })
      .addCase(syncAllCoins.fulfilled, (state, action) => {
        if (state.activeRequestId !== action.meta.requestId) {
          // Stale instance: a newer scan owns the state now
          return;
        }
        if (action.payload?.cancelled) {
          // Cancelled scans must not resurface as 'completed'. This also
          // wipes any coins that trickled in from the in-flight snapshot
          // await after cancelSync fired.
          Object.assign(state, initialState);
          return;
        }
        state.status = 'completed';
        state.currentSyncingCoin = null;
      })
      .addCase(syncAllCoins.rejected, (state, action) => {
        if (state.activeRequestId !== action.meta.requestId) {
          return;
        }
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
