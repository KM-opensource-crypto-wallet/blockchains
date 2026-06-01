export const getNotificationAlerts = state =>
  Array.isArray(state.notificationAlerts?.notificationAlerts)
    ? state.notificationAlerts?.notificationAlerts
    : [];

export const getNotificationHistory = state =>
  state.notificationAlerts?.notificationHistory ?? [];

export const getHistoryLoading = state =>
  state.notificationAlerts?.historyLoading ?? false;

export const getHistoryHasMore = state =>
  state.notificationAlerts?.historyHasMore ?? true;
