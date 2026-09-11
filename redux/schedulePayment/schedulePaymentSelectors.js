import {createSelector} from '@reduxjs/toolkit';
import {isScheduledPaymentExpired} from 'utils/scheduleRecurrence';

const EMPTY_SCHEDULED_PAYMENTS = [];

export const selectScheduledPaymentsForCurrentWallet = state => {
  const clientId = state.wallets?.currentWalletClientId;
  if (!clientId) {
    return EMPTY_SCHEDULED_PAYMENTS;
  }
  return (
    state.schedulePayment?.scheduledPayments?.[clientId] ||
    EMPTY_SCHEDULED_PAYMENTS
  );
};

export const selectScheduledPaymentsByClientId = (state, clientId) => {
  if (!clientId) {
    return EMPTY_SCHEDULED_PAYMENTS;
  }
  return (
    state.schedulePayment?.scheduledPayments?.[clientId] ||
    EMPTY_SCHEDULED_PAYMENTS
  );
};

// Only payments that still have an upcoming occurrence. Expired ones are
// pruned by pruneExpiredScheduledPayments, but that runs on focus/foreground,
// so the list itself must never render an item that outlived its schedule.
export const selectActiveScheduledPaymentsForCurrentWallet = createSelector(
  [selectScheduledPaymentsForCurrentWallet],
  scheduledPayments =>
    scheduledPayments.filter(item => !isScheduledPaymentExpired(item)),
);
