import {
  isWalletHiddenAndLocked,
  selectAllWallets,
} from 'dok-wallet-blockchain-networks/redux/wallets/walletsSelector';

export const getAddressBook = state =>
  Array.isArray(state.addressBook?.addressBook)
    ? state.addressBook?.addressBook
    : [];
export const getVisibleAddressBook = state => {
  const addressBook = getAddressBook(state);
  const hiddenClientIds = (selectAllWallets(state) || [])
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
};
