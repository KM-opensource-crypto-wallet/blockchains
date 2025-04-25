import {getEthereumCoin} from 'dok-wallet-blockchain-networks/redux/wallets/walletsSelector';
import {isValidObject} from 'dok-wallet-blockchain-networks/helper';

export const isFetchingConversations = state =>
  state.message.isFetchingConversations;

export const isFetchingMessages = state => state.message.isFetchingMessages;
export const isFetchingMoreMessages = state =>
  state.message.isFetchingMoreMessages;

export const isAllMessageLoaded = state => state.message.isAllMessageLoaded;
export const getConversations = state => {
  const ethereumCoin = getEthereumCoin(state);
  const address = ethereumCoin?.address;
  if (!address) {
    return [];
  }
  const conversations = state?.message?.conversationData?.[address];
  const conversationsArr = isValidObject(conversations)
    ? Object.values(conversations)
    : [];
  return conversationsArr.sort((a, b) => {
    const aDate = a?.lastMessage?.createdAt || a?.createdAt;
    const bDate = b?.lastMessage?.createdAt || b?.createdAt;
    return new Date(bDate) - new Date(aDate);
  });
};

export const getMessageData = state => state.message.messageData;
export const getConversationName = state =>
  state.message.conversationName || '';

export const getSelectedConversations = state => {
  const conversationData = state?.message?.conversationData;
  const selectedConversation = state?.message?.selectedConversation;
  return (
    conversationData?.[selectedConversation?.address]?.[
      selectedConversation.topic
    ] || {}
  );
};
