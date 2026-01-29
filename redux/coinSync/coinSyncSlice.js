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
import {
  createWalletForChain,
  getChain,
} from 'dok-wallet-blockchain-networks/cryptoChain';
import {setWalletChainExistingCoin} from 'dok-wallet-blockchain-networks/redux/wallets/walletsSlice';
import {parseBalance} from '../../helper';

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

  // Error
  error: null,
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

// Check balance for a single coin
const checkCoinBalance = async (coin, chainWallets) => {
  const chainName = coin?.chain_name;
  const storageKey = isEVMChain(chainName) ? 'ethereum' : chainName;
  const wallet = chainWallets[storageKey];

  if (!wallet) {
    return {coin, balance: 0, error: 'No wallet found'};
  }

  const chain = getChain(chainName);
  if (!chain) {
    return {coin, balance: 0, error: 'Chain not supported'};
  }

  try {
    let balance;
    if (coin?.type === 'token' && coin?.contractAddress) {
      balance = await chain.getTokenBalance({
        address: wallet.address,
        contractAddress: coin.contractAddress,
        decimal: coin.decimal,
        symbol: coin.symbol,
      });
    } else {
      balance = await chain.getBalance({
        address: wallet.address,
        extendedPublicKey: wallet.extendedPublicKey,
        deriveAddresses: coin?.deriveAddresses,
        chain_name: coin?.chain_name,
      });
    }

    const numBalance = parseFloat(balance) || 0;
    return {coin, balance: numBalance, error: null};
  } catch (error) {
    console.warn(`Balance check failed for ${coin.symbol}:`, error?.message);
    return {coin, balance: 0, error: error?.message};
  }
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

        const {wallet} = await createWalletForChain(
          currentWallet.phrase,
          {chain_name: chainKey},
          currentWallet,
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

    for (let i = 0; i < coinsToCheck.length; i++) {
      // Check if cancelled
      const currentState = thunkAPI.getState();
      if (currentState.coinSync.status === 'idle') {
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

      const result = await checkCoinBalance(coin, chainWallets);

      if (result.balance > 0) {
        const storageKey = isEVMChain(coin.chain_name)
          ? 'ethereum'
          : coin.chain_name;
        const wallet = chainWallets[storageKey];
        const currentPrice = priceObj[coin.symbol] || 0;

        // Add coin with balance to the list (auto-selected)
        thunkAPI.dispatch(
          addCoinWithBalance({
            ...coin,
            address: wallet?.address,
            privateKey: wallet?.privateKey,
            publicKey: wallet?.publicKey,
            extendedPublicKey: wallet?.extendedPublicKey,
            extendedPrivateKey: wallet?.extendedPrivateKey,
            totalBalance: parseBalance(
              result.balance.toString(),
              coin?.decimal,
            ),
            currencyRate: currentPrice,
            isSelected: true,
          }),
        );
      }
    }

    return {success: true};
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
  setTotalCoins,
  setScannedCoins,
  setCurrentSyncingCoin,
  addCoinWithBalance,
  toggleCoinSelection,
  selectAllCoins,
  deselectAllCoins,
} = coinSyncSlice.actions;

export default coinSyncSlice.reducer;
