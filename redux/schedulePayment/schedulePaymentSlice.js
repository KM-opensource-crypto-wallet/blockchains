import {createAsyncThunk, createSlice} from '@reduxjs/toolkit';
import dayjs from 'dayjs';
import {v4} from 'uuid';
import {
  selectCurrentCoin,
  selectCurrentWallet,
  selectCurrentWalletClientId,
} from 'dok-wallet-blockchain-networks/redux/wallets/walletsSelector';
import {
  deleteWallet,
  resetWallet,
} from 'dok-wallet-blockchain-networks/redux/wallets/walletsSlice';
import {resolveRecipientAddress} from 'dok-wallet-blockchain-networks/helper/recipientAddress';
import {
  getCustomRPCWithData,
  selectAllCustomRpc,
} from 'dok-wallet-blockchain-networks/redux/customRpc/customRpcSelectors';
import {
  requestLocalNotificationPermission,
  createScheduledPaymentNotification,
  cancelScheduledPaymentNotification,
} from 'utils/scheduledPaymentNotifications';
import {
  SCHEDULED_DATE_FORMAT,
  buildRecurrence,
  computeOccurrences,
} from 'utils/scheduleRecurrence';

export const submitScheduledPayment = createAsyncThunk(
  'schedulePayment/submit',
  async ({values, editingPayment}, {dispatch, getState, rejectWithValue}) => {
    const state = getState();
    const currentCoin = selectCurrentCoin(state);
    const currentWallet = selectCurrentWallet(state);
    const allCustomRPC = selectAllCustomRpc(state);
    const walletClientId = selectCurrentWalletClientId(state);
    const isEditMode = !!editingPayment?.id;

    const scheduledAt = dayjs(
      values.scheduledDate,
      SCHEDULED_DATE_FORMAT,
      true,
    ).valueOf();
    const chainName = isEditMode
      ? editingPayment.chain
      : currentCoin?.chain_name;
    const memo = values.memo?.trim() || '';

    // The screen already validates the recipient for immediate feedback, but
    // a scheduled payment is built and broadcast later with no user in the
    // loop, so re-check here as a safety net. An address that's malformed
    // for this chain (e.g. wrong-length/format) can otherwise still get
    // SCALE/RLP-encoded into a transaction and blow up fee estimation with a
    // cryptic decode error when the reminder fires.
    const {resolvedAddress: recipientAddress} = await resolveRecipientAddress({
      chain_name: chainName,
      phrase: currentWallet?.phrase,
      customRPC: getCustomRPCWithData(
        allCustomRPC,
        chainName,
        currentWallet?.clientId,
      ),
      address: values.toAddress,
    });
    if (!recipientAddress) {
      return rejectWithValue({type: 'invalidAddress'});
    }

    const recurrence = buildRecurrence(values);
    const occurrences = computeOccurrences({scheduledAt, recurrence});
    const id = isEditMode ? editingPayment.id : v4();
    const asset = isEditMode
      ? editingPayment.asset
      : {
          symbol: currentCoin?.symbol,
          contractAddress: currentCoin?.contractAddress,
          decimals: currentCoin?.decimal,
        };

    // Reminders are the only way a scheduled payment gets acted on — don't
    // create/update the schedule at all if we can't notify the user.
    const {granted, blocked} = await requestLocalNotificationPermission();
    if (!granted) {
      return rejectWithValue({type: 'notificationBlocked', blocked});
    }

    // The reminder is the only thing that ever acts on a scheduled payment,
    // so it must exist before the schedule itself is persisted (or an
    // existing one replaced) — otherwise a failed/blocked reminder either
    // creates a payment that will never fire, or (on edit) destroys the
    // still-working previous reminder in exchange for nothing.
    let notificationScheduled = false;
    try {
      ({scheduled: notificationScheduled} =
        await createScheduledPaymentNotification(
          {
            id,
            asset,
            recipientAddress,
            amount: values.amount,
            scheduledAt,
            occurrences,
            walletClientId,
          },
          getState,
        ));
    } catch (e) {
      return rejectWithValue({type: 'reminderFailed'});
    }
    if (!notificationScheduled) {
      return rejectWithValue({type: 'reminderFailed'});
    }

    if (isEditMode) {
      dispatch(
        updateScheduledPayment({
          id,
          walletClientId,
          changes: {
            recipientAddress,
            amount: values.amount,
            memo,
            scheduledAt,
            recurrence,
            status: 'scheduled',
            failureReason: null,
          },
        }),
      );
      // The new reminder above was created under the same id, overwriting
      // any previous trigger at each reused index in place - only the
      // trailing indices left over from a longer prior series need sweeping.
      await cancelScheduledPaymentNotification(id, occurrences.length);
    } else {
      dispatch(
        addScheduledPayment({
          id,
          walletClientId,
          chain: currentCoin?.chain_name,
          asset,
          senderAddress: currentCoin?.address,
          recipientAddress,
          amount: values.amount,
          memo,
          scheduledAt,
          recurrence,
        }),
      );
    }

    return {occurrences, notificationScheduled};
  },
);

export const schedulePaymentSlice = createSlice({
  name: 'schedulePayment',
  initialState: {
    isSubmitting: false,
    pendingSubmitCount: 0,
    scheduledPayments: {},
  },
  reducers: {
    addScheduledPayment(state, {payload}) {
      const clientId = payload?.walletClientId;
      if (!clientId) {
        console.warn('walletClientId is required to add scheduled payment');
        return;
      }
      const previousScheduledPayments = Array.isArray(
        state.scheduledPayments[clientId],
      )
        ? state.scheduledPayments[clientId]
        : [];
      if (
        payload?.id &&
        previousScheduledPayments.some(item => item?.id === payload.id)
      ) {
        console.warn('scheduled payment with this id already exists');
        return;
      }
      const now = Date.now();
      state.scheduledPayments[clientId] = [
        ...previousScheduledPayments,
        {
          id: payload?.id || v4(),
          chain: payload?.chain,
          network: payload?.network,
          asset: payload?.asset,
          senderAddress: payload?.senderAddress,
          recipientAddress: payload?.recipientAddress,
          amount: payload?.amount,
          memo: payload?.memo || '',
          scheduledAt: payload?.scheduledAt,
          status: 'scheduled',
          recurrence: payload?.recurrence,
          createdAt: now,
          updatedAt: now,
        },
      ];
    },
    updateScheduledPayment(state, {payload}) {
      if (!payload?.id) {
        console.warn('id payload is required for update scheduled payment');
        return;
      }
      const clientId = payload?.walletClientId;
      if (!clientId) {
        console.warn('walletClientId is required to update scheduled payment');
        return;
      }
      const previousScheduledPayments = Array.isArray(
        state.scheduledPayments[clientId],
      )
        ? state.scheduledPayments[clientId]
        : [];
      state.scheduledPayments[clientId] = previousScheduledPayments.map(item =>
        item?.id === payload?.id
          ? {...item, ...payload?.changes, id: item.id, updatedAt: Date.now()}
          : item,
      );
    },
    removeScheduledPayment(state, {payload}) {
      if (!payload?.id) {
        console.warn('id payload is required for remove scheduled payment');
        return;
      }
      const clientId = payload?.walletClientId;
      if (!clientId) {
        console.warn('walletClientId is required to remove scheduled payment');
        return;
      }
      const previousScheduledPayments = Array.isArray(
        state.scheduledPayments[clientId],
      )
        ? state.scheduledPayments[clientId]
        : [];
      state.scheduledPayments[clientId] = previousScheduledPayments.filter(
        item => item?.id !== payload?.id,
      );
    },
  },
  extraReducers: builder => {
    builder
      .addCase(submitScheduledPayment.pending, state => {
        state.pendingSubmitCount += 1;
        state.isSubmitting = true;
      })
      .addCase(submitScheduledPayment.fulfilled, state => {
        state.pendingSubmitCount = Math.max(0, state.pendingSubmitCount - 1);
        state.isSubmitting = state.pendingSubmitCount > 0;
      })
      .addCase(submitScheduledPayment.rejected, state => {
        state.pendingSubmitCount = Math.max(0, state.pendingSubmitCount - 1);
        state.isSubmitting = state.pendingSubmitCount > 0;
      })
      .addCase(deleteWallet, (state, action) => {
        delete state.scheduledPayments[action.payload];
      })
      .addCase(resetWallet, state => {
        state.scheduledPayments = {};
      });
  },
});

export const {
  addScheduledPayment,
  updateScheduledPayment,
  removeScheduledPayment,
} = schedulePaymentSlice.actions;

export default schedulePaymentSlice.reducer;
