// Stable fallback: a fresh []/{} per call makes useSelector warn and rerender.
// Read-only - shared by every caller.
const EMPTY_OBJECT = {};

export const getSentAddressHistory = state =>
  state.sentAddressHistory?.addresses || EMPTY_OBJECT;
