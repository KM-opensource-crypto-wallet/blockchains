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
  convertToSmallAmount,
  parseBalance,
} from 'dok-wallet-blockchain-networks/helper';
import {showToast} from 'utils/toast';
import {createExchange} from 'dok-wallet-blockchain-networks/service/dokApi';
import {selectCustomRpcUrlByChainAndWallet} from 'dok-wallet-blockchain-networks/redux/customRpc/customRpcSelectors';
import {getNativeCoin} from 'dok-wallet-blockchain-networks/service/wallet.service';
import {refreshCoins} from 'dok-wallet-blockchain-networks/redux/wallets/walletsSlice';
import {getTransferData} from 'dok-wallet-blockchain-networks/redux/currentTransfer/currentTransferSelector';
import {ethers} from 'ethers';

// Permit2's IAllowanceTransfer.approve(token, spender, uint160 amount, uint48 expiration)
// caps amount at uint160 max, so "unlimited" must use that ceiling on the permit2
// path instead of ethers.MaxUint256 (uint256 max), which would overflow that call.
const MAX_UINT160 = 2n ** 160n - 1n;

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
  slippage: '',
  allowanceData: null,
  allowanceLoading: false,
  approveLoading: false,
  permitAllowanceData: null,
  permitAllowanceLoading: false,
  permitApproveLoading: false,
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
        slippage: slippage ? Number(slippage) : undefined,
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
              amount: data?.amount + '',
              isSendFunds: false,
            }),
          );
          await dispatch(
            calculateEstimateFee({
              isFetchNonce: true,
              fromAddress: selectedFromAsset?.address,
              toAddress: data?.depositAddress,
              amount: data?.amount + '',
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
      return thunkAPI.rejectWithValue(e?.message);
    }
  },
);

export const fetchExchangeAllowance = createAsyncThunk(
  'exchange/fetchExchangeAllowance',
  async (_, thunkAPI) => {
    const dispatch = thunkAPI.dispatch;
    try {
      dispatch(setExchangeFields({allowanceLoading: true}));
      const currentState = thunkAPI.getState();
      const {selectedFromAsset, selectedFromWallet, amountFrom} =
        getExchange(currentState);
      const transferData = getTransferData(currentState);
      const swapData = transferData?.swapData;
      const {permit_abi, spender} = swapData;
      const {address, contractAddress, decimal} = selectedFromAsset;
      const decimals = decimal || 18;
      const amountInWei = BigInt(
        convertToSmallAmount(amountFrom.toString(), decimals),
      );
      const nativeCoin = await getNativeCoin(
        currentState,
        selectedFromAsset,
        selectedFromWallet,
      );
      if (!nativeCoin) {
        throw new Error('Failed to get native coin');
      }
      const result = await nativeCoin.readAllowance({
        from: address,
        isPermit2Flow: Boolean(permit_abi),
        permitAbi: permit_abi,
        spenderAddress: spender,
        contractAddress: contractAddress,
        amountInWei,
      });
      const allowanceData = {
        allowanceFormatted: parseBalance(result.allowance, decimals),
        requiredFormatted: parseBalance(result.required, decimals),
        amountFormatted: parseBalance(amountInWei, decimals),
        isApproved: result.isApproved,
        needsReset: result.needsReset,
        decimal: selectedFromAsset?.decimal,
        permit2Amount: result.permit2Amount,
        permit2Expiration: result.permit2Expiration,
      };
      dispatch(
        setExchangeFields({
          allowanceLoading: false,
          allowanceData,
        }),
      );
      return allowanceData;
    } catch (error) {
      console.error('Error in fetchExchangeAllowance', error);
      dispatch(
        setExchangeFields({allowanceLoading: false, allowanceData: null}),
      );
      return thunkAPI.rejectWithValue(error?.message);
    }
  },
);

export const fetchExchangeApproveEstimationFee = createAsyncThunk(
  'exchange/fetchExchangeApproveEstimationFee',
  async (payload, thunkAPI) => {
    const dispatch = thunkAPI.dispatch;
    try {
      const currentState = thunkAPI.getState();
      const {selectedFromAsset, selectedFromWallet, amountFrom} =
        getExchange(currentState);
      const transferData = getTransferData(currentState);
      const spenderAddress = transferData?.swapData?.spender;
      const decimals = selectedFromAsset?.decimal || 18;
      const amountInWei = BigInt(
        convertToSmallAmount(amountFrom.toString(), decimals),
      );
      const allowanceData = currentState?.exchange?.allowanceData;
      const allowance = BigInt(
        convertToSmallAmount(allowanceData?.allowanceFormatted, decimals) ||
          '0',
      );
      const nativeCoin = await getNativeCoin(
        currentState,
        selectedFromAsset,
        selectedFromWallet,
      );
      if (!nativeCoin) {
        throw new Error('Failed to get native coin');
      }
      const result = await nativeCoin.getEstimateFeForAllowanceApprove({
        from: selectedFromAsset?.address,
        contractAddress: selectedFromAsset?.contractAddress,
        spenderAddress: spenderAddress,
        amountInWei,
        feesType: payload?.feesType,
        nonce: payload?.nonce,
        allowance,
        needsReset: allowanceData?.needsReset,
      });
      const finalAllowanceData = {
        ...allowanceData,
        gasFee: result.gasFee?.toString() ?? null,
        maxPriorityFeePerGas: result.maxPriorityFeePerGas?.toString() ?? null,
        feesOptions: result.feesOptions ?? null,
        estimateGas: result.estimateGas?.toString() ?? null,
        nonce: result.nonce ?? null,
        transactionFee: result.fee,
      };
      dispatch(setExchangeFields({allowanceData: finalAllowanceData}));
    } catch (error) {
      console.error('Error in fetchExchangeApproveEstimationFee', error);
      return thunkAPI.rejectWithValue(error?.message);
    }
  },
);

export const approveSwapAllowance = createAsyncThunk(
  'exchange/approveSwapAllowance',
  async (payload, thunkAPI) => {
    const dispatch = thunkAPI.dispatch;
    try {
      dispatch(setExchangeFields({approveLoading: true}));
      const currentState = thunkAPI.getState();
      const {selectedFromAsset, selectedFromWallet, amountFrom} =
        getExchange(currentState);
      const transferData = getTransferData(currentState);
      const swapData = transferData?.swapData;
      const {spender} = swapData;
      const {contractAddress, decimal, chain_name} = selectedFromAsset;
      const {type, nonce, estimateGas, gasFee, maxPriorityFeePerGas, feesType} =
        payload;
      const decimals = decimal || 18;
      const allowanceData = currentState?.exchange?.allowanceData;
      const {needsReset, allowanceFormatted} = allowanceData;
      const allowance = BigInt(
        convertToSmallAmount(allowanceFormatted, decimals) || '0',
      );
      if (!isEVMChain(chain_name)) {
        throw new Error('approveSwapAllowance only supports EVM chains');
      }
      const nativeCoin = await getNativeCoin(
        currentState,
        selectedFromAsset,
        selectedFromWallet,
      );
      if (!nativeCoin) {
        throw new Error('Failed to get native coin');
      }

      const amountInWei1 = BigInt(
        convertToSmallAmount(amountFrom.toString(), decimals),
      );

      const amountInWei =
        type === 'unlimited' ? ethers.MaxUint256 : amountInWei1;

      const result = await nativeCoin.approve({
        spenderAddress: spender,
        contractAddress: contractAddress,
        amountInWei,
        allowance,
        nonce: nonce,
        estimateGas: estimateGas,
        gasFee: gasFee,
        maxPriorityFeePerGas: maxPriorityFeePerGas,
        feesType: feesType,
        needsReset,
      });

      // The approve tx just consumed a nonce on-chain. Re-fetch the next
      // nonce from the node (same as the staking flow does after its
      // approve) instead of trusting the caller-computed nonce+1.
      await dispatch(
        calculateEstimateFee({
          isFetchNonce: true,
          fromAddress: selectedFromAsset?.address,
          toAddress: transferData?.toAddress,
          amount: amountFrom + '',
          contractAddress,
          selectedWallet: selectedFromWallet,
          selectedCoin: selectedFromAsset,
          isSwapFee: true,
        }),
      ).unwrap();

      dispatch(setExchangeFields({approveLoading: false}));
      return result;
    } catch (error) {
      console.error('Error in approveSwapAllowance', error);
      dispatch(setExchangeFields({approveLoading: false}));
      showToast({
        type: 'errorToast',
        title: error?.message || 'Approval failed',
      });
      return thunkAPI.rejectWithValue(error?.message);
    }
  },
);

export const fetchExchangePermitAllowance = createAsyncThunk(
  'exchange/fetchExchangePermitAllowance',
  async (_, thunkAPI) => {
    const dispatch = thunkAPI.dispatch;
    try {
      dispatch(setExchangeFields({permitAllowanceLoading: true}));
      const currentState = thunkAPI.getState();
      const {selectedFromAsset, selectedFromWallet, amountFrom} =
        getExchange(currentState);
      const transferData = getTransferData(currentState);
      const swapData = transferData?.swapData;
      const decimals = selectedFromAsset?.decimal || 18;
      const amountInWei = BigInt(
        convertToSmallAmount(amountFrom.toString(), decimals),
      );
      const nativeCoin = await getNativeCoin(
        currentState,
        selectedFromAsset,
        selectedFromWallet,
      );
      if (!nativeCoin) {
        throw new Error('Failed to get native coin');
      }
      const result = await nativeCoin.readPermitAllowance({
        from: selectedFromAsset?.address,
        permitAbi: swapData?.permit_abi,
        spenderAddress: swapData?.spender,
        swapTo: swapData?.to,
        contractAddress: selectedFromAsset?.contractAddress,
        amountInWei,
      });
      const permitAllowanceData = {
        permit2AmountFormatted: parseBalance(result.permit2Amount, decimals),
        requiredFormatted: parseBalance(result.required, decimals),
        amountFormatted: parseBalance(amountInWei, decimals),
        isApproved: result.isApproved,
        needsReset: result.needsReset,
        decimal: selectedFromAsset?.decimal,
        permit2Amount: result.permit2Amount,
        permit2Expiration: result.permit2Expiration,
      };
      dispatch(
        setExchangeFields({
          permitAllowanceLoading: false,
          permitAllowanceData,
        }),
      );
      return permitAllowanceData;
    } catch (error) {
      console.error('Error in fetchExchangePermitAllowance', error);
      dispatch(
        setExchangeFields({
          permitAllowanceLoading: false,
          permitAllowanceData: null,
        }),
      );
      return thunkAPI.rejectWithValue(error?.message);
    }
  },
);

export const fetchExchangePermitApproveEstimationFee = createAsyncThunk(
  'exchange/fetchExchangePermitApproveEstimationFee',
  async (payload, thunkAPI) => {
    const dispatch = thunkAPI.dispatch;
    try {
      const currentState = thunkAPI.getState();
      const {selectedFromAsset, selectedFromWallet, amountFrom} =
        getExchange(currentState);
      const transferData = getTransferData(currentState);
      const swapData = transferData?.swapData;
      const {permit_abi, to, spender} = swapData;
      const {address, contractAddress, decimal} = selectedFromAsset;
      const {nonce, feesType} = payload;
      const decimals = decimal || 18;
      const amountInWei = BigInt(
        convertToSmallAmount(amountFrom.toString(), decimals),
      );
      const permitAllowanceData = currentState?.exchange?.permitAllowanceData;
      const permit2Amount = BigInt(
        convertToSmallAmount(
          permitAllowanceData?.permit2AmountFormatted,
          decimals,
        ) || '0',
      );
      const nativeCoin = await getNativeCoin(
        currentState,
        selectedFromAsset,
        selectedFromWallet,
      );
      if (!nativeCoin) {
        throw new Error('Failed to get native coin');
      }
      const result = await nativeCoin.getEstimateFeeForPermitApprove({
        from: address,
        contractAddress: contractAddress,
        spenderAddress: spender,
        swapTo: to,
        permitAbi: permit_abi,
        amountInWei,
        feesType: feesType,
        nonce: nonce,
        permit2Amount,
      });
      const finalPermitAllowanceData = {
        ...permitAllowanceData,
        gasFee: result.gasFee?.toString() ?? null,
        maxPriorityFeePerGas: result.maxPriorityFeePerGas?.toString() ?? null,
        feesOptions: result.feesOptions ?? null,
        estimateGas: result.estimateGas?.toString() ?? null,
        nonce: result.nonce ?? null,
        transactionFee: result.fee,
      };
      dispatch(
        setExchangeFields({permitAllowanceData: finalPermitAllowanceData}),
      );
    } catch (error) {
      console.error('Error in fetchExchangePermitApproveEstimationFee', error);
      return thunkAPI.rejectWithValue(error?.message);
    }
  },
);

export const approveExchangePermit2 = createAsyncThunk(
  'exchange/approveExchangePermit2',
  async (payload, thunkAPI) => {
    const dispatch = thunkAPI.dispatch;
    try {
      dispatch(setExchangeFields({permitApproveLoading: true}));
      const currentState = thunkAPI.getState();
      const {selectedFromAsset, selectedFromWallet, amountFrom} =
        getExchange(currentState);
      const transferData = getTransferData(currentState);
      const swapData = transferData?.swapData;
      const {permit_abi, to, spender} = swapData;
      const {address, contractAddress, chain_name, decimal} = selectedFromAsset;
      const decimals = decimal || 18;
      const {type, nonce, estimateGas, gasFee, maxPriorityFeePerGas, feesType} =
        payload;
      if (!isEVMChain(chain_name)) {
        throw new Error('approveExchangePermit2 only supports EVM chains');
      }
      const nativeCoin = await getNativeCoin(
        currentState,
        selectedFromAsset,
        selectedFromWallet,
      );
      if (!nativeCoin) {
        throw new Error('Failed to get native coin');
      }

      const amountInWei1 = BigInt(
        convertToSmallAmount(amountFrom.toString(), decimals),
      );
      const amountInWei =
        type === 'unlimited'
          ? MAX_UINT160
          : amountInWei1 + (amountInWei1 * 200n) / 10000n;

      const result = await nativeCoin.approvePermit2({
        permitAbi: permit_abi,
        swapTo: to,
        from: address,
        contractAddress: contractAddress,
        spenderAddress: spender,
        amountInWei,
        nonce: nonce,
        estimateGas: estimateGas,
        gasFee: gasFee,
        maxPriorityFeePerGas: maxPriorityFeePerGas,
        feesType: feesType,
      });

      // The permit2 approve tx just consumed a nonce on-chain. Re-fetch the
      // next nonce from the node instead of trusting the caller-computed
      // nonce+1, same as approveSwapAllowance above.
      await dispatch(
        calculateEstimateFee({
          isFetchNonce: true,
          fromAddress: address,
          toAddress: transferData?.toAddress,
          amount: amountFrom + '',
          contractAddress,
          selectedWallet: selectedFromWallet,
          selectedCoin: selectedFromAsset,
          isSwapFee: true,
        }),
      ).unwrap();

      dispatch(setExchangeFields({permitApproveLoading: false}));
      return result;
    } catch (error) {
      console.error('Error in approveExchangePermit2', error);
      dispatch(setExchangeFields({permitApproveLoading: false}));
      showToast({
        type: 'errorToast',
        title: error?.message || 'Permit approval failed',
      });
      return thunkAPI.rejectWithValue(error?.message);
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
      const {selectedFromAsset, selectedFromWallet, amountFrom} =
        getExchange(currentState);
      const transferData = getTransferData(currentState);
      const {swapData, estimateGas, gasFee, maxPriorityFeePerGas, isMax} =
        transferData;
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
      const res = await nativeCoin.swap({
        swapData: swapData,
        estimateGas: estimateGas,
        gasFee: gasFee,
        maxPriorityFeePerGas: maxPriorityFeePerGas,
        isMax: isMax,
        nonce: txData?.nonce ?? transferData?.nonce,
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
          thunkAPI.dispatch(refreshCoins());
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
