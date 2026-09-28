import {getEthereumCoin} from 'dok-wallet-blockchain-networks/redux/wallets/walletsSelector';
import {isValidObject} from 'dok-wallet-blockchain-networks/helper';
import {createSelector} from '@reduxjs/toolkit';

// Stable fallback: a fresh []/{} per call makes useSelector warn and rerender.
// Read-only - shared by every caller.
const EMPTY_ARRAY = [];
const EMPTY_OBJECT = {};

export const isFetchingConversations = state =>
  state.message.isFetchingConversations;

export const isFetchingMessages = state => state.message.isFetchingMessages;
export const isFetchingMoreMessages = state =>
  state.message.isFetchingMoreMessages;

export const isAllMessageLoaded = state => state.message.isAllMessageLoaded;
export const getConversations = createSelector(
  [
    state => getEthereumCoin(state)?.address,
    state => state?.message?.conversationData,
  ],
  (address, conversationData) => {
    if (!address) {
      return EMPTY_ARRAY;
    }
    const conversations = conversationData?.[address];
    const conversationsArr = isValidObject(conversations)
      ? Object.values(conversations)
      : [];
    return conversationsArr.sort((a, b) => {
      const aDate = a?.lastMessage?.createdAt || a?.createdAt;
      const bDate = b?.lastMessage?.createdAt || b?.createdAt;
      return new Date(bDate) - new Date(aDate);
    });
  },
);

export const getMessageData = state => state.message.messageData;
export const getConversationName = state =>
  state.message.conversationName || '';

export const getSelectedConversations = state => {
  const conversationData = state?.message?.conversationData;
  const selectedConversation = state?.message?.selectedConversation;
  return (
    conversationData?.[selectedConversation?.address]?.[
      selectedConversation.topic
    ] || EMPTY_OBJECT
  );
};
