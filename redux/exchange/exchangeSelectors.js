export const getExchange = state => state.exchange;
export const getExchangeAllowance = state => state.exchange.allowanceData;
export const getExchangeAllowanceLoading = state =>
  state.exchange.allowanceLoading;
export const getExchangeApproveLoading = state => state.exchange.approveLoading;
export const getExchangePermitAllowance = state =>
  state.exchange.permitAllowanceData;
export const getExchangePermitAllowanceLoading = state =>
  state.exchange.permitAllowanceLoading;
export const getExchangePermitApproveLoading = state =>
  state.exchange.permitApproveLoading;
