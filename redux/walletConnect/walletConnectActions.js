import {createAsyncThunk} from '@reduxjs/toolkit';
import {etherWalletConnectTransaction} from 'dok-wallet-blockchain-networks/service/etherWalletConnect';
import {getWalletConnect} from 'dok-wallet-blockchain-networks/service/walletconnect';
import {setWalletConnectTransactionSubmit} from 'dok-wallet-blockchain-networks/redux/walletConnect/walletConnectSlice';
import {tronWalletConnectTransaction} from 'dok-wallet-blockchain-networks/service/tronWalletConnect';
import {solanaWalletConnectTransaction} from 'dok-wallet-blockchain-networks/service/solanaWalletConnect';
import {showToast} from 'utils/toast';

export const createWalletConnectTransaction = createAsyncThunk(
  'walletConnect/createWalletConnectTransaction',
  async (payload, thunkAPI) => {
    const {
      transactionData,
      privateKey,
      chain_name,
      requestId,
      id,
      method,
      signTypeData,
      sessionId,
      topic,
    } = payload;
    const dispatch = thunkAPI.dispatch;
    let tx;
    try {
      dispatch(setWalletConnectTransactionSubmit(true));
      if (method?.includes('solana')) {
        tx = await solanaWalletConnectTransaction(
          method,
          transactionData,
          privateKey,
          signTypeData,
        );
      } else if (method?.includes('tron')) {
        tx = await tronWalletConnectTransaction(
          method,
          transactionData,
          privateKey,
          signTypeData,
        );
      } else {
        tx = await etherWalletConnectTransaction(
          method,
          transactionData,
          privateKey,
          chain_name,
          signTypeData,
        );
      }
      const connector = getWalletConnect();
      if (tx) {
        const response = {
          id,
          result: tx,
          jsonrpc: '2.0',
        };
        await connector.respondSessionRequest({topic, response});
      }
      dispatch(setWalletConnectTransactionSubmit(false));
    } catch (error) {
      console.error('Error in create wallet trasaction', error);
      dispatch(setWalletConnectTransactionSubmit(false));
      showToast({
        type: 'errorToast',
        title: 'Transaction failed',
        message: error?.message || error,
      });
      const connector = getWalletConnect();
      // if (connector[sessionId]) {
      const response = {
        id,
        jsonrpc: '2.0',
        error: {
          code: 5000,
          message: 'Transaction error',
        },
      };
      connector.respondSessionRequest({topic, response});
      // }
    }
  },
);
