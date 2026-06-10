import {createAsyncThunk, createSlice} from '@reduxjs/toolkit';
import {getChain} from 'dok-wallet-blockchain-networks/cryptoChain';
import {countSelectedVotes, getSelectedVotes} from './stakingSelectors';
import {
  convertToSmallAmount,
  validateNumber,
} from 'dok-wallet-blockchain-networks/helper';
import {
  selectCurrentCoin,
  selectCurrentWallet,
} from 'dok-wallet-blockchain-networks/redux/wallets/walletsSelector';
import {selectCustomRpcUrlByChainAndWallet} from 'dok-wallet-blockchain-networks/redux/customRpc/customRpcSelectors';
import {ethers, formatUnits} from 'ethers';
import {getNativeCoin} from 'dok-wallet-blockchain-networks/service/wallet.service';

const initialState = {
  loading: true,
  currencies: [],
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
    };
  },
);

export const fetchStakingAllowanceEstimationFee = createAsyncThunk(
  'staking/fetchStakingAllowanceEstimationFee',
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
    const result = await chain.getAllowanceEstimateFee({
      from: currentCoin?.address,
      contractAddress: currentCoin?.contractAddress,
      stakingProviderName: payload.stakingProviderName,
      amountInWei,
      feesType: payload.feesType,
      nonce: payload.nonce,
    });
    return {
      gasFee: result.gasFee?.toString() ?? null,
      maxPriorityFeePerGas: result.maxPriorityFeePerGas?.toString() ?? null,
      feesOptions: result.feesOptions ?? null,
      estimateGas: result.estimateGas?.toString() ?? null,
      nonce: result.nonce ?? null,
      transactionFee: result.fee ?? null,
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
    const amountInWei =
      payload.allowanceType === 'unlimited'
        ? ethers.MaxUint256
        : BigInt(allowanceData?.amountInWeiStr || '0');

    const nonce =
      payload.nonce != null
        ? payload.nonce
        : await chain.getNonce({address: currentCoin?.address});

    return chain.approve({
      contractAddress: currentCoin?.contractAddress,
      privateKey,
      stakingProviderName: payload.stakingProviderName,
      nonce,
      amountInWei,
      gasFee: payload.gasFee,
      estimateGas: payload.estimateGas,
      maxPriorityFeePerGas: payload.maxPriorityFeePerGas,
    });
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
      fetchStakingAllowanceEstimationFee.fulfilled,
      (state, {payload}) => {
        state.allowanceData = {...state.allowanceData, ...payload};
      },
    );
    builder.addCase(fetchStakingAllowanceEstimationFee.rejected, state => {
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

export const {setStakingLoading, setSelectedVotes} = stakingSlice.actions;
