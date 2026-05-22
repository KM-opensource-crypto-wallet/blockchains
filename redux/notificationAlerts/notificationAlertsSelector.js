export const getNotificationAlerts = state =>
  Array.isArray(state.notificationAlerts?.notificationAlerts)
    ? state.notificationAlerts?.notificationAlerts
    : [];
