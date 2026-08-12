import {createAsyncThunk} from '@reduxjs/toolkit';
import {etherWalletConnectTransaction} from 'dok-wallet-blockchain-networks/service/walletConnect/etherWalletConnect';
import {getWalletConnect} from 'dok-wallet-blockchain-networks/service/walletconnect';
import {setWalletConnectTransactionSubmit} from 'dok-wallet-blockchain-networks/redux/walletConnect/walletConnectSlice';
import {tronWalletConnectTransaction} from 'dok-wallet-blockchain-networks/service/walletConnect/tronWalletConnect';
import {solanaWalletConnectTransaction} from 'dok-wallet-blockchain-networks/service/walletConnect/solanaWalletConnect';
import {showToast} from 'utils/toast';
import {tonWalletConnectTransaction} from 'dok-wallet-blockchain-networks/service/walletConnect/tonWalletConnect';
import {stellarWalletConnectTransaction} from 'dok-wallet-blockchain-networks/service/walletConnect/stellarWalletConnect';
import {rippleWalletConnectTransaction} from 'dok-wallet-blockchain-networks/service/walletConnect/rippleWalletConnect';
import {polkadotWalletConnectTransaction} from 'dok-wallet-blockchain-networks/service/walletConnect/polkadotWalletConnect';
import {cosmosWalletConnectTransaction} from 'dok-wallet-blockchain-networks/service/walletConnect/cosmosWalletConnect';
import {hederaWalletConnectTransaction} from 'dok-wallet-blockchain-networks/service/walletConnect/hederaWalletConnect';
import {aptosWalletConnectTransaction} from 'dok-wallet-blockchain-networks/service/walletConnect/aptosWalletConnect';
import {tezosWalletConnectTransaction} from 'dok-wallet-blockchain-networks/service/walletConnect/tezosWalletConnect';
import {bitcoinWalletConnectTransaction} from 'dok-wallet-blockchain-networks/service/walletConnect/bitcoinWalletConnect';

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
      domain,
    } = payload;
    const dispatch = thunkAPI.dispatch;
    let tx;
    let toastId;
    try {
      dispatch(setWalletConnectTransactionSubmit(true));
      toastId = showToast({
        type: 'progressToast',
        title: 'Sending transaction',
        message: 'Please wait...',
        autoHide: false,
      });
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
      } else if (method?.includes('ton')) {
        tx = await tonWalletConnectTransaction(
          method,
          transactionData,
          privateKey,
          signTypeData,
          domain,
        );
      } else if (method?.includes('stellar')) {
        tx = await stellarWalletConnectTransaction(
          method,
          transactionData,
          privateKey,
          signTypeData,
        );
      } else if (method?.includes('xrpl')) {
        tx = await rippleWalletConnectTransaction(
          method,
          transactionData,
          privateKey,
          signTypeData,
        );
      } else if (method?.includes('wallet_sendCalls')) {
        tx = await etherWalletConnectTransaction(
          method,
          transactionData,
          privateKey,
          chain_name,
          null,
        );
      } else if (method?.includes('polkadot')) {
        tx = await polkadotWalletConnectTransaction(
          method,
          transactionData,
          privateKey,
          signTypeData,
        );
      } else if (method?.includes('cosmos')) {
        tx = await cosmosWalletConnectTransaction(
          method,
          transactionData,
          privateKey,
          signTypeData,
        );
      } else if (method?.includes('hedera')) {
        tx = await hederaWalletConnectTransaction(
          method,
          transactionData,
          privateKey,
          signTypeData,
        );
      } else if (method?.includes('aptos')) {
        tx = await aptosWalletConnectTransaction(
          method,
          transactionData,
          privateKey,
          signTypeData,
        );
      } else if (method?.includes('tezos')) {
        tx = await tezosWalletConnectTransaction(
          method,
          transactionData,
          privateKey,
          signTypeData,
        );
      } else if (
        ['bitcoin', 'bitcoin_segwit', 'bitcoin_legacy'].includes(chain_name)
      ) {
        // bip122 methods (getAccountAddresses, signMessage, signPsbt,
        // sendTransfer) are not chain-prefixed, so dispatch on chain_name.
        tx = await bitcoinWalletConnectTransaction(
          method,
          transactionData,
          privateKey,
          signTypeData,
          chain_name,
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
      showToast({
        type: 'successToast',
        title: 'Transaction submitted',
        message: 'Your transaction was sent successfully',
        toastId,
      });
    } catch (error) {
      console.error('Error in create wallet trasaction', error);
      dispatch(setWalletConnectTransactionSubmit(false));
      showToast({
        type: 'errorToast',
        title: 'Transaction failed',
        message: error?.message || error,
        toastId,
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
