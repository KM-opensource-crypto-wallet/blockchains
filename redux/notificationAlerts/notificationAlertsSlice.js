import {createSlice, createAsyncThunk} from '@reduxjs/toolkit';
import {
  createSubscription,
  updateSubscription,
  deleteSubscription,
  getSubscriptionsByUser,
} from '../../service/dokApi';
import {getMasterClientId} from '../wallets/walletsSelector';
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
      return rejectWithValue(err?.message);
    }
  },
);

/**
 * Update a subscription on the backend and in local state.
 */
export const updateAlertThunk = createAsyncThunk(
  'notificationAlerts/updateAlert',
  async ({payload}) => {
    if (payload.backendId) {
      await updateSubscription(payload.backendId, {
        direction: toDirection(payload.notifyOnReceive, payload.notifyOnSend),
        minAmount: payload.minAmount ? parseFloat(payload.minAmount) : null,
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
      const userId = getMasterClientId(getState());
      const result = await getSubscriptionsByUser(userId);
      return Array.isArray(result?.data) ? result.data : [];
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
        const backendIds = new Set(payload.map(sub => sub._id));
        const backendMap = {};
        for (const sub of payload) {
          const key = `${sub.walletId}_${sub.coin?.symbol}_${sub.coin?.chain_name}_${sub.wallet}`;
          backendMap[key] = sub._id;
        }
        state.notificationAlerts = state.notificationAlerts
          .filter(alert => !alert.backendId || backendIds.has(alert.backendId))
          .map(alert => {
            const key = `${alert.walletId}_${alert.coinSymbol}_${alert.chainName}_${alert.wallet}`;
            const backendId = backendMap[key];
            if (backendId && alert.backendId !== backendId) {
              return {...alert, backendId};
            }
            return alert;
          });
      });
  },
});

export const {
  addNotificationAlert,
  updateNotificationAlert,
  deleteNotificationAlert,
} = notificationAlertsSlice.actions;
