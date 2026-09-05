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
import {
  CHAIN_CONFIG,
  isSupportedWalletConnectMethod,
} from 'dok-wallet-blockchain-networks/config/config';
import {
  answerAddEthereumChain,
  answerSwitchEthereumChain,
} from 'dok-wallet-blockchain-networks/helper/walletConnectEvmChain';
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

// wallet_sendCalls (EIP-5792) is only atomic where a batch contract is
// deployed. Both environments' chain ids are listed; the session itself only
// ever contains the current environment's chains.
const BATCH_CAPABLE_CHAIN_IDS = new Set(
  Object.values(CHAIN_CONFIG)
    .filter(cfg => cfg.batch_contract && cfg.chain_id)
    .flatMap(cfg =>
      ['sandbox', 'production']
        .filter(env => cfg.batch_contract[env] && cfg.chain_id[env])
        .map(env => Number(cfg.chain_id[env])),
    ),
);
const supportsAtomicBatch = hexChainId =>
  BATCH_CAPABLE_CHAIN_IDS.has(Number.parseInt(hexChainId, 16));

// Read-only methods the handler answers itself. If one of them throws, nobody
// else will ever reply, so the dApp would wait for the relay timeout.
const AUTO_ANSWERED_METHODS = new Set([
  'wallet_getCapabilities',
  'hedera_getNodeAddresses',
]);

export const subscribeWalletConnectEvent = () => {
  let requestIds = {};
  if (!walletConnect) {
    console.warn('No event subscribe because wallet connect null');
    return;
  }
  const onSessionProposal = proposal => {
    const {id, params} = proposal;

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

      if (request?.method === 'wallet_addEthereumChain') {
        // EIP-3085: null on success; only chains this wallet can serve.
        await walletConnect.respondSessionRequest({
          topic,
          response: {
            id,
            jsonrpc: '2.0',
            ...answerAddEthereumChain(request?.params),
          },
        });
      } else if (request?.method === 'wallet_switchEthereumChain') {
        // EIP-3326: null when the session covers the chain, 4902 otherwise.
        await walletConnect.respondSessionRequest({
          topic,
          response: {
            id,
            jsonrpc: '2.0',
            ...answerSwitchEthereumChain(requestSessionData, request?.params),
          },
        });
      } else if (request?.method === 'wallet_getCapabilities') {
        const chainIds = request?.params?.[1];

        const capabilities = {};
        (chainIds || []).forEach(chainId => {
          // EIP-5792 final: `atomic.status`, not the draft `atomicBatch`.
          // 'ready' (upgradeable via EIP-7702) never applies here.
          capabilities[chainId] = {
            atomic: {
              status: supportsAtomicBatch(chainId)
                ? 'supported'
                : 'unsupported',
            },
          };
        });

        await walletConnect.respondSessionRequest({
          topic,
          response: {id, jsonrpc: '2.0', result: capabilities},
        });
      } else if (request?.method === 'hedera_getNodeAddresses') {
        // HIP-820 read-only method: no signature, nothing to approve.
        const {
          HederaChain,
        } = require('dok-wallet-blockchain-networks/cryptoChain/chains/HederaChain');
        const result = await HederaChain().getNodeAddresses({
          network: params?.chainId?.split(':')?.[1],
        });
        await walletConnect.respondSessionRequest({
          topic,
          response: {id, jsonrpc: '2.0', result},
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
      if (AUTO_ANSWERED_METHODS.has(request?.method)) {
        try {
          await walletConnect.respondSessionRequest({
            topic,
            response: {
              id,
              jsonrpc: '2.0',
              error: {
                code: -32603,
                message: e?.message || 'Internal error',
                data: {method: request?.method, chainId: params?.chainId},
              },
            },
          });
        } catch (replyError) {
          // The relay itself is failing; the handler error is already logged.
          logWalletConnectEvent('error', 'session_request.error_reply_failed', {
            method: request?.method,
            chainId: params?.chainId,
            topic,
            requestId: id,
            message: replyError?.message,
          });
        }
      }
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
