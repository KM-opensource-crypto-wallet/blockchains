import {createAsyncThunk, createSlice} from '@reduxjs/toolkit';
import {getChain} from 'dok-wallet-blockchain-networks/cryptoChain';
import {countSelectedVotes, getSelectedVotes} from './stakingSelectors';
import {validateNumber} from 'dok-wallet-blockchain-networks/helper';
import {selectCurrentCoin} from 'dok-wallet-blockchain-networks/redux/wallets/walletsSelector';

const initialState = {
  loading: true,
  currencies: [],
  error: null,
  validators: {},
  selectedVotes: {},
};

export const fetchValidatorByChain = createAsyncThunk(
  'staking/fetchValidatorByChain',
  async (payload, thunkAPI) => {
    const dispatch = thunkAPI.dispatch;
    const currentState = thunkAPI.getState();
    const currentCoin = selectCurrentCoin(currentState);
    dispatch(setStakingLoading(true));
    const chain_name = payload?.chain_name;
    const chain = getChain(chain_name);
    const finalPayload = {chain_name, address: currentCoin?.address};
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
  },
});

export const {setStakingLoading, setSelectedVotes} = stakingSlice.actions;
