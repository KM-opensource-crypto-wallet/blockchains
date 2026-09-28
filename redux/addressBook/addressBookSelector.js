import {createSelector} from '@reduxjs/toolkit';
import {
  isWalletHiddenAndLocked,
  selectAllWallets,
} from 'dok-wallet-blockchain-networks/redux/wallets/walletsSelector';

// Stable fallback: a fresh []/{} per call makes useSelector warn and rerender.
// Read-only - shared by every caller.
const EMPTY_ARRAY = [];

export const getAddressBook = state =>
  Array.isArray(state.addressBook?.addressBook)
    ? state.addressBook?.addressBook
    : EMPTY_ARRAY;
export const getVisibleAddressBook = createSelector(
  [getAddressBook, selectAllWallets],
  (addressBook, allWallets) => {
    const hiddenClientIds = (allWallets || [])
      .filter(isWalletHiddenAndLocked)
      .map(wallet => wallet.clientId);
    if (!hiddenClientIds.length) {
      return addressBook;
    }
    const hiddenClientIdSet = new Set(hiddenClientIds);
    return addressBook.filter(item => {
      if (!Array.isArray(item?.wallets) || !item.wallets.length) {
        return true;
      }
      return item.wallets.some(clientId => !hiddenClientIdSet.has(clientId));
    });
  },
);
