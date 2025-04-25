import {getAllBlockchairAPI} from './dokApi';

export const PremiumBlockChair = {
  getBalance: async ({chain, address}) => {
    return getAllBlockchairAPI({
      type: 'getBalance',
      chain,
      address,
    });
  },

  getTransactions: async ({chain, address}) => {
    return getAllBlockchairAPI({
      type: 'getTransactions',
      chain,
      address,
    });
  },

  getUTXO: async ({chain, address}) => {
    return getAllBlockchairAPI({
      type: 'getUTXO',
      chain,
      address,
    });
  },
  fetchTransactionDetails: async ({chain, transactionData}) => {
    return getAllBlockchairAPI({
      type: 'fetchTransactionDetails',
      chain,
      transactionData,
    });
  },
  createTransaction: async ({chain, txHex}) => {
    return getAllBlockchairAPI({
      type: 'createTransaction',
      chain,
      txHex,
    });
  },
  getTransaction: async ({chain, transactionId}) => {
    return getAllBlockchairAPI({
      type: 'getTransaction',
      chain,
      transactionId,
    });
  },
  getTransactionFees: async ({chain}) => {
    return getAllBlockchairAPI({
      type: 'getTransactionFees',
      chain,
    });
  },
};
