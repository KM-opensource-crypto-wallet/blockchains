import {createSlice, createAsyncThunk} from '@reduxjs/toolkit';
import {
  createSubscription,
  updateSubscription,
  deleteSubscription,
  getSubscriptionsByUser,
} from '../../service/dokApi';
import {getMasterClientId, selectAllWallets} from '../wallets/walletsSelector';
import {toDirection} from 'dok-wallet-blockchain-networks/helper';

/**
 * Create a custom subscription for a single coin/wallet.
 * Payload must include all fields for the alert + backend subscription.
 */
export const createCustomAlert = createAsyncThunk(
  'notificationAlerts/createCustomAlert',
  async ({payload, oneSignalPlayerId}, {getState, rejectWithValue}) => {
    try {
      const userId = getMasterClientId(getState());
      const result = await createSubscription({
        userId,
        walletId: payload.walletId,
        oneSignalPlayerId,
        wallet: payload.wallet,
        coin: {
          symbol: payload.coinSymbol,
          chain_name: payload.chainName,
          chain_display_name: payload.chainDisplayName ?? null,
          isNative: payload.coinType !== 'token',
          decimal: payload.coinDecimal ?? 18,
          ...(payload.contractAddress
            ? {contractAddress: payload.contractAddress}
            : {}),
        },
        direction: toDirection(payload.notifyOnReceive, payload.notifyOnSend),
        minAmount: payload.minAmount ? parseFloat(payload.minAmount) : null,
      });
      return {...payload, backendId: result?.data?._id ?? null};
    } catch (err) {
      const message =
        err?.response?.data?.message ||
        err?.message ||
        'Failed to create alert';
      return rejectWithValue(message);
    }
  },
);

/**
 * Update a subscription on the backend and in local state.
 */
export const updateAlertThunk = createAsyncThunk(
  'notificationAlerts/updateAlert',
  async ({payload, oneSignalPlayerId}) => {
    if (payload.backendId) {
      await updateSubscription(payload.backendId, {
        direction: toDirection(payload.notifyOnReceive, payload.notifyOnSend),
        minAmount: payload.minAmount ? parseFloat(payload.minAmount) : null,
        ...(oneSignalPlayerId ? {oneSignalPlayerId} : {}),
      }).catch(err => console.error('updateAlertThunk error:', err?.message));
    }
    return payload;
  },
);

/**
 * Fetch all subscriptions from the backend and sync backendIds into local state.
 */
export const fetchSubscriptionsThunk = createAsyncThunk(
  'notificationAlerts/fetchSubscriptions',
  async (_, {getState, rejectWithValue}) => {
    try {
      const state = getState();
      const userId = getMasterClientId(state);
      const result = await getSubscriptionsByUser(userId);
      const subs = Array.isArray(result?.data) ? result.data : [];

      const localAlerts = state.notificationAlerts?.notificationAlerts ?? [];
      const localBackendIds = new Set(
        localAlerts.map(a => a.backendId).filter(Boolean),
      );
      const wallets = selectAllWallets(state);

      const missingAlerts = subs
        .filter(sub => !localBackendIds.has(sub._id))
        .reduce((acc, sub) => {
          const wallet = wallets.find(w => w.clientId === sub.walletId);
          if (!wallet) {
            return acc;
          }
          const coin = wallet.coins?.find(
            c =>
              c.chain_name === sub.coin?.chain_name &&
              c.symbol === sub.coin?.symbol,
          );
          acc.push({
            id: sub._id,
            backendId: sub._id,
            walletClientId: sub.walletId,
            walletId: sub.walletId,
            walletName: wallet.walletName,
            coinId: coin?._id ?? null,
            coinName: coin?.name ?? sub.coin.symbol,
            coinIcon: coin?.icon ?? null,
            coinSymbol: sub.coin.symbol,
            chainName: sub.coin.chain_name,
            chainDisplayName: sub.coin.chain_display_name || '',
            coinType: sub.coin.isNative ? 'coin' : 'token',
            coinDecimal: sub.coin.decimal ?? 18,
            contractAddress: sub.coin.contractAddress ?? null,
            wallet: sub.wallet,
            minAmount: sub.minAmount ?? null,
            notifyOnReceive: ['receive', 'both'].includes(sub.direction),
            notifyOnSend: ['send', 'both'].includes(sub.direction),
          });
          return acc;
        }, []);

      return {subs, missingAlerts};
    } catch (err) {
      return rejectWithValue(err?.message);
    }
  },
);

/**
 * Soft-delete a subscription on the backend and remove from local state.
 */
export const deleteAlertThunk = createAsyncThunk(
  'notificationAlerts/deleteAlert',
  async ({item}) => {
    if (item.backendId) {
      await deleteSubscription(item.backendId).catch(err =>
        console.error('deleteAlertThunk error:', err?.message),
      );
    }
    return item;
  },
);

const initialState = {
  notificationAlerts: [],
};

export const notificationAlertsSlice = createSlice({
  name: 'notificationAlerts',
  initialState,
  reducers: {
    addNotificationAlert(state, {payload}) {
      state.notificationAlerts.push(payload);
    },
    updateNotificationAlert(state, {payload}) {
      state.notificationAlerts = state.notificationAlerts.map(obj =>
        obj.id === payload?.id ? {...obj, ...payload} : obj,
      );
    },
    deleteNotificationAlert(state, {payload}) {
      state.notificationAlerts = state.notificationAlerts.filter(
        obj => obj.id !== payload?.id,
      );
    },
  },
  extraReducers: builder => {
    builder
      .addCase(createCustomAlert.fulfilled, (state, {payload}) => {
        state.notificationAlerts.push(payload);
      })
      .addCase(updateAlertThunk.fulfilled, (state, {payload}) => {
        state.notificationAlerts = state.notificationAlerts.map(obj =>
          obj.id === payload?.id ? {...obj, ...payload} : obj,
        );
      })
      .addCase(deleteAlertThunk.fulfilled, (state, {payload}) => {
        state.notificationAlerts = state.notificationAlerts.filter(
          obj => obj.id !== payload?.id,
        );
      })
      .addCase(fetchSubscriptionsThunk.fulfilled, (state, {payload}) => {
        const {subs, missingAlerts} = payload;
        const backendIds = new Set(subs.map(sub => sub._id));
        state.notificationAlerts = state.notificationAlerts.filter(
          alert => !alert.backendId || backendIds.has(alert.backendId),
        );
        state.notificationAlerts.push(...missingAlerts);
      });
  },
});

export const {
  addNotificationAlert,
  updateNotificationAlert,
  deleteNotificationAlert,
} = notificationAlertsSlice.actions;
