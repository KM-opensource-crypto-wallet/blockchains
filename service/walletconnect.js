// import {store} from 'redux/store';
import { store } from '../../src/redux/store';
import { Core } from '@walletconnect/core';
import { WalletKit } from '@reown/walletkit';
import {
  resetWalletConnect,
  setWalletConnectRequestData,
  setWalletConnectRequestModal,
  setWalletConnectTransactionData,
} from 'dok-wallet-blockchain-networks/redux/walletConnect/walletConnectSlice';
import { removeWalletConnectSession } from 'dok-wallet-blockchain-networks/redux/wallets/walletsSlice';
import { getSdkError } from '@walletconnect/utils';

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
  // await walletConnect.core.pairing.activate({topic: pairingObj.topic});
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
        .disconnect({ topic: topic })
        .then(r => { })
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
    const { id, params } = proposal;

    // console.log('propasdas', JSON.stringify(proposal));
    const { proposer, pairingTopic } = params;
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
    try {
      const { topic, params, id } = proposal;
      if (requestIds[id]) {
        return;
      }
      requestIds[id] = true;
      const { request } = params;
      if (request?.method?.includes('wallet_addEthereumChain')) {
        await walletConnect.respondSessionRequest({
          topic,
          response: {
            id,
            jsonrpc: '2.0',
            result: request?.params?.[0]?.chainId,
          },
        });
      } else {
        const requestSessionData =
          walletConnect.engine.signClient.session.get(topic);
        const { pairingTopic } = requestSessionData;
        const sessionId = pairingTopic + '';
        store.dispatch(
          setWalletConnectTransactionData({
            sessionId,
            topic,
            ...request,
            sessionData: requestSessionData,
            peerMeta: requestSessionData?.peer?.metadata,
            id,
            chainId: params?.chainId,
          }),
        );
      }
    } catch (e) {
      console.error('Error in onSessionRequest', e);
    }
  };

  const onSessionDelete = proposal => {
    try {
      const { topic } = proposal;
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
