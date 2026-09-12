import {createAsyncThunk, createSlice} from '@reduxjs/toolkit';
import dayjs from 'dayjs';
import {v4} from 'uuid';
import {
  isWalletHiddenAndLocked,
  selectAllWallets,
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
  reconcileScheduledPaymentNotifications,
} from 'utils/scheduledPaymentNotifications';
import {
  SCHEDULED_DATE_FORMAT,
  buildRecurrence,
  computeOccurrences,
  isScheduledPaymentExpired,
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
    // still-working previous reminder in exchange for nothing. The OS holds
    // only so many pending notifications; crossing that limit is refused
    // here, before anything is stored, with the numbers the user needs.
    let reminder;
    try {
      reminder = await createScheduledPaymentNotification(
        {
          id,
          asset,
          recipientAddress,
          amount: values.amount,
          scheduledAt,
          recurrence,
          walletClientId,
        },
        getState,
      );
    } catch (e) {
      return rejectWithValue({type: 'reminderFailed'});
    }
    if (reminder?.limitExceeded) {
      return rejectWithValue({
        type: 'reminderLimitExceeded',
        ...reminder.limitExceeded,
      });
    }
    if (!reminder?.scheduled) {
      return rejectWithValue({type: 'reminderFailed'});
    }

    // The awaits above can outlive the wallet: a resetWallet (ModalReset,
    // login lockout) or deleteWallet in the meantime has already dropped its
    // schedule, and persisting now would resurrect a payment for a wallet
    // that no longer exists. The reminder just armed is then an orphan —
    // reconcile against the fresh state cancels it.
    const walletStillExists = (selectAllWallets(getState()) || []).some(
      wallet => wallet?.clientId === walletClientId,
    );
    if (!walletStillExists) {
      await reconcileScheduledPaymentNotifications(getState);
      return rejectWithValue({type: 'walletGone'});
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
          },
        }),
      );
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

    return {occurrences};
  },
);

// Scheduled payments have no persisted status: a payment is "active" for
// exactly as long as it has an upcoming occurrence. A one-time payment
// whose time has passed, or a repeating series that has run out, has no
// live reminder and nothing left to show, so it is deleted outright.
// Runs across every wallet (hidden ones included — their expired payments
// are just as dead). The reminder reconcile afterwards cancels their
// triggers and refills freed slots for other payments. `keepIds` protects a payment whose
// reminder was just tapped but not yet handled (the tap is processed after
// unlock): a fired one-time reminder is by definition past due, and its
// payment must survive until the handler has prefilled the transfer.
export const pruneExpiredScheduledPayments = createAsyncThunk(
  'schedulePayment/pruneExpired',
  async ({keepIds} = {}, {dispatch, getState}) => {
    const now = Date.now();
    const keep = new Set((keepIds || []).filter(Boolean));
    const scheduledPayments =
      getState().schedulePayment?.scheduledPayments || {};
    const expired = [];
    Object.entries(scheduledPayments).forEach(([walletClientId, list]) => {
      (Array.isArray(list) ? list : []).forEach(item => {
        if (
          item?.id &&
          !keep.has(item.id) &&
          isScheduledPaymentExpired(item, now)
        ) {
          expired.push({id: item.id, walletClientId});
        }
      });
    });
    if (!expired.length) {
      return [];
    }
    expired.forEach(entry => dispatch(removeScheduledPayment(entry)));
    await reconcileScheduledPaymentNotifications(getState);
    return expired.map(entry => entry.id);
  },
);

// "Delete schedule notifications" on a hidden wallet means the payments
// themselves go, not just their reminders: a payment with no reminder would
// otherwise sit in the list forever without ever firing. Removes every
// payment of the wallet from redux, then reconciles notifee triggers.
export const deleteScheduledPaymentsForWallet = createAsyncThunk(
  'schedulePayment/deleteForWallet',
  async ({walletClientId}, {dispatch, getState}) => {
    if (!walletClientId) {
      return [];
    }
    const ids = (
      getState().schedulePayment?.scheduledPayments?.[walletClientId] || []
    )
      .map(item => item?.id)
      .filter(Boolean);
    dispatch(removeScheduledPaymentsForWallet({walletClientId}));
    await reconcileScheduledPaymentNotifications(getState);
    return ids;
  },
);

// Wallets can go from revealed to hidden+locked outside of HideWallet's own
// Save flow - app relaunch (RELAUNCH relock, forced back on by the
// persist-rehydrate transform) and backgrounding (BACKGROUND relock). A
// payment scheduled while the wallet was revealed would survive those, so
// apply the wallet's "Delete schedule notifications" setting again here.
export const deleteHiddenWalletsScheduledPayments = createAsyncThunk(
  'schedulePayment/deleteForHiddenWallets',
  async (_, {dispatch, getState}) => {
    const state = getState();
    const scheduledPayments = state.schedulePayment?.scheduledPayments || {};
    const walletClientIds = (selectAllWallets(state) || [])
      .filter(
        wallet =>
          isWalletHiddenAndLocked(wallet) &&
          wallet?.hideSettings?.deleteScheduleNotification &&
          (scheduledPayments[wallet.clientId] || []).length > 0,
      )
      .map(wallet => wallet.clientId);
    await Promise.all(
      walletClientIds.map(walletClientId =>
        dispatch(deleteScheduledPaymentsForWallet({walletClientId})),
      ),
    );
    return walletClientIds;
  },
);

// Make notifee's pending triggers match redux (see
// reconcileScheduledPaymentNotifications). Dispatched from the UI and the
// notification provider whenever the desired set may have changed.
export const syncScheduledPaymentNotifications = createAsyncThunk(
  'schedulePayment/syncNotifications',
  async (_, {getState}) => {
    await reconcileScheduledPaymentNotifications(getState);
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
          asset: payload?.asset,
          senderAddress: payload?.senderAddress,
          recipientAddress: payload?.recipientAddress,
          amount: payload?.amount,
          memo: payload?.memo || '',
          scheduledAt: payload?.scheduledAt,
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
    removeScheduledPaymentsForWallet(state, {payload}) {
      const clientId = payload?.walletClientId;
      if (!clientId) {
        console.warn(
          'walletClientId is required to remove scheduled payments for wallet',
        );
        return;
      }
      delete state.scheduledPayments[clientId];
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
        // An in-flight submit belongs to the wallet that was just wiped; its
        // settle handlers floor at 0, so clearing here can't go negative.
        state.pendingSubmitCount = 0;
        state.isSubmitting = false;
      });
  },
});

export const {
  addScheduledPayment,
  updateScheduledPayment,
  removeScheduledPayment,
  removeScheduledPaymentsForWallet,
} = schedulePaymentSlice.actions;

export default schedulePaymentSlice.reducer;
