import {createSlice} from '@reduxjs/toolkit';
import {insertSorted} from 'dok-wallet-blockchain-networks/helper';

const initialState = {
  addressBook: [],
};

export const addressBookSlice = createSlice({
  name: 'addressBook',
  initialState,
  reducers: {
    addAddressBook(state, {payload}) {
      const previousData = state.addressBook;
      state.addressBook = insertSorted(previousData, payload, 'name');
    },
    updateAddressBook(state, {payload}) {
      const previousData = state.addressBook;
      state.addressBook = previousData.map(obj =>
        obj.id === payload?.id ? {...obj, ...payload} : obj,
      );
    },
    deleteAddressBook(state, {payload}) {
      const previousData = state.addressBook;
      state.addressBook = previousData.filter(obj => obj.id !== payload?.id);
    },
  },
});

export const {addAddressBook, deleteAddressBook, updateAddressBook} =
  addressBookSlice.actions;
