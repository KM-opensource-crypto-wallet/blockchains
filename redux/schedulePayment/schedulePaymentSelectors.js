export const selectIsSubmittingSchedulePayment = state =>
  state.schedulePayment?.isSubmitting || false;

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

// Used to cancel every pending scheduled-payment notification across all
// wallets before a full wallet reset wipes the redux state they reference.
export const selectAllScheduledPayments = state => {
  const scheduledPayments = state.schedulePayment?.scheduledPayments || {};
  return Object.values(scheduledPayments).flat();
};
