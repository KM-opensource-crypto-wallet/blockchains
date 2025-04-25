import {createAsyncThunk, createSlice} from '@reduxjs/toolkit';
import {getTransferData} from 'dok-wallet-blockchain-networks/redux/currentTransfer/currentTransferSelector';
import {getNativeCoin} from 'dok-wallet-blockchain-networks/service/wallet.service';
import {
  selectCurrentCoin,
  selectCurrentWallet,
  selectUserCoins,
} from 'dok-wallet-blockchain-networks/redux/wallets/walletsSelector';
import BigNumber from 'bignumber.js';
import {showToast} from 'utils/toast';
import {ethers} from 'ethers';
import {
  getAdditionalL1Fee,
  getBitcoinCashFeeMultiplier,
  getBitcoinFeeMultiplier,
  getDogecoinFeeMultiplier,
  getLitecoinFeeMultiplier,
} from 'dok-wallet-blockchain-networks/redux/cryptoProviders/cryptoProvidersSelectors';
import {parseBalance} from 'dok-wallet-blockchain-networks/helper';

const initialUpdateTransactionData = {
  isLoading: false,
  success: false,
  transactionData: null,
  transactionFee: 0,
  fiatEstimateFee: 0,
  error: '',
  isSubmitting: false,
};

const initialState = {
  transferData: {
    isLoading: false,
    success: false,
    isRefreshing: false,
    isSubmitting: false,
    currentCoin: null,
    selectedNFT: null,
    isSendFunds: false,
    initialAmount: 0,
    amount: 0,
    toAddress: '',
    transactionFee: 0,
    fiatEstimateFee: 0,
    feesOptions: [],
    l1Fees: 0,
    currencyRate: 0,
    estimateGas: null,
    gasFee: null,
    maxPriorityFeePerGas: null,
    isMax: false,
    customError: '',
    selectedUTXOsValue: undefined,
    selectedUTXOs: undefined,
  },
  pendingTransferData: {
    isLoading: false,
    success: false,
    transactionFee: 0,
    fiatEstimateFee: 0,
    error: '',
    isSubmitting: false,
  },
  updateTransactionData: initialUpdateTransactionData,
};

export const calculateEstimateFee = createAsyncThunk(
  'currentTransfer/calculateEstimateFee',
  async (payload, thunkAPI) => {
    const dispatch = thunkAPI.dispatch;
    try {
      dispatch(setCurrentTransferLoading(true));
      const currentState = thunkAPI.getState();
      const transfer = getTransferData(currentState);
      const currentCoin = selectCurrentCoin(currentState);
      const chain_name = currentCoin?.chain_name;
      const bitcoinFeeMultiplier = getBitcoinFeeMultiplier(currentState);
      const litecoinFeeMultiplier = getLitecoinFeeMultiplier(currentState);
      const dogecoinFeeMultiplier = getDogecoinFeeMultiplier(currentState);
      const additionalL1Fee = getAdditionalL1Fee(currentState);
      const bitcoinCashFeeMultiplier =
        getBitcoinCashFeeMultiplier(currentState);
      const selectedWallet = payload?.selectedWallet;
      const selectedCoin = payload?.selectedCoin;

      const multiplier = {
        bitcoin: bitcoinFeeMultiplier,
        bitcoin_legacy: bitcoinFeeMultiplier,
        bitcoin_segwit: bitcoinFeeMultiplier,
        litecoin: litecoinFeeMultiplier,
        dogecoin: dogecoinFeeMultiplier,
        bitcoin_cash: bitcoinCashFeeMultiplier,
      };

      const nativeCoin = await getNativeCoin(
        currentState,
        selectedCoin,
        selectedWallet,
      );
      if (!nativeCoin) {
        return null;
      }

      let respData;
      if (payload?.isNFT) {
        respData = await nativeCoin?.getNFTEstimateFee({
          ...payload,
          additionalL1Fee: additionalL1Fee[chain_name],
        });
      } else if (payload?.isCreateStaking) {
        respData = await nativeCoin?.getEstimateFeeForStaking(payload);
      } else if (payload?.isCreateVote) {
        respData = await nativeCoin?.estimateFeesForStakeValidators(payload);
      } else if (payload?.isDeactivateStaking) {
        respData = await nativeCoin?.getEstimateFeeForDeactivateStaking(
          payload,
        );
      } else if (payload?.isWithdrawStaking) {
        respData = await nativeCoin?.getEstimateFeeForWithdrawStaking(payload);
      } else if (payload?.isStakingRewards) {
        respData = await nativeCoin?.getEstimateFeeForStakingRewards(payload);
      } else {
        respData = await nativeCoin?.getEstimateFee({
          selectedUTXOs: transfer?.selectedUTXOs,
          ...payload,
          feeMultiplier: multiplier[chain_name],
          additionalL1Fee: additionalL1Fee[chain_name],
        });
      }
      const estimateGas = respData?.estimateGas;
      const gasFee = respData?.gasFee;
      const maxPriorityFeePerGas = respData?.maxPriorityFeePerGas;
      const fee = respData?.fee;
      const feesOptions = respData?.feesOptions;
      const l1Fees = respData?.l1Fees || 0;
      const allUserCoins = selectUserCoins(currentState);
      const foundCoin = allUserCoins.find(
        item =>
          item?.symbol === transfer?.currentCoin?.chain_symbol &&
          item?.chain_name === transfer?.currentCoin?.chain_name,
      );
      const currencyRate = foundCoin?.currencyRate || '0';
      const currencyRateBN = new BigNumber(currencyRate);
      const feeAmountBN = new BigNumber(fee);
      const finalFeesOptions = Array.isArray(feesOptions)
        ? feesOptions?.map(item => {
            const etherAmount = new BigNumber(item.gasPrice).dividedBy(
              new BigNumber(1000000000),
            );
            return {
              ...item,
              fiatGasPrice: etherAmount.multipliedBy(currencyRateBN).toFixed(2),
            };
          })
        : [];
      dispatch(
        setEstimateFees({
          transactionFee: fee,
          fiatEstimateFee: feeAmountBN.multipliedBy(currencyRateBN).toString(),
          gasFee,
          estimateGas,
          maxPriorityFeePerGas,
          feesOptions: finalFeesOptions,
          l1Fees,
          currencyRate,
        }),
      );
      if (
        !payload?.isNFT &&
        !payload.isWithdrawStaking &&
        !payload.isDeactivateStaking &&
        !payload.isCreateVote
      ) {
        const transferAmountBN = new BigNumber(transfer?.amount);
        const totalAmountBN = transferAmountBN.plus(feeAmountBN);
        const selectedUTXOsValue = transfer?.selectedUTXOsValue;
        const balanceBN = new BigNumber(
          selectedUTXOsValue || transfer?.currentCoin?.totalAmount,
        );
        const initialAmountBN = new BigNumber(transfer?.initialAmount);
        if (
          transfer?.currentCoin?.type !== 'token' &&
          (totalAmountBN.gt(balanceBN) ||
            (transfer?.isSendFunds && !initialAmountBN.eq(transferAmountBN)))
        ) {
          dispatch(
            setCurrentTransferData({
              amount: balanceBN.minus(feeAmountBN).toString(),
              isMax: true,
            }),
          );
        } else {
          dispatch(
            setCurrentTransferData({
              isMax: false,
            }),
          );
        }
      }
      dispatch(setCurrentTransferSuccess(true));
      return true;
    } catch (e) {
      dispatch(setCurrentTransferSuccess(false));
      console.error('Error in calculateEstimateFee', e);
      if (e?.message?.startsWith('The')) {
        dispatch(setCurrentTransferCustomError(e?.message));
      }
      if (e?.message === 'polkadot_receiver_should_1_dot') {
        showToast({
          type: 'errorToast',
          title: 'Polkadot warning',
          message: 'Receiver address should have minimum 1 DOT',
        });
      }
    }
  },
);

export const calculateEstimateFeeForPendingTransaction = createAsyncThunk(
  'currentTransfer/calculateEstimateFeeForPendingTransaction',
  async (payload, thunkAPI) => {
    const dispatch = thunkAPI.dispatch;
    try {
      dispatch(setPendingTransferLoading(true));
      const currentState = thunkAPI.getState();
      const selectedWallet = selectCurrentWallet(currentState);
      const selectedCoin = selectCurrentCoin(currentState);
      const nativeCoin = await getNativeCoin(
        currentState,
        selectedCoin,
        selectedWallet,
      );
      if (!nativeCoin) {
        return null;
      }

      const respData = await nativeCoin?.getEstimateFeeForPendingTransaction(
        payload,
      );
      const fee = respData?.fee;
      const allUserCoins = selectUserCoins(currentState);
      const foundCoin = allUserCoins.find(
        item =>
          item?.symbol === selectedCoin?.chain_symbol &&
          item?.chain_name === selectedCoin?.chain_name,
      );
      const currencyRate = foundCoin?.currencyRate || '0';
      const currencyRateBN = new BigNumber(currencyRate);
      const feeAmountBN = new BigNumber(fee);

      dispatch(
        setPendingTransferData({
          transactionFee: fee,
          fiatEstimateFee: feeAmountBN.multipliedBy(currencyRateBN).toFixed(2),
          isLoading: false,
          error: null,
          success: true,
        }),
      );
    } catch (e) {
      dispatch(
        setPendingTransferData({
          success: false,
          isLoading: false,
          error: e?.message,
          transactionFee: 0,
          fiatEstimateFee: 0,
        }),
      );
      console.error('Error in calculateEstimateFeeForPendingTransaction', e);
    }
  },
);

export const fetchTransactionData = createAsyncThunk(
  'currentTransfer/fetchTransactionData',
  async (payload, thunkAPI) => {
    const dispatch = thunkAPI.dispatch;
    try {
      dispatch(setUpdateTransactionLoading(true));
      const currentState = thunkAPI.getState();
      const selectedWallet = selectCurrentWallet(currentState);
      const selectedCoin = selectCurrentCoin(currentState);
      const nativeCoin = await getNativeCoin(
        currentState,
        selectedCoin,
        selectedWallet,
      );
      if (!nativeCoin) {
        return null;
      }
      const tx = await nativeCoin?.getTransactionForUpdate(payload);
      const txPayload = {
        fromAddress: tx?.extraPendingTransactionData?.from,
        toAddress: tx?.extraPendingTransactionData?.from,
        value: tx?.extraPendingTransactionData?.value,
        data: tx?.extraPendingTransactionData?.data,
        nonce: tx?.extraPendingTransactionData?.nonce,
      };
      const respData = await nativeCoin?.getEstimateFeeForPendingTransaction(
        txPayload,
      );
      const fee = respData?.fee;
      const allUserCoins = selectUserCoins(currentState);
      const foundCoin = allUserCoins.find(
        item =>
          item?.symbol === selectedCoin?.chain_symbol &&
          item?.chain_name === selectedCoin?.chain_name,
      );
      const currencyRate = foundCoin?.currencyRate || '0';
      const currencyRateBN = new BigNumber(currencyRate);
      const feeAmountBN = new BigNumber(fee);

      dispatch(
        setUpdateTransactionData({
          transactionData: tx,
          transactionFee: fee,
          fiatEstimateFee: feeAmountBN.multipliedBy(currencyRateBN).toFixed(2),
          isLoading: false,
          error: null,
          success: true,
        }),
      );
    } catch (e) {
      dispatch(
        setUpdateTransactionData({
          transactionData: null,
          success: false,
          isLoading: false,
          error: e?.message,
          transactionFee: 0,
          fiatEstimateFee: 0,
        }),
      );
      console.error('Error in fetchTransactionData', e);
      showToast({
        type: 'errorToast',
        title: 'Error',
        message: e?.message,
      });
    }
  },
);

export const currentTransferSlice = createSlice({
  name: 'currentTransfer',
  initialState,
  reducers: {
    setCurrentTransferData(state, {payload}) {
      state.transferData = {...state.transferData, ...payload};
    },
    clearSelectedUTXOs(state) {
      state.transferData.selectedUTXOsValue = undefined;
      state.transferData.selectedUTXOs = undefined;
    },
    resetCurrentTransferData() {
      return initialState;
    },
    setCurrentTransferLoading(state, {payload}) {
      state.transferData.isLoading = payload;
      state.transferData.success = false;
    },
    setCurrentTransferSuccess(state, {payload}) {
      state.transferData.isLoading = false;
      state.transferData.success = payload;
      if (payload) {
        state.transferData.customError = '';
      }
    },
    setCurrentTransferRefreshing(state, {payload}) {
      state.transferData.isRefreshing = payload;
    },
    setCurrentTransferSubmitting(state, {payload}) {
      state.transferData.isSubmitting = payload;
    },
    setEstimateFees(state, {payload}) {
      state.transferData.transactionFee = payload?.transactionFee;
      state.transferData.isLoading = false;
      state.transferData.fiatEstimateFee = payload?.fiatEstimateFee;
      state.transferData.estimateGas = payload?.estimateGas;
      state.transferData.gasFee = payload?.gasFee;
      state.transferData.feesOptions = payload?.feesOptions;
      state.transferData.currencyRate = payload?.currencyRate;
      state.transferData.maxPriorityFeePerGas = payload?.maxPriorityFeePerGas;
      state.transferData.l1Fees = payload?.l1Fees;
    },
    setCurrentTransferAmount(state, {payload}) {
      state.transferData.amount = payload;
    },
    setCurrentTransferCustomError(state, {payload}) {
      state.transferData.customError = payload;
    },
    updateFees(state, {payload}) {
      const gasPrice = payload?.gasPrice;
      const l1Fees = state.transferData?.l1Fees;
      if (!gasPrice) {
        console.error('Gas price not provided');
        return;
      }
      const isEVM = payload?.convertedChainName === 'ethereum';
      const gasPriceBN = new BigNumber(
        isEVM
          ? ethers.parseUnits(gasPrice?.toString(), 9)?.toString()
          : gasPrice?.toString(),
      );
      const estimateGasBN = new BigNumber(state.transferData.estimateGas);
      const l1FeesBn = new BigNumber(l1Fees || 0);
      const transactionFeeBN = gasPriceBN
        .multipliedBy(estimateGasBN)
        .plus(l1FeesBn);
      const transactionFee = parseBalance(
        transactionFeeBN?.toString(),
        isEVM ? 18 : 8,
      );

      const transactionFeeEtherBN = new BigNumber(transactionFee);
      const currencyBN = new BigNumber(state?.transferData?.currencyRate);
      state.transferData.gasFee = BigInt(gasPriceBN.toString());
      state.transferData.transactionFee = transactionFee;
      state.transferData.fiatEstimateFee = currencyBN
        .multipliedBy(transactionFeeEtherBN)
        .toFixed(2);
      const currentCoin = state.transferData.currentCoin;
      const selectedUTXOsValue = state.transferData?.selectedUTXOsValue;
      const balanceBN = new BigNumber(
        selectedUTXOsValue || currentCoin.totalAmount || 0,
      );
      const initialAmount = new BigNumber(
        state.transferData?.initialAmount || 0,
      );
      const amountBN = new BigNumber(state.transferData?.amount || 0);
      const isSendFunds = state.transferData?.isSendFunds;
      const totalAmount = amountBN.plus(transactionFeeEtherBN);
      if (
        (totalAmount.gt(balanceBN) ||
          (!initialAmount.eq(amountBN) && isSendFunds)) &&
        currentCoin?.type !== 'token'
      ) {
        state.transferData.amount = balanceBN
          .minus(transactionFeeEtherBN)
          .toString();
        state.transferData.isMax = true;
      } else {
        state.transferData.isMax = false;
      }
    },
    setPendingTransferLoading(state, {payload}) {
      state.pendingTransferData.isLoading = payload;
    },
    setPendingTransferSubmitting(state, {payload}) {
      state.pendingTransferData.isSubmitting = payload;
    },
    setPendingTransferData(state, {payload}) {
      state.pendingTransferData = {...state.pendingTransferData, ...payload};
    },
    setUpdateTransactionLoading(state, {payload}) {
      state.updateTransactionData.isLoading = payload;
    },
    setUpdateTransactionSubmitting(state, {payload}) {
      state.updateTransactionData.isSubmitting = payload;
    },
    setUpdateTransactionData(state, {payload}) {
      state.updateTransactionData = {...state.pendingTransferData, ...payload};
    },
    resetUpdateTransactionData(state) {
      state.updateTransactionData = initialUpdateTransactionData;
    },
  },
});

export const {
  setCurrentTransferData,
  clearSelectedUTXOs,
  resetCurrentTransferData,
  setCurrentTransferLoading,
  setCurrentTransferRefreshing,
  setCurrentTransferSubmitting,
  setEstimateFees,
  setCurrentTransferAmount,
  setCurrentTransferSuccess,
  setCurrentTransferCustomError,
  updateFees,
  setPendingTransferData,
  setPendingTransferLoading,
  setPendingTransferSubmitting,
  setUpdateTransactionData,
  setUpdateTransactionLoading,
  setUpdateTransactionSubmitting,
  resetUpdateTransactionData,
} = currentTransferSlice.actions;
