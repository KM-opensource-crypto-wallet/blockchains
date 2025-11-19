import { createAsyncThunk, createSlice } from '@reduxjs/toolkit';
import { selectCurrentWallet } from 'dok-wallet-blockchain-networks/redux/wallets/walletsSelector';
import {
  fetchBatchTransactionBalances,
  getNativeCoin,
} from 'dok-wallet-blockchain-networks/service/wallet.service';
import { showToast } from '../../../src/utils/toast';
import BigNumber from 'bignumber.js';
import {
  getBatchTransactions,
  getBatchTransactionsBalances,
} from './batchTransactionSelectors';
import { createBalanceKey } from 'dok-wallet-blockchain-networks/helper';
import { getPrice } from 'dok-wallet-blockchain-networks/service/coinMarketCap';
import { getLocalCurrency } from 'dok-wallet-blockchain-networks/redux/settings/settingsSelectors';
import structuredClone from '@ungap/structured-clone';

const initialState = {
  transactions: {},
  pendingAmounts: {},
  ui: {
    selectedChain: '',
    selectedAddress: '',
    isSelectionMode: false,
    selectedItems: [],
  },
  filteredData: {
    filteredTransactions: [],
    uniqueChains: [],
    uniqueAddresses: [],
    loading: false,
    error: null,
  },
  balances: {},
  isValid: true,
  invalid_reason: '',
};

export const initializeFilters = createAsyncThunk(
  'batchTransaction/initializeFilters',
  async (payload, thunkAPI) => {
    try {
      let isValid = true;
      let invalid_reason = '';
      let priceObj = {};
      const currentState = thunkAPI.getState();
      const { transactions, selectedChain, selectedAddress } = payload || {};
      let balances = getBatchTransactionsBalances(currentState);
      let allWalletTransactions = transactions;
      if (!allWalletTransactions || !allWalletTransactions?.length) {
        const currentWallet = selectCurrentWallet(currentState);
        const allTransactions = getBatchTransactions(currentState);
        const walletId = currentWallet?.clientId;
        allWalletTransactions = allTransactions[walletId] || [];
      }

      // Get unique chains
      const chainObj = {};
      allWalletTransactions?.forEach(transaction => {
        const chainName = transaction?.coinInfo?.chain_name;
        if (chainName && !chainObj[chainName]) {
          chainObj[chainName] = {
            label: transaction.coinInfo.chain_display_name || chainName,
            value: chainName,
          };
        }
      });
      const uniqueChains = Object.values(chainObj);

      // Determine selected chain and address
      const finalSelectedChain =
        selectedChain || allWalletTransactions?.[0]?.chain_name || '';
      const finalSelectedAddress =
        selectedAddress || allWalletTransactions?.[0]?.coinInfo?.address || '';

      // Get unique addresses for selected chain
      const addressObj = {};

      allWalletTransactions?.forEach(transaction => {
        const address = transaction?.coinInfo?.address;
        if (
          transaction?.coinInfo?.chain_name === finalSelectedChain &&
          address &&
          !addressObj[address]
        ) {
          addressObj[address] = {
            label: `${address.slice(0, 8)}...${address.slice(-6)}`,
            value: address,
          };
        }
      });

      const uniqueAddresses = Object.values(addressObj);

      // Filter transactions
      const filteredTransactions =
        allWalletTransactions?.filter(transaction => {
          const chainMatch =
            !finalSelectedChain ||
            transaction?.coinInfo?.chain_name === finalSelectedChain;
          const addressMatch =
            !finalSelectedAddress ||
            transaction?.coinInfo?.address === finalSelectedAddress;
          return chainMatch && addressMatch;
        }) || [];
      if (payload?.isFetchDetails) {
        const fetchedBalances = await fetchBatchTransactionBalances(
          filteredTransactions,
          currentState,
        );
        const allSymbols = [
          ...new Set(
            filteredTransactions
              ?.map(item => item?.coinInfo?.symbol)
              ?.filter(Boolean),
          ),
        ]?.join(',');
        const localCurrency = getLocalCurrency(currentState) || 'USD';
        if (allSymbols) {
          priceObj = await getPrice(allSymbols, localCurrency);
        }

        balances = { ...balances, ...fetchedBalances };
      }
      const tempBalances = {};
      const finalFilterTransactions = filteredTransactions.map(item => {
        const tempItem = structuredClone(item);
        const key = createBalanceKey(tempItem?.coinInfo);
        const availableBalance = new BigNumber(
          tempBalances[key] || balances[key] || '0',
        );
        const amount = new BigNumber(tempItem?.transferData.amount || 0);
        const extra = {};
        if (amount.gt(availableBalance)) {
          extra.is_exceed_balance = true;
          extra.require_amount = amount.minus(availableBalance).toString();
          isValid = false;
          invalid_reason = ` 'Your transaction(s) exceed the available balance. Please remove specific transaction(s) or add funds.
          Note: Gas fees are not included in this check and will be calculated separately`;
        }
        const leftBalance = availableBalance.minus(amount);
        tempBalances[key] = leftBalance.toString();
        const coinSymbol = tempItem.coinInfo?.symbol || '';
        if (priceObj[coinSymbol]) {
          const priceBN = new BigNumber(priceObj[coinSymbol] || '0');
          const amountBN = new BigNumber(tempItem?.transferData.amount || 0);
          const fiatAmount = priceBN.multipliedBy(amountBN).toFixed(2);
          tempItem.transferData = { ...tempItem.transferData, fiatAmount };
        }
        return { ...tempItem, ...extra };
      });

      return {
        filteredTransactions: finalFilterTransactions,
        uniqueChains,
        uniqueAddresses,
        selectedChain: finalSelectedChain,
        selectedAddress: finalSelectedAddress,
        balances,
        isValid,
        invalid_reason,
      };
    } catch (error) {
      console.error('Error in initializeFilters', error);
      return thunkAPI.rejectWithValue(error.message);
    }
  },
);

export const addBatchTransaction = createAsyncThunk(
  'batchTransaction/addBatchTransaction',
  async (payload, thunkAPI) => {
    try {
      const currentState = thunkAPI.getState();
      const currentWallet = selectCurrentWallet(currentState);
      const wallet_id = currentWallet?.clientId;

      // Check if adding this transaction would exceed the limit of 3
      const existingTransactions =
        currentState.batchTransaction.transactions[wallet_id] || [];
      if (
        existingTransactions?.find(
          item => item?.transactionId === payload?.transactionId,
        )
      ) {
        showToast({
          type: 'errorToast',
          title: 'Transaction already added',
          message: 'Check in home screen',
        });
        return thunkAPI.rejectWithValue('Transaction already added');
      }
      if (existingTransactions.length >= 980) {
        showToast({
          type: 'errorToast',
          title: 'Transaction limit reached.',
          message: 'Maximum 980 transactions can be added',
        });
        return thunkAPI.rejectWithValue('Transaction limit reached');
      }
      const selectedCoin = payload.selectedCoin;
      const chain_name = selectedCoin?.chain_name;
      const nativeCoin = await getNativeCoin(
        currentState,
        selectedCoin,
        currentWallet,
      );
      if (!nativeCoin) {
        return null;
      }
      const transferData = payload?.transferData;
      let calls;
      if (payload?.isNFT) {
        calls = await nativeCoin.createNFTCall(transferData);
      } else if (payload?.isERC20Token) {
        calls = await nativeCoin.createTokenCall(transferData);
      } else {
        calls = await nativeCoin.createCall(transferData);
      }
      const transaction = {
        transactionId: payload?.transactionId,
        transferData,
        calls,
        coinInfo: {
          _id: selectedCoin?._id,
          chain_name: selectedCoin?.chain_name,
          chain_display_name: selectedCoin?.chain_display_name,
          chain_symbol: selectedCoin?.chain_symbol,
          type: selectedCoin?.type,
          token_type: selectedCoin?.token_type,
          name: selectedCoin?.name,
          icon: selectedCoin?.icon,
          symbol: selectedCoin?.symbol,
          contractAddress: selectedCoin?.contractAddress,
          decimal: selectedCoin?.decimal,
          status: selectedCoin?.status,
          isInWallet: selectedCoin?.isInWallet,
          address: selectedCoin?.address,
          privateKey: selectedCoin?.privateKey,
          totalCourse: selectedCoin?.totalCourse,
          currencyRate: selectedCoin?.currencyRate,
          totalAmount: selectedCoin?.totalAmount,
          totalBalanceCourse: selectedCoin?.totalBalanceCourse,
          totalBalance: selectedCoin?.totalBalance,
        },
        chain_name,
        wallet_id,
      };
      const navigation = payload?.navigation;
      const router = payload?.router;
      if (navigation) {
        navigation.navigate('Sidebar', {
          screen: 'Home',
        });
      } else if (router) {
        router.replace('/home');
      }
      return {
        wallet_id,
        chain_name,
        transaction,
      };
    } catch (e) {
      console.error('Error in addBatchTransaction', e);
      showToast({
        type: 'errorToast',
        title: e?.message,
      });
      return thunkAPI.rejectWithValue(e?.message);
    }
  },
);

export const batchTransactionSlice = createSlice({
  name: 'batchTransaction',
  initialState,
  reducers: {
    removeBatchTransaction: (state, { payload }) => {
      const { transactionIds, wallet_id } = payload;

      if (state.transactions?.[wallet_id]) {
        const transactions = state.transactions[wallet_id];
        const transactionIdsSet = new Set(transactionIds);

        // Reverse loop + splice is efficient for removal
        for (let i = transactions.length - 1; i >= 0; i--) {
          if (transactionIdsSet.has(transactions[i].transactionId)) {
            const transactionToRemove = transactions[i];
            const { chain_name } = transactionToRemove;
            // Direct mutation is fine in RTK
            transactions.splice(i, 1);

            // Update pending amounts immediately
            const key = `${wallet_id}_${chain_name}_${transactionToRemove?.coinInfo?.symbol}_${transactionToRemove?.coinInfo?.address}`;
            if (state.pendingAmounts?.[key]) {
              const currentPending = new BigNumber(
                state.pendingAmounts[key] || '0',
              );
              const transactionAmount = new BigNumber(
                transactionToRemove?.transferData?.amount || '0',
              );
              const newPending = currentPending.minus(transactionAmount);

              if (newPending.isLessThanOrEqualTo(0)) {
                delete state.pendingAmounts[key];
              } else {
                state.pendingAmounts[key] = newPending.toString();
              }
            }
          }
        }
      }
    },
    clearAllBatchTransactions: (state, { payload }) => {
      const { wallet_id } = payload;

      if (wallet_id) {
        if (state.transactions?.[wallet_id]) {
          delete state.transactions[wallet_id];
        }
        Object.keys(state.pendingAmounts).forEach(key => {
          if (key.startsWith(`${wallet_id}_`)) {
            delete state.pendingAmounts[key];
          }
        });
      }
      state.ui.selectedChain = '';
      state.ui.selectedAddress = '';
    },
    clearTransactionsForSelectedChain: (state, { payload }) => {
      const { wallet_id, chain_name, address } = payload;
      if (state.transactions?.[wallet_id]) {
        const transactions = state.transactions[wallet_id];

        // Reverse loop + splice is efficient for removal
        for (let i = transactions.length - 1; i >= 0; i--) {
          const transactionToRemove = transactions[i];
          if (
            transactionToRemove?.coinInfo?.chain_name === chain_name &&
            transactionToRemove?.coinInfo?.address === address
          ) {
            // Direct mutation is fine in RTK
            transactions.splice(i, 1);

            // Update pending amounts immediately
            const key = `${wallet_id}_${chain_name}_${transactionToRemove?.coinInfo?.symbol}_${transactionToRemove?.coinInfo?.address}`;
            if (state.pendingAmounts?.[key]) {
              const currentPending = new BigNumber(
                state.pendingAmounts[key] || '0',
              );
              const transactionAmount = new BigNumber(
                transactionToRemove?.transferData?.amount || '0',
              );
              const newPending = currentPending.minus(transactionAmount);

              if (newPending.isLessThanOrEqualTo(0)) {
                delete state.pendingAmounts[key];
              } else {
                state.pendingAmounts[key] = newPending.toString();
              }
            }
          }
        }
      }
      state.ui.selectedChain = '';
      state.ui.selectedAddress = '';
    },
    setSelectedChain: (state, { payload }) => {
      state.ui.selectedChain = payload;
    },
    setSelectedAddress: (state, { payload }) => {
      state.ui.selectedAddress = payload;
    },
    setIsSelectionMode: (state, { payload }) => {
      state.ui.isSelectionMode = payload;
    },
    setSelectedItems: (state, { payload }) => {
      state.ui.selectedItems = payload;
    },
    toggleSelectedItem: (state, { payload }) => {
      const transactionId = payload;
      const index = state.ui.selectedItems.indexOf(transactionId);
      if (index >= 0) {
        state.ui.selectedItems.splice(index, 1);
      } else {
        state.ui.selectedItems.push(transactionId);
      }
    },
    clearSelectedItems: state => {
      state.ui.selectedItems = [];
    },
    resetBatchTransactions: () => {
      return initialState;
    },
  },
  extraReducers: builder => {
    builder
      .addCase(initializeFilters.pending, state => {
        state.filteredData.loading = true;
        state.filteredData.error = null;
      })
      .addCase(initializeFilters.fulfilled, (state, { payload }) => {
        state.filteredData.loading = false;
        state.filteredData.filteredTransactions = payload.filteredTransactions;
        state.filteredData.uniqueChains = payload.uniqueChains;
        state.filteredData.uniqueAddresses = payload.uniqueAddresses;
        state.ui.selectedChain = payload.selectedChain;
        state.ui.selectedAddress = payload.selectedAddress;
        state.filteredData.error = null;
        state.balances = { ...state.balances, ...(payload?.balances || {}) };
        state.isValid = payload?.isValid;
        state.invalid_reason = payload?.invalid_reason;
      })
      .addCase(initializeFilters.rejected, (state, { payload }) => {
        state.filteredData.loading = false;
        state.filteredData.error = payload || 'Failed to initialize filters';
      })
      .addCase(addBatchTransaction.fulfilled, (state, { payload }) => {
        const { wallet_id, chain_name, transaction } = payload;
        if (!state.transactions) {
          state.transactions = {};
        }
        if (!state.transactions[wallet_id]) {
          state.transactions[wallet_id] = [];
        }
        const key = `${wallet_id}_${chain_name}_${transaction?.coinInfo?.symbol}_${transaction?.coinInfo?.address}`;
        const currentPending = new BigNumber(state.pendingAmounts[key] || '0');
        const transactionAmount = new BigNumber(
          transaction?.transferData?.amount || '0',
        );
        const newPending = currentPending.plus(transactionAmount);
        state.pendingAmounts[key] = newPending.toString();
        state.transactions[wallet_id].push(transaction);
      });
  },
});

export const {
  removeBatchTransaction,
  clearAllBatchTransactions,
  setSelectedChain,
  setSelectedAddress,
  setIsSelectionMode,
  setSelectedItems,
  toggleSelectedItem,
  clearSelectedItems,
  clearTransactionsForSelectedChain,
  resetBatchTransactions,
} = batchTransactionSlice.actions;
