export const getAddressBook = state =>
  Array.isArray(state.addressBook?.addressBook)
    ? state.addressBook?.addressBook
    : [];
