import {store} from 'redux/store';
import {Core} from '@walletconnect/core';
import {WalletKit} from '@reown/walletkit';
import {
  resetWalletConnect,
  setWalletConnectRequestData,
  setWalletConnectRequestModal,
  setWalletConnectTransactionData,
} from 'dok-wallet-blockchain-networks/redux/walletConnect/walletConnectSlice';
import {removeWalletConnectSession} from 'dok-wallet-blockchain-networks/redux/wallets/walletsSlice';
import {getSdkError} from '@walletconnect/utils';
import {isSupportedWalletConnectMethod} from 'dok-wallet-blockchain-networks/config/config';
import {showToast} from 'utils/toast';
import {logWalletConnectEvent} from 'utils/logger';

let walletConnectSubscribe = false;

export const WALLETCONNECT_EVENT = {
  SESSION_PROPOSAL: 'session_proposal',
  SESSION_REQUEST: 'session_request',
  SESSION_DELETE: 'session_delete',
};
let walletConnect;

export const initWalletConnect = async walletConnectData => {
  const core = new Core({
    projectId: walletConnectData?.id,
  });
  walletConnect = await WalletKit.init({
    core,
    metadata: walletConnectData?.metadata,
  });
};

export const createWalletConnection = async options => {
  await walletConnect.core.pairing.pair(options);
  subscribeWalletConnectEvent();
};

export const subscribeWalletConnect = async appSessions => {
  if (walletConnectSubscribe) {
    return;
  }
  walletConnectSubscribe = true;

  const sessions = walletConnect.getActiveSessions();
  const allTopics = Object.values(appSessions).map(item => item.topic);
  const activeTopics = Object.values(sessions).map(item => item.topic);
  allTopics.forEach(topic => {
    const activeSession = sessions[topic];
    if (activeSession) {
      subscribeWalletConnectEvent();
    } else {
      const foundSession = Object.values(appSessions).find(
        subItem => subItem.topic === topic,
      );
      const sessionId = foundSession?.pairingTopic;
      store.dispatch(resetWalletConnect());
      sessionId && store.dispatch(removeWalletConnectSession(sessionId));
    }
  });
  activeTopics.forEach(topic => {
    if (!allTopics.includes(topic)) {
      walletConnect.disconnectSession({
        topic,
        reason: getSdkError('USER_DISCONNECTED'),
      });
      walletConnect.core.pairing
        .disconnect({topic: topic})
        .then(r => {})
        .catch(e => {
          console.error('Error disconnecting session:', e);
        });
    }
  });
};

export const getWalletConnect = () => {
  return walletConnect;
};

export const subscribeWalletConnectEvent = () => {
  let requestIds = {};
  if (!walletConnect) {
    console.warn('No event subscribe because wallet connect null');
    return;
  }
  const onSessionProposal = proposal => {
    const {id, params} = proposal;

    // console.log('propasdas', JSON.stringify(proposal));
    const {proposer, pairingTopic} = params;
    const sessionId = pairingTopic + '';
    const requiredNamespaces = params?.requiredNamespaces;
    const optionalNamespaces = params?.optionalNamespaces;
    const relays = params?.relays;
    store.dispatch(setWalletConnectRequestModal(true));
    store.dispatch(
      setWalletConnectRequestData({
        ...proposer.metadata,
        id,
        requiredNamespaces,
        optionalNamespaces,
        relays,
        sessionId,
      }),
    );
  };
  const onSessionRequest = async proposal => {
    const {topic, params, id} = proposal;
    const {request} = params || {};
    try {
      if (requestIds[id]) {
        return;
      }
      requestIds[id] = true;
      const requestSessionData =
        walletConnect.engine.signClient.session.get(topic);
      const peerMeta = requestSessionData?.peer?.metadata;

      // Reject methods this wallet cannot answer before any UI opens.
      // JSON-RPC -32601 ("Method not found") is what the WalletKit docs use
      // for unsupported session_request methods.
      if (!isSupportedWalletConnectMethod(request?.method)) {
        logWalletConnectEvent('warn', 'session_request.unsupported_method', {
          method: request?.method,
          chainId: params?.chainId,
          topic,
          requestId: id,
          peerName: peerMeta?.name,
          peerUrl: peerMeta?.url,
        });
        showToast({
          type: 'errorToast',
          title: 'Unsupported request',
          message: `${peerMeta?.name || 'The dApp'} requested ${
            request?.method
          }, which this wallet does not support.`,
        });
        await walletConnect.respondSessionRequest({
          topic,
          response: {
            id,
            jsonrpc: '2.0',
            error: {
              code: -32601,
              message: `Method ${request?.method} not supported`,
              data: {method: request?.method, chainId: params?.chainId},
            },
          },
        });
        return;
      }

      if (request?.method?.includes('wallet_addEthereumChain')) {
        await walletConnect.respondSessionRequest({
          topic,
          response: {
            id,
            jsonrpc: '2.0',
            result: request?.params?.[0]?.chainId,
          },
        });
      } else if (request?.method?.includes('wallet_getCapabilities')) {
        const chainIds = request?.params?.[1];

        const capabilities = {};
        (chainIds || []).forEach(chainId => {
          capabilities[chainId] = {
            atomicBatch: {supported: true},
          };
        });

        await walletConnect.respondSessionRequest({
          topic,
          response: {id, jsonrpc: '2.0', result: capabilities},
        });
      } else {
        const {pairingTopic} = requestSessionData;
        const sessionId = pairingTopic + '';
        store.dispatch(
          setWalletConnectTransactionData({
            sessionId,
            topic,
            ...request,
            sessionData: requestSessionData,
            peerMeta,
            id,
            chainId: params?.chainId,
          }),
        );
      }
    } catch (e) {
      console.error('Error in onSessionRequest', e);
      logWalletConnectEvent('error', 'session_request.handler_error', {
        method: request?.method,
        chainId: params?.chainId,
        topic,
        requestId: id,
        message: e?.message,
      });
    }
  };

  const onSessionDelete = proposal => {
    try {
      const {topic} = proposal;
      const state = store.getState();
      const allWallets = state?.wallets?.allWallets || [];
      allWallets.forEach(currentWallet => {
        const allSessions = currentWallet?.session || {};
        const allSessionKeys = Object.keys(allSessions);
        for (let i = 0; i < allSessionKeys.length; i++) {
          const sessionId = allSessionKeys[i];
          const currentSession = allSessions[sessionId];
          if (currentSession.topic === topic) {
            store.dispatch(resetWalletConnect());
            sessionId && store.dispatch(removeWalletConnectSession(sessionId));
          }
        }
      });
    } catch (e) {
      console.error('error in delete wallet connect session', e);
    }
  };

  walletConnect.on(WALLETCONNECT_EVENT.SESSION_PROPOSAL, onSessionProposal);

  walletConnect.on(WALLETCONNECT_EVENT.SESSION_REQUEST, onSessionRequest);

  walletConnect.on(WALLETCONNECT_EVENT.SESSION_DELETE, onSessionDelete);
};
