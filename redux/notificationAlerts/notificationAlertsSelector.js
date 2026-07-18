import {createSelector} from '@reduxjs/toolkit';
import {isWalletHiddenAndLocked} from '../wallets/walletsSelector';

export const getNotificationAlerts = state =>
  Array.isArray(state.notificationAlerts?.notificationAlerts)
    ? state.notificationAlerts?.notificationAlerts
    : [];

// Alerts carry walletName/threshold/address - rendering a hidden (locked)
// wallet's alerts would leak its existence. Revealed hidden wallets DO show
// theirs (isWalletHiddenAndLocked is false while revealed). Alerts whose
// wallet no longer exists are kept, matching previous behavior.
export const getVisibleNotificationAlerts = createSelector(
  [getNotificationAlerts, state => state.wallets?.allWallets],
  (alerts, allWallets) => {
    const hiddenWalletIds = new Set(
      (allWallets || [])
        .filter(wallet => isWalletHiddenAndLocked(wallet))
        .map(wallet => wallet?.clientId)
        .filter(Boolean),
    );
    if (hiddenWalletIds.size === 0) {
      return alerts;
    }
    return alerts.filter(
      alert =>
        !hiddenWalletIds.has(alert.walletClientId) &&
        !hiddenWalletIds.has(alert.walletId),
    );
  },
);
