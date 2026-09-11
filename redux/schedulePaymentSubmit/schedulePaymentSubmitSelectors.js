export const selectIsSubmittingSchedulePayment = state =>
  (state.schedulePaymentSubmit?.pendingSubmitCount || 0) > 0;
