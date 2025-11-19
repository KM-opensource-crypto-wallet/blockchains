import { createAsyncThunk, createSlice } from '@reduxjs/toolkit';
import { getEthereumCoin } from 'dok-wallet-blockchain-networks/redux/wallets/walletsSelector';
import { getChain } from 'dok-wallet-blockchain-networks/cryptoChain';
import { XMTP } from '../../../src/utils/xmtp';

/*
Conversation data structure
conversationData:{
[address]:{
    conversations: {
        messages: [MESSAGE_DETAILS],
        lastMessage: MESSAGE_DETAILS,
        peerAddress,
        topic,
    }
}
 */

/*
Message data structure
messageData:{
    topic: [MESSAGE_DETAILS]

}
 */

const initialState = {
  isFetchingConversations: false,
  isFetchingMessages: false,
  isFetchingMoreMessages: false,
  isAllMessageLoaded: false,
  isUpdatingConsentState: false,
  isForwardingMessage: false,
  conversationData: {},
  messageData: {},
  selectedConversation: {
    address: null,
    topic: null,
  },
  conversationName: {},
};

export const getConversation = createAsyncThunk(
  'message/getConversation',
  async (payload, thunkAPI) => {
    const dispatch = thunkAPI.dispatch;
    try {
      dispatch(setIsFetchingConversation(true));
      const currentState = thunkAPI.getState();
      const ethereumCoin = getEthereumCoin(currentState);
      if (!ethereumCoin?.privateKey) {
        console.warn('No ethereum chain found');
        throw new Error('No ethereum chain found');
      }
      const etherChain = getChain('ethereum');
      const wallet = etherChain?.getWallet({
        privateKey: ethereumCoin?.privateKey,
      });
      await XMTP.initializeClient({
        wallet: wallet,
        address: ethereumCoin?.address,
      });
      const conversations = await XMTP.getConversations();
      const allTopics = conversations.map(({ topic }) => topic);
      const lastMessages = await Promise.all(
        allTopics.map(async topic => await XMTP.getMessages({ topic, limit: 1 })),
      );
      return { conversations, lastMessages, address: ethereumCoin?.address };
    } catch (e) {
      console.log('error in getMessageConversation', e);
      return thunkAPI.rejectWithValue('something went wrong');
    }
  },
);

export const getMessage = createAsyncThunk(
  'message/getMessage',
  async (payload, thunkAPI) => {
    const dispatch = thunkAPI.dispatch;
    try {
      dispatch(setIsFetchingMessage(true));
      const { topic } = payload;
      const messages = await XMTP.getMessages({ topic, limit: 20 });
      thunkAPI.dispatch(setMessagesToConversation({ messages, topic }));
    } catch (e) {
      console.log('error in getMessageConversation', e);
      thunkAPI.dispatch(setIsFetchingMessage(false));
      return thunkAPI.rejectWithValue('something went wrong');
    }
  },
);

export const getMoreMessages = createAsyncThunk(
  'message/getMoreMessages',
  async (payload, thunkAPI) => {
    const dispatch = thunkAPI.dispatch;
    try {
      dispatch(setIsFetchingMoreMessage(true));
      const { topic, lastMessageDate, prevMessages, limit = 20 } = payload;
      const messages = await XMTP.getMessages({
        topic,
        limit,
        before: lastMessageDate,
        prevMessages,
      });
      thunkAPI.dispatch(
        addMessagesToConversation({ messages, topic, skipLastMessage: true }),
      );
    } catch (e) {
      console.log('error in getMoreMessages', e);
      thunkAPI.dispatch(setIsFetchingMoreMessage(false));
      return thunkAPI.rejectWithValue('something went wrong');
    }
  },
);

export const updateConsentState = createAsyncThunk(
  'message/updateConsentState',
  async (payload, thunkAPI) => {
    const dispatch = thunkAPI.dispatch;
    try {
      dispatch(setIsUpdatingConsentState(true));
      const { topic, address, consentState, peerAddress } = payload;
      if (consentState !== 'denied' && consentState !== 'allowed') {
        return console.error(
          'consentState must be one of this allowed or denied  ',
        );
      }
      let results;
      if (consentState === 'denied') {
        results = await XMTP.blockConversation({
          peerAddress,
        });
      } else {
        results = await XMTP.unBlockConversation({
          peerAddress,
        });
      }

      thunkAPI.dispatch(
        updateConversation({ address, topic, conversationData: { consentState } }),
      );
      thunkAPI.dispatch(getConversation());
    } catch (e) {
      console.log('error in getMoreMessages', e);
      thunkAPI.dispatch(setIsFetchingMoreMessage(false));
      return thunkAPI.rejectWithValue('something went wrong');
    }
  },
);

export const forwardMessages = createAsyncThunk(
  'message/forwardMessages',
  async (payload, thunkAPI) => {
    const dispatch = thunkAPI.dispatch;
    try {
      dispatch(setIsForwardingMessage(true));
      const { conversations, messages } = payload;
      if (
        !Array.isArray(conversations) ||
        !conversations.length ||
        !Array.isArray(messages) ||
        !messages.length
      ) {
        throw new Error('conversations and messages must be non-empty arrays');
      }
      if (!conversations.every(conv => conv?.topic && conv?.peerAddress)) {
        throw new Error('invalid conversation format');
      }
      for (let conversation of conversations) {
        const convObj = await XMTP.getConversation({
          topic: conversation?.topic,
          peerAddress: conversation?.peerAddress,
          createdAt: conversation?.createdAt,
          version: conversation?.version,
        });
        messages.forEach(async message => {
          await convObj.send(message);
        });
      }
      thunkAPI.dispatch(getConversation());
    } catch (e) {
      console.log('error in forwadingMessage', e);
      thunkAPI.dispatch(setIsForwardingMessage(false));
      return thunkAPI.rejectWithValue('something went wrong');
    }
  },
);

export const messageSlice = createSlice({
  name: 'message',
  initialState,
  reducers: {
    setIsFetchingConversation(state, { payload }) {
      state.isFetchingConversations = payload;
    },
    setIsFetchingMessage(state, { payload }) {
      state.isFetchingMessages = payload;
      if (payload) {
        state.isAllMessageLoaded = false;
      }
    },
    setIsFetchingMoreMessage(state, { payload }) {
      state.isFetchingMoreMessages = payload;
      if (payload) {
        state.isAllMessageLoaded = false;
      }
    },
    setIsUpdatingConsentState(state, { payload }) {
      state.isUpdatingConsentState = payload;
    },
    setIsForwardingMessage(state, { payload }) {
      state.isForwardingMessage = payload;
    },
    setSelectedConversation(state, { payload }) {
      state.selectedConversation = {
        address: payload?.address,
        topic: payload?.topic,
      };
    },
    setMessagesToConversation(state, { payload }) {
      state.isFetchingMessages = false;
      const { topic, messages } = payload;
      if (topic && Array.isArray(messages)) {
        state.messageData[topic] = messages;
        state.isAllMessageLoaded = messages.length < 20;
      } else {
        console.warn(
          'some payload is missing setMessagesToConversation',
          payload,
        );
      }
    },
    addMessagesToConversation(state, { payload }) {
      const { topic, messages, address, skipLastMessage } = payload;
      state.isFetchingMessages = false;
      state.isFetchingMoreMessages = false;
      if (topic && Array.isArray(messages)) {
        const previousMessages = state.messageData[topic]
          ? [...state.messageData[topic]]
          : [];
        state.isAllMessageLoaded = messages.length < 20;
        state.messageData[topic] = skipLastMessage
          ? [...previousMessages, ...messages]
          : [...messages, ...previousMessages];
        if (!skipLastMessage && address) {
          const tempConversationData = state.conversationData[address]
            ? { ...state.conversationData[address] }
            : {};
          const finalConvData = tempConversationData[topic]
            ? { ...tempConversationData[topic] }
            : {};
          finalConvData.lastMessage = messages[0];
          tempConversationData[topic] = finalConvData;
          state.conversationData[address] = tempConversationData;
        }
      } else {
        console.warn(
          'some payload is missing addMessagesToConversation',
          payload,
        );
      }
    },
    addConversation(state, { payload }) {
      const { topic, conversationData, address } = payload;
      state.isFetchingMessages = false;
      if (topic && conversationData && address) {
        const tempConversationData = state.conversationData[address]
          ? { ...state.conversationData[address] }
          : {};
        tempConversationData[topic] = conversationData;
        state.conversationData[address] = tempConversationData;
      } else {
        console.warn('some payload is missing addConversations', payload);
      }
    },
    updateConversation(state, { payload }) {
      const { topic, conversationData, address } = payload;
      if (topic && conversationData && address) {
        const tempConversationData = state.conversationData[address]
          ? { ...state.conversationData[address] }
          : {};
        const previousConversationData = tempConversationData[topic];
        tempConversationData[topic] = {
          ...previousConversationData,
          ...conversationData,
        };
        state.conversationData[address] = tempConversationData;
      } else {
        console.warn('some payload is missing addConversations', payload);
      }
    },
    addConversationsName(state, { payload }) {
      const { name } = payload;
      const conversationData = state?.conversationData;
      const selectedConversation = state?.selectedConversation;
      const selectedConversationData =
        conversationData?.[selectedConversation?.address] || {};
      const selectCon =
        selectedConversationData[selectedConversation.topic] || {};
      const peerAddress = selectCon?.peerAddress;

      if (typeof name === 'string' && peerAddress) {
        state.conversationName[peerAddress] = name;
        const updatedCon = { ...selectCon, name };
        state.conversationData[selectedConversation?.address] = {
          ...selectedConversationData,
          [selectedConversation.topic]: updatedCon,
        };
      } else {
        console.warn('some payload is missing addConversationsName', payload);
      }
    },
  },
  extraReducers: builder => {
    builder.addCase(getConversation.fulfilled, (state, { payload }) => {
      const { conversations, lastMessages, address } = payload;
      const conversationName = state.conversationName;
      const finalConversations = {};
      for (let i = 0; i < conversations.length; i++) {
        const tempConversation = conversations[i];
        if (!tempConversation) {
          continue;
        }
        const { peerAddress, topic } = tempConversation;
        const tempMessage = lastMessages[i];
        finalConversations[topic] = {
          ...tempConversation,
          lastMessage: tempMessage?.[0],
          name: conversationName[peerAddress] || '',
        };
      }
      const tempMessageData = { ...state.conversationData };
      const finalConvData = tempMessageData.conversations
        ? { ...tempMessageData.conversations, finalConversations }
        : finalConversations;
      state.conversationData = {
        ...tempMessageData,
        [address]: finalConvData,
      };
      state.isFetchingConversations = false;
    });
    builder.addCase(getConversation.rejected, (state, { payload }) => {
      state.isFetchingConversations = false;
    });
  },
});

export const {
  setIsFetchingConversation,
  setIsFetchingMessage,
  addMessagesToConversation,
  setMessagesToConversation,
  addConversation,
  setIsFetchingMoreMessage,
  setIsUpdatingConsentState,
  updateConversation,
  setSelectedConversation,
  addConversationsName,
  setIsForwardingMessage,
} = messageSlice.actions;
