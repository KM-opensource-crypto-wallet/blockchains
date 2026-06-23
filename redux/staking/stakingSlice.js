import {createAsyncThunk, createSlice} from '@reduxjs/toolkit';
import {getChain} from 'dok-wallet-blockchain-networks/cryptoChain';
import {countSelectedVotes, getSelectedVotes} from './stakingSelectors';
import {
  convertToSmallAmount,
  parseBalance,
  validateNumber,
} from 'dok-wallet-blockchain-networks/helper';
import {
  selectCurrentCoin,
  selectCurrentWallet,
} from 'dok-wallet-blockchain-networks/redux/wallets/walletsSelector';
import {selectCustomRpcUrlByChainAndWallet} from 'dok-wallet-blockchain-networks/redux/customRpc/customRpcSelectors';
import {ethers, formatUnits} from 'ethers';
import {getNativeCoin} from 'dok-wallet-blockchain-networks/service/wallet.service';
import BigNumber from 'bignumber.js';
import {showToast} from 'utils/toast';

const initialState = {
  loading: true,
  error: null,
  validators: {},
  selectedVotes: {},
  allowanceData: null,
  allowanceLoading: false,
  approveLoading: false,
};

export const fetchStakingAllowance = createAsyncThunk(
  'staking/fetchStakingAllowance',
  async (payload, thunkAPI) => {
    const currentState = thunkAPI.getState();
    const currentCoin = selectCurrentCoin(currentState);
    const currentWallet = selectCurrentWallet(currentState);
    const chain_name = currentCoin?.chain_name;
    const customRPC = selectCustomRpcUrlByChainAndWallet(
      chain_name,
      currentWallet?.clientId,
    )(currentState);
    const chain = getChain(chain_name, currentWallet?.phrase, customRPC);
    const decimals = currentCoin?.decimal || 18;
    const amountInWei = BigInt(
      convertToSmallAmount(payload.amount.toString(), decimals),
    );
    const result = await chain.readAllowance({
      from: currentCoin?.address,
      contractAddress: currentCoin?.contractAddress,
      stakingProviderName: payload.stakingProviderName,
      amountInWei,
    });
    return {
      allowanceFormatted: formatUnits(result.allowance, decimals),
      requiredFormatted: formatUnits(result.required, decimals),
      stakeAmountFormatted: formatUnits(amountInWei, decimals),
      amountInWeiStr: amountInWei.toString(),
      isApproved: result.isApproved,
      needsReset: result.needsReset,
      decimal: currentCoin?.decimal,
    };
  },
);

export const fetchStakingApproveEstimationFee = createAsyncThunk(
  'staking/fetchStakingApproveEstimationFee',
  async (payload, thunkAPI) => {
    const currentState = thunkAPI.getState();
    const currentCoin = selectCurrentCoin(currentState);
    const currentWallet = selectCurrentWallet(currentState);
    const chain_name = currentCoin?.chain_name;
    const customRPC = selectCustomRpcUrlByChainAndWallet(
      chain_name,
      currentWallet?.clientId,
    )(currentState);
    const chain = getChain(chain_name, currentWallet?.phrase, customRPC);
    const decimals = currentCoin?.decimal || 18;
    const amountInWei =
      payload.allowanceType === 'unlimited'
        ? ethers.MaxUint256
        : BigInt(convertToSmallAmount(payload.amount.toString(), decimals));
    const allowanceData = currentState?.staking?.allowanceData;
    const allowance = BigInt(
      convertToSmallAmount(allowanceData?.allowanceFormatted, decimals) || '0',
    );
    const result = await chain.getEstimateFeForAllowanceApprove({
      isFetchNonce: payload.isFetchNonce,
      from: currentCoin?.address,
      contractAddress: currentCoin?.contractAddress,
      stakingProviderName: payload.stakingProviderName,
      amountInWei,
      feesType: payload.feesType,
      nonce: payload.nonce,
      allowance: allowance,
    });
    return {
      gasFee: result.gasFee?.toString() ?? null,
      maxPriorityFeePerGas: result.maxPriorityFeePerGas?.toString() ?? null,
      feesOptions: result.feesOptions ?? null,
      estimateGas: result.estimateGas?.toString() ?? null,
      nonce: result.nonce ?? null,
      transactionFee: result.fee,
      l1Fees: result.l1Fees?.toString() ?? null,
      needsAllowanceReset: !!result.allowance,
    };
  },
);

export const fetchValidatorByChain = createAsyncThunk(
  'staking/fetchValidatorByChain',
  async (payload, thunkAPI) => {
    const dispatch = thunkAPI.dispatch;
    const currentState = thunkAPI.getState();
    const currentCoin = selectCurrentCoin(currentState);
    const currentWallet = selectCurrentWallet(currentState);
    dispatch(setStakingLoading(true));
    const chain_name = payload?.chain_name;
    const customRPC = selectCustomRpcUrlByChainAndWallet(
      chain_name,
      currentWallet?.clientId,
    )(currentState);
    const chain = getChain(chain_name, currentWallet?.phrase, customRPC);
    const finalPayload = {
      chain_name,
      address: currentCoin?.address,
      contractAddress: currentCoin?.contractAddress,
    };
    const {selectedVotes, validators} = await chain.getStakingValidators(
      finalPayload,
    );
    return {
      validators: {[chain_name]: validators},
      selectedVotes,
    };
  },
);

export const onAddVotes = createAsyncThunk(
  'staking/onAddVotes',
  async (payload, thunkAPI) => {
    const dispatch = thunkAPI.dispatch;
    const currentState = thunkAPI.getState();
    const address = payload?.address;
    const localSelectedVotes = getSelectedVotes(currentState);
    const selectedTotal = countSelectedVotes(currentState);
    const currentCoin = selectCurrentCoin(currentState);
    const availableAmount = Math.floor(
      validateNumber(currentCoin?.stakingBalance) || 0,
    );
    const tempSelectedVotes = {...localSelectedVotes};
    const previousValues = tempSelectedVotes[address] || 0;
    const newValue = 5;
    if (selectedTotal + 5 > availableAmount) {
      const newAmountAdded = availableAmount - selectedTotal;
      tempSelectedVotes[address] = Math.floor(previousValues + newAmountAdded);
    } else {
      tempSelectedVotes[address] = Math.floor(previousValues + newValue);
    }
    dispatch(setSelectedVotes(tempSelectedVotes));
  },
);

export const onMinusVotes = createAsyncThunk(
  'staking/onAddVotes',
  async (payload, thunkAPI) => {
    const dispatch = thunkAPI.dispatch;
    const currentState = thunkAPI.getState();
    const address = payload?.address;
    const localSelectedVotes = getSelectedVotes(currentState);
    const tempSelectedVotes = {...localSelectedVotes};
    const previousValues = tempSelectedVotes[address] || 0;
    const newValue = 5;
    if (previousValues - 5 < 0) {
      tempSelectedVotes[address] = 0;
    } else {
      tempSelectedVotes[address] = Math.floor(previousValues - newValue);
    }
    dispatch(setSelectedVotes(tempSelectedVotes));
  },
);

export const onChangeVotes = createAsyncThunk(
  'staking/onAddVotes',
  async (payload, thunkAPI) => {
    const dispatch = thunkAPI.dispatch;
    const currentState = thunkAPI.getState();
    const address = payload?.address;
    const value = validateNumber(payload?.value);
    const localSelectedVotes = getSelectedVotes(currentState);
    const tempSelectedVotes = {...localSelectedVotes};
    if (!value || value < 0) {
      tempSelectedVotes[address] = 0;
      dispatch(setSelectedVotes(tempSelectedVotes));
      return;
    }
    const selectedTotal = countSelectedVotes(currentState);
    const currentCoin = selectCurrentCoin(currentState);
    const availableAmount = Math.floor(
      validateNumber(currentCoin?.stakingBalance) || 0,
    );
    const previousValues = tempSelectedVotes[address] || 0;
    if (selectedTotal - previousValues + value > availableAmount) {
      return;
    } else {
      tempSelectedVotes[address] = Math.floor(value);
    }
    dispatch(setSelectedVotes(tempSelectedVotes));
  },
);

export const executeApprove = createAsyncThunk(
  'staking/executeApprove',
  async (payload, thunkAPI) => {
    try {
      const currentState = thunkAPI.getState();
      const currentCoin = selectCurrentCoin(currentState);
      const currentWallet = selectCurrentWallet(currentState);
      const chain_name = currentCoin?.chain_name;
      const customRPC = selectCustomRpcUrlByChainAndWallet(
        chain_name,
        currentWallet?.clientId,
      )(currentState);
      const chain = getChain(chain_name, currentWallet?.phrase, customRPC);
      const nativeCoin = await getNativeCoin(currentState);
      const privateKey = nativeCoin?.privateKey;
      if (!privateKey) {
        throw new Error('No private key available');
      }
      const allowanceData = currentState?.staking?.allowanceData;
      const decimals = currentCoin?.decimal;
      const allowance = BigInt(
        convertToSmallAmount(allowanceData?.allowanceFormatted, decimals) ||
          '0',
      );
      const amountInWei =
        payload.allowanceType === 'unlimited'
          ? ethers.MaxUint256
          : BigInt(allowanceData?.amountInWeiStr || '0');

      const nonce =
        payload.nonce != null
          ? payload.nonce
          : await chain.getNonce({address: currentCoin?.address});

      // approve() expects gasFee/maxPriorityFeePerGas as bigint (wei); the UI
      // sends them as wei strings. Coerce here so the user's selected/custom gas
      // price is actually used instead of being silently re-fetched. feesType is
      // forwarded as a fallback for the (now rare) case where gasFee is absent.
      const toWeiBigInt = value => {
        if (value == null || value === '') {
          return undefined;
        }
        try {
          return BigInt(value);
        } catch (e) {
          return undefined;
        }
      };

      const {confirmTransaction} = await chain.approve({
        from: currentCoin?.address,
        contractAddress: currentCoin?.contractAddress,
        privateKey,
        stakingProviderName: payload.stakingProviderName,
        amountInWei,
        nonce,
        gasFee: toWeiBigInt(payload.gasFee),
        estimateGas: payload.estimateGas,
        maxPriorityFeePerGas: toWeiBigInt(payload.maxPriorityFeePerGas),
        feesType: payload.feesType,
        allowance,
      });

      if (confirmTransaction === 'pending') {
        setTimeout(() => {
          showToast({
            type: 'warningToast',
            title: 'Transaction pending',
            message: 'Transaction take too long. Please check again later',
          });
        }, 500);
      } else if (confirmTransaction?.status === 'failed') {
        setTimeout(() => {
          showToast({
            type: 'errorToast',
            title: 'Transaction Failed',
            message:
              'Your transaction failed on the network. Please try again.',
          });
        }, 400);
        return thunkAPI.rejectWithValue('Transaction failed');
      } else if (confirmTransaction) {
        return {
          tx_hash: confirmTransaction?.hash || '',
        };
      }
    } catch (error) {
      console.error('Error in execute Approve', error?.message || error);
      return thunkAPI.rejectWithValue(error?.message || 'Something went wrong');
    }
  },
);

export const stakingSlice = createSlice({
  name: 'staking',
  initialState,
  reducers: {
    setStakingLoading(state, {payload}) {
      state.loading = payload;
    },
    setSelectedVotes(state, {payload}) {
      state.selectedVotes = payload;
    },
    updateApproveFees(state, {payload}) {
      const gasPrice = payload?.gasPrice;
      const l1Fees = state.allowanceData?.l1Fees;
      const allowanceData = state.allowanceData;
      if (!gasPrice || !state.allowanceData) {
        return;
      }
      const isEVM = payload?.convertedChainName === 'ethereum';
      const gasPriceBN = new BigNumber(
        isEVM
          ? convertToSmallAmount(gasPrice?.toString(), 9)?.toString()
          : gasPrice?.toString(),
      );
      const estimateGasBN = new BigNumber(
        state.allowanceData?.estimateGas || 0,
      );
      const l1FeesBn = new BigNumber(l1Fees || 0);
      let transactionFeeBN = gasPriceBN
        .multipliedBy(estimateGasBN)
        .plus(l1FeesBn);
      // Reset path sends two txs (reset-to-0 + approve), so the estimation
      // doubles the fee. Match it so the local recompute stays consistent.
      if (state.allowanceData?.needsAllowanceReset) {
        transactionFeeBN = transactionFeeBN.multipliedBy(2);
      }
      const transactionFee = parseBalance(
        transactionFeeBN?.toString(),
        isEVM ? 18 : 8,
      );
      state.allowanceData.gasFee = gasPriceBN.toString();
      state.allowanceData.transactionFee = transactionFee;
      // Keep the EIP-1559 tip consistent with the new max fee: the priority fee
      // must stay below maxFeePerGas (gasPrice), otherwise the tx is rejected.
      // Clamp to gasPrice - 1 when the (stale) tip now exceeds the custom max fee.
      if (isEVM && state.allowanceData?.maxPriorityFeePerGas != null) {
        const priorityFeeBN = new BigNumber(
          state.allowanceData.maxPriorityFeePerGas.toString(),
        );
        state.allowanceData.maxPriorityFeePerGas = priorityFeeBN.gte(gasPriceBN)
          ? BigNumber.max(gasPriceBN.minus(1), 0).toFixed(0)
          : priorityFeeBN.toFixed(0);
      }
    },
  },
  extraReducers: builder => {
    builder.addCase(fetchStakingAllowance.pending, state => {
      state.allowanceLoading = true;
    });
    builder.addCase(fetchStakingAllowance.fulfilled, (state, {payload}) => {
      state.allowanceLoading = false;
      state.allowanceData = payload;
    });
    builder.addCase(fetchStakingAllowance.rejected, state => {
      state.allowanceLoading = false;
      state.allowanceData = null;
    });
    builder.addCase(
      fetchStakingApproveEstimationFee.fulfilled,
      (state, {payload}) => {
        state.allowanceData = {...state.allowanceData, ...payload};
      },
    );
    builder.addCase(fetchStakingApproveEstimationFee.rejected, state => {
      state.allowanceData = {
        ...state.allowanceData,
        gasFee: null,
        maxPriorityFeePerGas: null,
        feesOptions: null,
        estimateGas: null,
        nonce: null,
        transactionFee: null,
      };
    });
    builder.addCase(fetchValidatorByChain.fulfilled, (state, {payload}) => {
      const {validators, selectedVotes} = payload;
      return {
        ...state,
        selectedVotes: selectedVotes ? selectedVotes : {},
        validators: {...state.validators, ...validators},
        loading: false,
        error: null,
      };
    });
    builder.addCase(fetchValidatorByChain.rejected, (state, {payload}) => {
      console.error('errrerr', payload);
      state.error = payload;
      state.loading = false;
    });
    builder.addCase(executeApprove.pending, state => {
      state.approveLoading = true;
    });
    builder.addCase(executeApprove.fulfilled, state => {
      state.approveLoading = false;
    });
    builder.addCase(executeApprove.rejected, state => {
      state.approveLoading = false;
    });
  },
});

export const {setStakingLoading, setSelectedVotes, updateApproveFees} =
  stakingSlice.actions;
