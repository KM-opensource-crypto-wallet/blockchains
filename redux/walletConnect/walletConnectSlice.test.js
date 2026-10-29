import {
  clearWalletConnectTransactionData,
  setWalletConnectTransactionData,
  setWalletConnectTransactionModal,
  walletConnectSlice,
} from 'dok-wallet-blockchain-networks/redux/walletConnect/walletConnectSlice';

const reducer = walletConnectSlice.reducer;
const request = id => ({id, method: 'eth_sendTransaction', params: [{}]});

describe('walletConnectSlice.clearWalletConnectTransactionData', () => {
  it('clears the pending request when the id matches', () => {
    let state = reducer(undefined, setWalletConnectTransactionData(request(7)));
    expect(state.transactionRequestData.id).toBe(7);
    expect(state.transactionModalVisible).toBe(true);

    state = reducer(state, clearWalletConnectTransactionData({id: 7}));
    expect(state.transactionRequestData).toBeNull();
  });

  it('leaves a different pending request untouched', () => {
    let state = reducer(undefined, setWalletConnectTransactionData(request(7)));
    state = reducer(state, clearWalletConnectTransactionData({id: 8}));
    expect(state.transactionRequestData.id).toBe(7);
  });

  it('clears unconditionally when no id is given', () => {
    let state = reducer(undefined, setWalletConnectTransactionData(request(7)));
    state = reducer(state, clearWalletConnectTransactionData());
    expect(state.transactionRequestData).toBeNull();
  });

  it('does not touch the visibility flag, which the modal owns', () => {
    let state = reducer(undefined, setWalletConnectTransactionData(request(7)));
    state = reducer(state, setWalletConnectTransactionModal(false));
    expect(state.transactionRequestData.id).toBe(7);
    state = reducer(state, clearWalletConnectTransactionData({id: 7}));
    expect(state.transactionModalVisible).toBe(false);
  });
});
