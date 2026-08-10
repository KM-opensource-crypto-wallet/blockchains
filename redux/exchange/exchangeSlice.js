import {createAsyncThunk, createSlice} from '@reduxjs/toolkit';
import {getExchange} from 'dok-wallet-blockchain-networks/redux/exchange/exchangeSelectors';
import {
  calculateEstimateFee,
  setCurrentTransferData,
} from 'dok-wallet-blockchain-networks/redux/currentTransfer/currentTransferSlice';
import {getChain} from 'dok-wallet-blockchain-networks/cryptoChain';
import {
  isEVMChain,
  isNameSupportChain,
  convertToSmallAmount,
  parseBalance,
} from 'dok-wallet-blockchain-networks/helper';
import {applyApproveGasPrice} from 'dok-wallet-blockchain-networks/helper/approveFees';
import {buildExchangePairKey} from 'dok-wallet-blockchain-networks/helper/exchangeHelpers';
import {showToast} from 'utils/toast';
import {
  createExchange,
  getExchangeQuote,
} from 'dok-wallet-blockchain-networks/service/dokApi';
import BigNumber from 'bignumber.js';
import {selectCustomRpcUrlByChainAndWallet} from 'dok-wallet-blockchain-networks/redux/customRpc/customRpcSelectors';
import {getNativeCoin} from 'dok-wallet-blockchain-networks/service/wallet.service';
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
  // The provider quote object's extraData, echoed back to /create-exchange.
  extraData: null,
  // Per-pair provider minimums: {[pairKey]: {providers: [], fetchedAt: ms}}.
  providerMinimums: {},
  // requestId of the latest quote/minimum thunk; only that request's result
  // is allowed to commit, so a slow stale response can never overwrite a
  // newer one.
  quoteRequestId: null,
  isQuoteFetching: false,
  quoteError: null,
  quoteFetchedAt: null,
  // The amount the current quotes/selection were fetched for. While it
  // differs from amountFrom (typing inside the debounce window) the shown
  // quote is stale and the CTA must stay disabled.
  lastQuotedAmount: null,
  // True after the user taps a provider row; keeps their choice across quote
  // refreshes instead of snapping back to the best rate.
  isProviderManuallySelected: false,
  allowanceData: null,
  allowanceLoading: false,
  approveLoading: false,
  permitAllowanceData: null,
  permitAllowanceLoading: false,
  permitApproveLoading: false,
};

// Client-side freshness for the per-pair minimums (the backend additionally
// caches CEX minimums in Redis for an hour).
const PAIR_MINIMUMS_TTL_MS = 5 * 60 * 1000;

const buildQuoteBasePayload = (
  selectedFromAsset,
  selectedToAsset,
  slippage,
) => ({
  coinFrom: selectedFromAsset?.symbol,
  coinTo: selectedToAsset?.symbol,
  networkFrom: selectedFromAsset?.chain_symbol,
  networkTo: selectedToAsset?.chain_symbol,
  rateType: 'fixed',
  fromChainName: selectedFromAsset?.chain_name,
  toChainName: selectedToAsset?.chain_name,
  fromContractAddress: selectedFromAsset?.contractAddress,
  toContractAddress: selectedToAsset?.contractAddress,
  // Authoritative token decimals — the DEX adapters otherwise depend on a
  // hardcoded per-address map and refuse to quote unmapped tokens.
  fromDecimals: selectedFromAsset?.decimal,
  toDecimals: selectedToAsset?.decimal,
  fromAddress: selectedFromAsset?.address,
  slippage: slippage ? Number(slippage) : undefined,
});

// Fetches every provider's minimum (and a reference quote at that minimum)
// for the currently selected pair. Amount-specific quotes come from
// fetchExchangeQuotes; this one only refreshes when the cached entry is
// older than PAIR_MINIMUMS_TTL_MS.
export const fetchPairMinimums = createAsyncThunk(
  'exchange/fetchPairMinimums',
  async (_, thunkAPI) => {
    const {selectedFromAsset, selectedToAsset, slippage, providerMinimums} =
      getExchange(thunkAPI.getState());
    const pairKey = buildExchangePairKey(selectedFromAsset, selectedToAsset);
    const cached = providerMinimums?.[pairKey];
    if (
      cached?.providers?.length &&
      Date.now() - cached.fetchedAt < PAIR_MINIMUMS_TTL_MS
    ) {
      return {
        pairKey,
        providers: cached.providers,
        fetchedAt: cached.fetchedAt,
      };
    }
    const payload = {
      ...buildQuoteBasePayload(selectedFromAsset, selectedToAsset, slippage),
      amount: null,
      isFetchMinimum: true,
    };
    const resp = await getExchangeQuote(payload);
    const providers = Array.isArray(resp?.data) ? resp.data : [];
    return {pairKey, providers, fetchedAt: Date.now()};
  },
  {
    condition: (_, {getState}) => {
      const {selectedFromAsset, selectedToAsset} = getExchange(getState());
      return !!buildExchangePairKey(selectedFromAsset, selectedToAsset);
    },
  },
);

// Fetches quotes from all providers at the given amount. Latest-wins: the
// pending reducer stamps quoteRequestId and fulfilled/rejected only commit
// when their requestId still matches, so rapid typing can't surface a stale
// response.
export const fetchExchangeQuotes = createAsyncThunk(
  'exchange/fetchExchangeQuotes',
  async ({amount}, thunkAPI) => {
    const {selectedFromAsset, selectedToAsset, slippage} = getExchange(
      thunkAPI.getState(),
    );
    const payload = {
      ...buildQuoteBasePayload(selectedFromAsset, selectedToAsset, slippage),
      amount: amount?.toString() || '1',
    };
    const resp = await getExchangeQuote(payload);
    const providers = Array.isArray(resp?.data) ? resp.data : [];
    return {providers, fetchedAt: Date.now()};
  },
  {
    condition: ({amount} = {}, {getState}) => {
      const {selectedFromAsset, selectedToAsset} = getExchange(getState());
      const amountBN = new BigNumber(amount ?? NaN);
      return (
        !!buildExchangePairKey(selectedFromAsset, selectedToAsset) &&
        amountBN.isFinite() &&
        amountBN.gt(0)
      );
    },
  },
);

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
        fromDecimals: selectedFromAsset?.decimal,
        toDecimals: selectedToAsset?.decimal,
        // String, not Number: the DEX adapters convert human-decimal strings
        // to smallest units and a Number can drop into exponent notation.
        amount: amountFrom?.toString(),
        rateType: 'fixed',
        withdrawalAddress: finalCustomAddress || selectedToAsset?.address,
        validName,
        refundAddress: selectedFromAsset?.address,
        extraData,
        providerName: selectedExchangeChain?.providerName,
        slippage: slippage ? Number(slippage) : undefined,
        // Ties the backend history record to this wallet's swap history.
        walletClientId: selectedFromWallet?.clientId,
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
              // Null it out explicitly: a deposit-address provider must not
              // inherit calldata left behind by a previous DEX quote.
              swapData: data?.swapData || null,
              // Explicit null so a stale history id never survives a re-quote.
              exchangeHistoryId: data?.historyId || null,
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
              isExchange: true,
            }),
          ).unwrap();
        }
        dispatch(setExchangeSuccess(true));
        // Returned so callers can branch on this quote rather than on a
        // useSelector value captured before the quote was fetched.
        return data;
      } else {
        dispatch(setExchangeSuccess(false));
        return thunkAPI.rejectWithValue('Failed to create the exchange');
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
      const {spender} = swapData || {};
      const {address, contractAddress, decimal} = selectedFromAsset;
      const decimals = decimal || 18;
      // No spender means the provider gave a deposit address rather than swap
      // calldata, so this is a plain transfer with nothing to approve.
      if (!spender) {
        dispatch(
          setExchangeFields({allowanceLoading: false, allowanceData: null}),
        );
        return {isApproved: true};
      }
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
      // This reads the plain ERC20 allowance for `spender`. The router-level
      // (Permit2) allowance is a separate concern handled by
      // fetchExchangePermitAllowance / readPermitAllowance.
      const result = await nativeCoin.readAllowance({
        from: address,
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
      const {spender} = swapData || {};
      const {contractAddress, decimal, chain_name} = selectedFromAsset;
      const {type, nonce, estimateGas, gasFee, maxPriorityFeePerGas, feesType} =
        payload;
      const decimals = decimal || 18;
      const allowanceData = currentState?.exchange?.allowanceData;
      const {needsReset, allowanceFormatted} = allowanceData || {};
      if (!spender) {
        throw new Error('No spender to approve for this exchange provider');
      }
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
          isExchange: true,
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
      // Manual approves the exact swap amount, matching the ERC20 path and what
      // the sheet promises the user. An exact-input swap pulls exactly the
      // quoted amount, so headroom here would only over-approve.
      const amountInWei = type === 'unlimited' ? MAX_UINT160 : amountInWei1;

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
          isExchange: true,
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
    // Recompute the approval fee shown on the allowance sheet from a custom gas
    // price. `target` selects which approval this applies to, since the ERC20 and
    // permit2 approvals each have their own fee.
    updateExchangeApproveFees(state, {payload}) {
      const target =
        payload?.target === 'permit' ? 'permitAllowanceData' : 'allowanceData';
      applyApproveGasPrice(state[target], payload);
    },
  },
  extraReducers: builder => {
    builder
      .addCase(fetchPairMinimums.pending, (state, action) => {
        // A pair change also invalidates any in-flight amount quote.
        state.quoteRequestId = action.meta.requestId;
        state.isQuoteFetching = true;
        state.quoteError = null;
        state.availableProviders = [];
        state.amountTo = '';
        state.selectedExchangeChain = null;
        state.extraData = null;
        state.quoteFetchedAt = null;
        state.isProviderManuallySelected = false;
      })
      .addCase(fetchPairMinimums.fulfilled, (state, action) => {
        const {pairKey, providers, fetchedAt} = action.payload || {};
        if (pairKey) {
          state.providerMinimums[pairKey] = {providers, fetchedAt};
        }
        if (state.quoteRequestId === action.meta.requestId) {
          state.isQuoteFetching = false;
        }
      })
      .addCase(fetchPairMinimums.rejected, (state, action) => {
        if (state.quoteRequestId !== action.meta.requestId) {
          return;
        }
        state.isQuoteFetching = false;
        state.quoteError =
          action.error?.message || 'Failed to fetch providers for this pair';
      })
      .addCase(fetchExchangeQuotes.pending, (state, action) => {
        state.quoteRequestId = action.meta.requestId;
        state.isQuoteFetching = true;
        state.quoteError = null;
      })
      .addCase(fetchExchangeQuotes.fulfilled, (state, action) => {
        if (state.quoteRequestId !== action.meta.requestId) {
          return;
        }
        state.isQuoteFetching = false;
        // The user changed or cleared the amount after this request left
        // (clearing dispatches nothing, so the requestId guard alone can't
        // catch it) — don't surface a quote for an amount no longer shown.
        if (state.amountFrom !== action.meta.arg?.amount) {
          return;
        }
        const {providers, fetchedAt} = action.payload;
        state.quoteError = null;
        state.lastQuotedAmount = action.meta.arg?.amount ?? null;
        state.availableProviders = providers;
        state.quoteFetchedAt = fetchedAt;

        // Some providers still quote below their own minimum; such a quote
        // must never be auto-selected or the CTA would immediately reject it.
        const requestedBN = new BigNumber(action.meta.arg?.amount ?? NaN);
        const clearsMinimum = item => {
          const minBN = new BigNumber(item?.minAmount ?? NaN);
          return (
            !minBN.isFinite() ||
            !requestedBN.isFinite() ||
            minBN.lte(requestedBN)
          );
        };

        let selected = null;
        if (
          state.isProviderManuallySelected &&
          state.selectedExchangeChain?.providerName
        ) {
          selected = providers.find(
            item =>
              item?.providerName ===
                state.selectedExchangeChain?.providerName &&
              item?.toAmount &&
              clearsMinimum(item),
          );
        }
        if (!selected) {
          state.isProviderManuallySelected = false;
          let bestBN = null;
          for (let i = 0; i < providers.length; i++) {
            if (!clearsMinimum(providers[i])) {
              continue;
            }
            const toAmountBN = new BigNumber(providers[i]?.toAmount ?? NaN);
            if (
              toAmountBN.isFinite() &&
              toAmountBN.gt(0) &&
              (bestBN === null || toAmountBN.gt(bestBN))
            ) {
              bestBN = toAmountBN;
              selected = providers[i];
            }
          }
        }
        if (selected?.toAmount) {
          state.selectedExchangeChain = selected;
          state.extraData = selected?.extraData;
          state.amountTo = selected.toAmount + '';
        } else {
          state.selectedExchangeChain = null;
          state.extraData = null;
          state.amountTo = '0';
        }
      })
      .addCase(fetchExchangeQuotes.rejected, (state, action) => {
        if (state.quoteRequestId !== action.meta.requestId) {
          return;
        }
        state.isQuoteFetching = false;
        state.quoteError = action.error?.message || 'Failed to fetch quotes';
      });
  },
});

export const {
  resetExchangeFields,
  setExchangeFields,
  setExchangeLoading,
  setExchangeSuccess,
  updateExchangeApproveFees,
} = exchangeSlice.actions;
