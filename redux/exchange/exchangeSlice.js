import {createAsyncThunk, createSlice} from '@reduxjs/toolkit';
import {getExchange} from 'dok-wallet-blockchain-networks/redux/exchange/exchangeSelectors';
import {
  calculateEstimateFee,
  setCurrentTransferData,
} from 'dok-wallet-blockchain-networks/redux/currentTransfer/currentTransferSlice';
import {
  getChain,
  getHashString,
} from 'dok-wallet-blockchain-networks/cryptoChain';
import {
  isEVMChain,
  isNameSupportChain,
  isPendingTransactionSupportedChain,
  createPendingTransactionKey,
  getExplorerTxUrl,
} from 'dok-wallet-blockchain-networks/helper';
import {showToast} from 'utils/toast';
import {createExchange} from 'dok-wallet-blockchain-networks/service/dokApi';
import {selectCustomRpcUrlByChainAndWallet} from 'dok-wallet-blockchain-networks/redux/customRpc/customRpcSelectors';
import {getNativeCoin} from 'dok-wallet-blockchain-networks/service/wallet.service';
import {getTransferData} from 'dok-wallet-blockchain-networks/redux/currentTransfer/currentTransferSelector';

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
  slippage: '0.5',
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
        slippage,
      } = getExchange(currentState);
      let finalCustomAddress = null;
      let validName = null;
      if (customOption === 'Custom') {
        const toAssetChainName = selectedToAsset?.chain_name;
        const customRPC = selectCustomRpcUrlByChainAndWallet(
          toAssetChainName,
          selectedFromWallet?.clientId,
        )(currentState);

        const chain = getChain(
          toAssetChainName,
          selectedFromWallet?.phrase,
          customRPC,
        );
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
        slippage: Number(slippage) || 0.5,
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
              swapData: data?.swapData,
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
              isSwapFee: true,
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

export const sendSwap = createAsyncThunk(
  'exchange/sendSwap',
  async (txData, thunkAPI) => {
    let toastId;
    try {
      const currentState = thunkAPI.getState();
      thunkAPI.dispatch(setExchangeLoading(true));

      const {
        selectedFromAsset,
        selectedFromWallet,
        selectedToAsset,
        amountFrom,
        selectedExchangeChain,
        extraData,
        slippage,
      } = getExchange(currentState);
      const transferData = getTransferData(currentState);
      const navigation = txData?.navigation;
      const router = txData?.router;

      if (!isEVMChain(selectedFromAsset?.chain_name)) {
        throw new Error('sendSwap only supports EVM chains');
      }

      const nativeCoin = await getNativeCoin(
        currentState,
        selectedFromAsset,
        selectedFromWallet,
      );
      if (!nativeCoin) {
        throw new Error('Failed to get native coin');
      }

      let swapData = transferData?.swapData;
      const spenderAddress = swapData?.spender;
      const originalNonce = txData?.nonce ?? transferData?.nonce;
      let swapNonce = originalNonce;

      if (spenderAddress && selectedFromAsset?.contractAddress) {
        const approveResult = await nativeCoin.checkAndApproveSwap({
          swapData,
          contractAddress: selectedFromAsset.contractAddress,
        });
        const {nextNonce, approvalSent} = approveResult || {};

        if (nextNonce !== undefined) {
          swapNonce = nextNonce;
        }

        if (approvalSent) {
          const refreshResp = await createExchange({
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
            withdrawalAddress: transferData?.toAddress,
            refundAddress: selectedFromAsset?.address,
            extraData,
            providerName: selectedExchangeChain?.providerName,
            slippage: Number(slippage) || 0.5,
          });
          if (
            (refreshResp?.status === 200 || refreshResp?.status === 201) &&
            refreshResp?.data?.swapData
          ) {
            swapData = refreshResp.data.swapData;
          }
        }
      }

      const res = await nativeCoin.swap({
        swapData,
        to: transferData?.toAddress,
        from: selectedFromAsset?.address,
        amount: amountFrom,
        estimateGas: transferData?.estimateGas,
        gasFee: transferData?.gasFee,
        maxPriorityFeePerGas: transferData?.maxPriorityFeePerGas,
        isMax: transferData?.isMax,
        nonce: swapNonce,
      });

      if (res) {
        if (navigation) {
          navigation.popTo('Sidebar', {screen: 'Home'});
        } else if (router) {
          router.replace('/home');
        }
        thunkAPI.dispatch(setExchangeLoading(false));

        const tx_hash = getHashString(res, selectedFromAsset?.chain_name);

        toastId = showToast({
          type: 'progressToast',
          title: 'Exchange Transaction In-progress',
          message:
            'Your exchange transaction submitted successfully. Once the transaction completed you will be notified.',
          autoHide: false,
        });

        if (isPendingTransactionSupportedChain(selectedFromAsset?.chain_name)) {
          const key = createPendingTransactionKey({
            chain_name: selectedFromAsset?.chain_name,
            symbol: selectedFromAsset?.symbol,
            address: selectedFromAsset?.address,
          });
          thunkAPI.dispatch(
            setExchangeFields({
              pendingTransaction: {
                key,
                value: {hash: res.hash, date: new Date().toISOString()},
              },
            }),
          );
        }

        const confirmTransaction = await nativeCoin.waitForConfirmation({
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
        } else if (confirmTransaction?.status === 'failed') {
          showToast({
            type: 'errorToast',
            title: 'Transaction Failed',
            message:
              'Your transaction failed on the network. Please try again.',
            toastId,
          });
        } else if (confirmTransaction) {
          showToast({
            type: 'successToast',
            title: 'Exchange Successful',
            message: `Your transaction completed successfully. You just exchanged: ${amountFrom} ${selectedFromAsset?.symbol}`,
            toastId,
          });
        }

        return {
          tx_hash,
          url: getExplorerTxUrl(selectedFromAsset?.chain_name, tx_hash),
          status:
            confirmTransaction === 'pending'
              ? 2
              : confirmTransaction?.status === 'failed'
              ? 1
              : 3,
        };
      } else {
        thunkAPI.dispatch(setExchangeLoading(false));
        showToast({
          type: 'errorToast',
          title: 'Something Went wrong',
          autoHide: true,
          toastId,
        });
        return thunkAPI.rejectWithValue('Swap returned empty response');
      }
    } catch (e) {
      console.error('Error in sendSwap', e);
      thunkAPI.dispatch(setExchangeLoading(false));
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
          title: e?.message || 'Swap failed',
          toastId,
        });
      }
      return thunkAPI.rejectWithValue(e?.message);
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
