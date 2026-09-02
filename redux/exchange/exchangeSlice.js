import {createAsyncThunk, createSlice} from '@reduxjs/toolkit';
import {getExchange} from 'dok-wallet-blockchain-networks/redux/exchange/exchangeSelectors';
import {
  calculateEstimateFee,
  updateCurrentTransferData,
} from 'dok-wallet-blockchain-networks/redux/currentTransfer/currentTransferSlice';
import {getChain} from 'dok-wallet-blockchain-networks/cryptoChain';
import {
  isEVMChain,
  isSwapApprovalChain,
  isNameSupportChain,
  convertToSmallAmount,
  parseBalance,
  validateNumber,
  isHederaUnactivated,
  getHederaLedgerAddress,
  HEDERA_UNACTIVATED_MESSAGE,
} from 'dok-wallet-blockchain-networks/helper';
import {applyApproveGasPrice} from 'dok-wallet-blockchain-networks/helper/approveFees';
import {
  buildExchangePairKey,
  collectFromAddresses,
} from 'dok-wallet-blockchain-networks/helper/exchangeHelpers';
import {showToast} from 'utils/toast';
import {
  createExchange,
  getExchangeQuote,
} from 'dok-wallet-blockchain-networks/service/dokApi';
import BigNumber from 'bignumber.js';
import {selectCustomRpcUrlByChainAndWallet} from 'dok-wallet-blockchain-networks/redux/customRpc/customRpcSelectors';
import {getNativeCoin} from 'dok-wallet-blockchain-networks/service/wallet.service';
import {refreshCurrentCoin} from 'dok-wallet-blockchain-networks/redux/wallets/walletsSlice';
import {getTransferData} from 'dok-wallet-blockchain-networks/redux/currentTransfer/currentTransferSelector';
import {ethers} from 'ethers';

// Permit2's IAllowanceTransfer.approve(token, spender, uint160 amount, uint48 expiration)
// caps amount at uint160 max, so "unlimited" must use that ceiling on the permit2
// path instead of ethers.MaxUint256 (uint256 max), which would overflow that call.
const MAX_UINT160 = 2n ** 160n - 1n;

// A Hedera wallet carries its EVM address until the first deposit creates the
// account; CEX providers only accept `0.0.N`, so swaps wait for activation.
const assertHederaActivated = (...assets) => {
  if (assets.some(isHederaUnactivated)) {
    showToast({
      type: 'errorToast',
      title: 'Hedera account not active',
      message: HEDERA_UNACTIVATED_MESSAGE,
    });
    throw new Error(HEDERA_UNACTIVATED_MESSAGE);
  }
};

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
  // True while the selected from-asset's live balance is being fetched.
  fromBalanceLoading: false,
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
  rateType: 'fixed',
  // Chain names are the only network identifiers sent — symbols are ambiguous
  // (ethereum/arbitrum/base all use ETH); the backend maps chain_name to each
  // provider's own network code.
  fromChainName: selectedFromAsset?.chain_name,
  toChainName: selectedToAsset?.chain_name,
  fromContractAddress: selectedFromAsset?.contractAddress,
  toContractAddress: selectedToAsset?.contractAddress,
  // Authoritative token decimals — the DEX adapters otherwise depend on a
  // hardcoded per-address map and refuse to quote unmapped tokens.
  fromDecimals: selectedFromAsset?.decimal,
  toDecimals: selectedToAsset?.decimal,
  // Hedera hands providers its `0.0.N` account id, not the EVM address.
  fromAddress: getHederaLedgerAddress(selectedFromAsset),
  // BTC only: every funded derive address, so LI.FI can gather UTXOs across
  // the HD wallet's change addresses instead of just the primary address.
  // undefined for every other chain.
  fromAddresses: collectFromAddresses(selectedFromAsset),
  // DEX quotes bake the recipient into the calldata; quote for the real
  // destination wallet so cross-VM routes price (and execute) correctly. A
  // custom address is only validated at submit — the backend re-quotes there
  // if the recipient changed.
  withdrawalAddress: getHederaLedgerAddress(selectedToAsset),
  slippage: slippage ? Number(slippage) : undefined,
  // This app version can attach OP_RETURN memos to bitcoin sends — the
  // backend only offers BTC-origin routes that need a memo (LI.FI's shared
  // vault) to payloads carrying this flag, so older apps never receive a
  // deposit they would execute memo-less.
  supportsBtcMemo: true,
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
    assertHederaActivated(selectedFromAsset, selectedToAsset);
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

// The state every allowance/approve/estimate thunk starts from. One place
// instead of six copies of the same destructuring preamble.
const getExchangeContext = state => {
  const {selectedFromAsset, selectedFromWallet, amountFrom} =
    getExchange(state);
  const transferData = getTransferData(state);
  return {
    selectedFromAsset,
    selectedFromWallet,
    amountFrom,
    transferData,
    swapData: transferData?.swapData,
    decimals: selectedFromAsset?.decimal || 18,
  };
};

const toAmountInWei = (amountFrom, decimals) =>
  BigInt(convertToSmallAmount(amountFrom.toString(), decimals));

const getNativeCoinOrThrow = async (state, asset, wallet) => {
  const nativeCoin = await getNativeCoin(state, asset, wallet);
  if (!nativeCoin) {
    throw new Error('Failed to get native coin');
  }
  return nativeCoin;
};

// The fee fields both approval sheets merge into their sheet data after an
// approve-fee estimation. BigInts stringified for the redux store.
const buildApproveFeeFields = result => ({
  gasFee: result.gasFee?.toString() ?? null,
  maxPriorityFeePerGas: result.maxPriorityFeePerGas?.toString() ?? null,
  feesOptions: result.feesOptions ?? null,
  estimateGas: result.estimateGas?.toString() ?? null,
  nonce: result.nonce ?? null,
  transactionFee: result.fee,
});

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
      assertHederaActivated(selectedFromAsset, selectedToAsset);
      const payload = {
        ...buildQuoteBasePayload(selectedFromAsset, selectedToAsset, slippage),
        // String, not Number: the DEX adapters convert human-decimal strings
        // to smallest units and a Number can drop into exponent notation.
        amount: amountFrom?.toString(),
        // Base payload quotes for the destination wallet; the create must
        // honour a validated custom address instead.
        withdrawalAddress:
          finalCustomAddress || getHederaLedgerAddress(selectedToAsset),
        validName,
        refundAddress: getHederaLedgerAddress(selectedFromAsset),
        extraData,
        providerName: selectedExchangeChain?.providerName,
        // Ties the backend history record to this wallet's swap history.
        walletClientId: selectedFromWallet?.clientId,
      };
      const resp = await createExchange(payload);
      if (resp?.status === 201 || resp?.status === 200) {
        const data = resp?.data;
        if (data) {
          // The provider may echo the amounts back as numbers, or omit them
          // entirely. Coerce through BigNumber (a Number would round-trip
          // into exponent notation for small values) and fall back to the
          // user-entered amount — `undefined + ''` would otherwise write the
          // literal string 'undefined' into amountFrom AND
          // transferData.amount, which the fee estimate and send would then
          // try to convert to wei. The type check matters: validateNumber
          // coerces null/''/true to numbers, and BigNumber would then write
          // 'NaN'/'1' — only real string/number amounts are usable.
          const isUsableAmount = value =>
            (typeof value === 'string' || typeof value === 'number') &&
            value !== '' &&
            validateNumber(value) !== null;
          const finalAmount = isUsableAmount(data?.amount)
            ? new BigNumber(data.amount).toFixed()
            : amountFrom;
          const finalAmountTo = isUsableAmount(data?.amountTo)
            ? new BigNumber(data.amountTo).toFixed()
            : '';
          dispatch(
            setExchangeFields({
              amountFrom: finalAmount,
              amountTo: finalAmountTo,
              exchangeToName: validName,
              exchangeToAddress: finalCustomAddress || selectedToAsset?.address,
            }),
          );
          dispatch(
            updateCurrentTransferData({
              toAddress: data?.depositAddress,
              // Null it out explicitly: a deposit-address provider must not
              // inherit calldata left behind by a previous DEX quote.
              swapData: data?.swapData || null,
              // Explicit null so a stale history id never survives a re-quote.
              exchangeHistoryId: data?.historyId || null,
              memo: data?.memo || null,
              currentCoin: selectedFromAsset,
              amount: finalAmount,
              isSendFunds: false,
              // Freshness window for the created transaction, enforced at
              // every commit point on the Transfer screen and in sendFunds.
              // Providers set their own TTL; absent (CEX deposit addresses)
              // means no client-side expiry.
              quoteCreatedAt: Date.now(),
              quoteTtlSeconds: data?.quoteTtlSeconds ?? null,
            }),
          );
          // No fee estimate here: estimateExchangeFee is the single owner,
          // fired (not awaited) by the Exchange screen when it navigates to
          // Transfer — after any allowance/permit steps have settled.
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
      // The backend forwards the provider's rejection reason (e.g. Velora
      // refusing a route its simulation says will revert) in the response
      // body; the axios message is just "Request failed with status code N".
      return thunkAPI.rejectWithValue(e?.response?.data?.message || e?.message);
    }
  },
);

// The SINGLE owner of the exchange fee estimate. The Exchange screen fires
// it (without awaiting) right before navigating to Transfer — after any
// allowance/permit steps settled, so the router simulation can succeed and
// the nonce is fetched fresh after approve txs consumed one. Its first
// synchronous action sets currentTransfer loading, so Transfer mounts in
// the loading state. Rejects on swap-blocking errors (expired quote) so
// awaiting callers, like the Transfer poll, can surface them.
export const estimateExchangeFee = createAsyncThunk(
  'exchange/estimateExchangeFee',
  async (_, thunkAPI) => {
    const dispatch = thunkAPI.dispatch;
    const {selectedFromAsset, selectedFromWallet, amountFrom, transferData} =
      getExchangeContext(thunkAPI.getState());
    return await dispatch(
      calculateEstimateFee({
        isFetchNonce: true,
        fromAddress: selectedFromAsset?.address,
        toAddress: transferData?.toAddress,
        amount: amountFrom + '',
        contractAddress: selectedFromAsset?.contractAddress,
        selectedWallet: selectedFromWallet,
        selectedCoin: selectedFromAsset,
        isExchange: true,
        // Bitcoin OP_RETURN memos add an output to the tx, so the fee
        // estimate must include it.
        memo: transferData?.memo || undefined,
      }),
    ).unwrap();
  },
);

// Fetches the live balance of the selected from-asset (and its gas coin —
// refreshCurrentCoin refreshes both) and re-syncs the exchange snapshot from
// the result. selectedFromAsset is a detached copy of the wallet coin, so
// re-copying it from the store is not enough — the chain must be queried.
// Fail-open: on any error the last-known balance stays displayed.
export const refreshExchangeFromBalance = createAsyncThunk(
  'exchange/refreshExchangeFromBalance',
  async (_, thunkAPI) => {
    const dispatch = thunkAPI.dispatch;
    try {
      dispatch(setExchangeFields({fromBalanceLoading: true}));
      const {selectedFromAsset, selectedFromWallet} = getExchangeContext(
        thunkAPI.getState(),
      );
      const result = await dispatch(
        refreshCurrentCoin({
          currentCoin: selectedFromAsset,
          currentWallet: selectedFromWallet,
        }),
      ).unwrap();
      const updatedCoin = result?.updatedCurrentCoin;
      // Staleness guard: drop the result if the user switched coins while
      // the fetch was in flight.
      const {selectedFromAsset: latestFromAsset} = getExchangeContext(
        thunkAPI.getState(),
      );
      if (updatedCoin && latestFromAsset?._id === updatedCoin?._id) {
        dispatch(
          setExchangeFields({
            selectedFromAsset: updatedCoin,
            fromBalanceLoading: false,
          }),
        );
        return updatedCoin;
      }
      dispatch(setExchangeFields({fromBalanceLoading: false}));
      return null;
    } catch (error) {
      console.error('Error refreshing exchange from-balance', error);
      dispatch(setExchangeFields({fromBalanceLoading: false}));
      return null;
    }
  },
  {
    condition: (_, {getState}) => {
      const exchange = getExchange(getState());
      return (
        Boolean(exchange?.selectedFromAsset) && !exchange?.fromBalanceLoading
      );
    },
  },
);

export const fetchExchangeAllowance = createAsyncThunk(
  'exchange/fetchExchangeAllowance',
  async (_, thunkAPI) => {
    const dispatch = thunkAPI.dispatch;
    try {
      dispatch(setExchangeFields({allowanceLoading: true}));
      const currentState = thunkAPI.getState();
      const {
        selectedFromAsset,
        selectedFromWallet,
        amountFrom,
        swapData,
        decimals,
      } = getExchangeContext(currentState);
      const {spender} = swapData || {};
      const {address, contractAddress} = selectedFromAsset;
      // No spender means the provider gave a deposit address rather than swap
      // calldata, so this is a plain transfer with nothing to approve.
      if (!spender) {
        dispatch(
          setExchangeFields({allowanceLoading: false, allowanceData: null}),
        );
        return {isApproved: true};
      }
      const amountInWei = toAmountInWei(amountFrom, decimals);
      const nativeCoin = await getNativeCoinOrThrow(
        currentState,
        selectedFromAsset,
        selectedFromWallet,
      );
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
      const {
        selectedFromAsset,
        selectedFromWallet,
        amountFrom,
        swapData,
        decimals,
      } = getExchangeContext(currentState);
      const amountInWei = toAmountInWei(amountFrom, decimals);
      const allowanceData = currentState?.exchange?.allowanceData;
      const allowance = BigInt(
        convertToSmallAmount(allowanceData?.allowanceFormatted, decimals) ||
          '0',
      );
      const nativeCoin = await getNativeCoinOrThrow(
        currentState,
        selectedFromAsset,
        selectedFromWallet,
      );
      const result = await nativeCoin.getEstimateFeForAllowanceApprove({
        from: selectedFromAsset?.address,
        contractAddress: selectedFromAsset?.contractAddress,
        spenderAddress: swapData?.spender,
        amountInWei,
        feesType: payload?.feesType,
        nonce: payload?.nonce,
        allowance,
        needsReset: allowanceData?.needsReset,
      });
      dispatch(
        setExchangeFields({
          allowanceData: {...allowanceData, ...buildApproveFeeFields(result)},
        }),
      );
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
      const {
        selectedFromAsset,
        selectedFromWallet,
        amountFrom,
        swapData,
        decimals,
      } = getExchangeContext(currentState);
      const {spender} = swapData || {};
      const {contractAddress, chain_name} = selectedFromAsset;
      const {type, nonce, estimateGas, gasFee, maxPriorityFeePerGas, feesType} =
        payload;
      const allowanceData = currentState?.exchange?.allowanceData;
      const {needsReset, allowanceFormatted} = allowanceData || {};
      if (!spender) {
        throw new Error('No spender to approve for this exchange provider');
      }
      const allowance = BigInt(
        convertToSmallAmount(allowanceFormatted, decimals) || '0',
      );
      if (!isSwapApprovalChain(chain_name)) {
        throw new Error(
          `Swap approvals are not supported on ${chain_name || 'this chain'}`,
        );
      }
      const nativeCoin = await getNativeCoinOrThrow(
        currentState,
        selectedFromAsset,
        selectedFromWallet,
      );

      const amountInWei =
        type === 'unlimited'
          ? ethers.MaxUint256
          : toAmountInWei(amountFrom, decimals);

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

      // No fee estimate here: estimateExchangeFee runs at navigation time
      // (after all approval steps settle) with isFetchNonce, so the nonce
      // this approve just consumed is re-fetched there.
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
      const {
        selectedFromAsset,
        selectedFromWallet,
        amountFrom,
        swapData,
        decimals,
      } = getExchangeContext(currentState);
      const amountInWei = toAmountInWei(amountFrom, decimals);
      const nativeCoin = await getNativeCoinOrThrow(
        currentState,
        selectedFromAsset,
        selectedFromWallet,
      );
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
      const {
        selectedFromAsset,
        selectedFromWallet,
        amountFrom,
        swapData,
        decimals,
      } = getExchangeContext(currentState);
      const {permit_abi, to, spender} = swapData;
      const {address, contractAddress} = selectedFromAsset;
      const {nonce, feesType} = payload;
      const amountInWei = toAmountInWei(amountFrom, decimals);
      const permitAllowanceData = currentState?.exchange?.permitAllowanceData;
      const permit2Amount = BigInt(
        convertToSmallAmount(
          permitAllowanceData?.permit2AmountFormatted,
          decimals,
        ) || '0',
      );
      const nativeCoin = await getNativeCoinOrThrow(
        currentState,
        selectedFromAsset,
        selectedFromWallet,
      );
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
      dispatch(
        setExchangeFields({
          permitAllowanceData: {
            ...permitAllowanceData,
            ...buildApproveFeeFields(result),
          },
        }),
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
      const {
        selectedFromAsset,
        selectedFromWallet,
        amountFrom,
        swapData,
        decimals,
      } = getExchangeContext(currentState);
      const {permit_abi, to, spender} = swapData;
      const {address, contractAddress, chain_name} = selectedFromAsset;
      const {type, nonce, estimateGas, gasFee, maxPriorityFeePerGas, feesType} =
        payload;
      if (!isEVMChain(chain_name)) {
        throw new Error('approveExchangePermit2 only supports EVM chains');
      }
      const nativeCoin = await getNativeCoinOrThrow(
        currentState,
        selectedFromAsset,
        selectedFromWallet,
      );

      // Manual approves the exact swap amount, matching the ERC20 path and what
      // the sheet promises the user. An exact-input swap pulls exactly the
      // quoted amount, so headroom here would only over-approve.
      const amountInWei =
        type === 'unlimited'
          ? MAX_UINT160
          : toAmountInWei(amountFrom, decimals);

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

      // No fee estimate here: estimateExchangeFee runs at navigation time
      // (after all approval steps settle) with isFetchNonce, so the nonce
      // this approve just consumed is re-fetched there.
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
  setExchangeFields,
  setExchangeLoading,
  setExchangeSuccess,
  updateExchangeApproveFees,
} = exchangeSlice.actions;
