import {createAsyncThunk, createSlice} from '@reduxjs/toolkit';
import {getExchange} from 'dok-wallet-blockchain-networks/redux/exchange/exchangeSelectors';
import {
  calculateEstimateFee,
  setCurrentTransferData,
} from 'dok-wallet-blockchain-networks/redux/currentTransfer/currentTransferSlice';
import {getChain} from 'dok-wallet-blockchain-networks/cryptoChain';
import {isNameSupportChain} from 'dok-wallet-blockchain-networks/helper';
import {showToast} from 'utils/toast';
import {createExchange} from 'dok-wallet-blockchain-networks/service/dokApi';

const initialState = {
  amountFrom: '',
  amountTo: '',
  selectedCoinFromOptions: null,
  selectedCoinToOptions: null,
  selectedFromAsset: null,
  selectedToAsset: null,
  selectedFromWallet: null,
  possibleFromCoin: [],
  possibleToCoins: [],
  customOption: '',
  customAddress: '',
  isLoading: false,
  success: false,
  selectedExchangeChain: null,
  sliderValue: 0,
  fiatPay: '0',
  exchangeToAddress: '',
  exchangeToName: '',
  availableProviders: [],
};

export const calculateExchange = createAsyncThunk(
  'exchange/calculateExchange',
  async (_, thunkAPI) => {
    const dispatch = thunkAPI.dispatch;
    try {
      const currentState = thunkAPI.getState();
      dispatch(setExchangeLoading(true));
      const {
        selectedFromAsset,
        selectedToAsset,
        amountFrom,
        selectedFromWallet,
        customOption,
        customAddress,
        selectedExchangeChain,
        extraData,
      } = getExchange(currentState);
      let finalCustomAddress = null;
      let validName = null;
      if (customOption === 'Custom') {
        const toAssetChainName = selectedToAsset?.chain_name;
        const chain = getChain(toAssetChainName);
        const isValidAddress = chain.isValidAddress({
          address: customAddress,
        });
        if (isValidAddress) {
          finalCustomAddress = customAddress;
        } else if (!isValidAddress && isNameSupportChain(toAssetChainName)) {
          finalCustomAddress = await chain?.isValidName({
            name: customAddress,
          });
          validName = customAddress;
        }
        if (!finalCustomAddress) {
          throw new Error('Invalid Custom Address');
        }
      }
      const payload = {
        coinFrom: selectedFromAsset?.symbol,
        coinTo: selectedToAsset?.symbol,
        networkFrom: selectedFromAsset?.chain_symbol,
        networkTo: selectedToAsset?.chain_symbol,
        fromChainName: selectedFromAsset?.chain_name,
        toChainName: selectedToAsset?.chain_name,
        fromContractAddress: selectedFromAsset?.contractAddress,
        toContractAddress: selectedToAsset?.contractAddress,
        amount: Number(amountFrom),
        rateType: 'fixed',
        withdrawalAddress: finalCustomAddress || selectedToAsset?.address,
        validName,
        refundAddress: selectedFromAsset?.address,
        extraData,
        providerName: selectedExchangeChain?.providerName,
      };
      const resp = await createExchange(payload);
      if (resp?.status === 201 || resp?.status === 200) {
        const data = resp?.data;
        if (data) {
          dispatch(
            setExchangeFields({
              amountFrom: data?.amount + '',
              amountTo: data?.amountTo + '',
              exchangeToName: validName,
              exchangeToAddress: finalCustomAddress || selectedToAsset?.address,
            }),
          );
          dispatch(
            setCurrentTransferData({
              toAddress: data?.depositAddress,
              memo: data?.memo || null,
              currentCoin: selectedFromAsset,
              amount: amountFrom,
              isSendFunds: false,
            }),
          );
          await dispatch(
            calculateEstimateFee({
              isFetchNonce: true,
              fromAddress: selectedFromAsset?.address,
              toAddress: data?.depositAddress,
              amount: amountFrom,
              contractAddress: selectedFromAsset?.contractAddress,
              selectedWallet: selectedFromWallet,
              selectedCoin: selectedFromAsset,
            }),
          ).unwrap();
        }
        dispatch(setExchangeSuccess(true));
      } else {
        dispatch(setExchangeSuccess(false));
      }
    } catch (e) {
      console.error('errorr in exchange', e);
      dispatch(setExchangeSuccess(false));
      if (e?.message === 'Invalid Custom Address') {
        showToast({
          type: 'errorToast',
          title: 'Invalid custom address',
          message: 'Invalid custom address',
        });
      }
    }
  },
);

export const exchangeSlice = createSlice({
  name: 'exchange',
  initialState,
  reducers: {
    setExchangeFields(state, {payload}) {
      return {...state, ...payload};
    },
    resetExchangeFields() {
      return initialState;
    },
    setExchangeLoading(state, {payload}) {
      state.isLoading = payload;
      if (payload) {
        state.success = false;
      }
    },
    setExchangeSuccess(state, {payload}) {
      state.success = payload;
      state.isLoading = false;
    },
  },
});

export const {
  resetExchangeFields,
  setExchangeFields,
  setExchangeLoading,
  setExchangeSuccess,
} = exchangeSlice.actions;
