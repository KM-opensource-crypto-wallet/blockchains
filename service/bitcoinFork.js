import {BlockCypher} from 'dok-wallet-blockchain-networks/service/blockCypher';
import {Mempool} from './mempool';
import {commonRetryFunc} from '../helper';
import {BlockDaemon} from './blockDaemon';
import {BlockChair} from './blockChair';
import {PremiumBlockChair} from './premiumBlockChair';

const providerName = {
  ltc: [
    'LitecoinPremiumBlockChair',
    'LitecoinSpace',
    'LitecoinBlockCypher',
    'LitecoinBlockChair',
    'LitecoinBlockDaemon',
  ],
  btc: [
    'BitcoinPremiumBlockChair',
    'BitcoinMempool',
    'BitcoinBlockChair',
    'BitcoinBlockDaemon',
  ],
  doge: [
    'DogePremiumBlockChair',
    'DogeBlockChair',
    'DogeBlockCypher',
    'DogeBlockDaemon',
  ],
  bch: [
    'BCHPremiumBlockChair',
    'BCHBlockChair',
    'BCHBlockDaemon',
    'BCHMempool',
  ],
};
const providers = {
  ltc: [PremiumBlockChair, Mempool, BlockCypher, BlockChair, BlockDaemon],
  btc: [PremiumBlockChair, Mempool, BlockChair, BlockDaemon],
  doge: [PremiumBlockChair, BlockChair, BlockCypher, BlockDaemon],
  bch: [PremiumBlockChair, BlockChair, BlockDaemon, Mempool],
};

export const BitcoinFork = {
  getBalance: ({chain, address}) =>
    commonRetryFunc(
      providers[chain],
      async provider => {
        return await provider.getBalance({chain, address});
      },
      '0',
      providerName[chain],
    ),
  getTransactions: ({chain, address, derive_addresses}) =>
    commonRetryFunc(
      providers[chain],
      async provider => {
        return await provider.getTransactions({
          chain,
          address,
          derive_addresses,
        });
      },
      [],
      providerName[chain],
    ),
  getUTXO: ({chain, address}) =>
    commonRetryFunc(
      providers[chain],
      async provider => {
        return await provider.getUTXO({chain, address});
      },
      null,
      providerName[chain],
    ),
  fetchTransactionDetails: ({chain, transactionData, address}) =>
    commonRetryFunc(
      providers[chain],
      async provider => {
        return await provider.fetchTransactionDetails({
          chain,
          transactionData,
          address,
        });
      },
      null,
      providerName[chain],
    ),
  getTransactionFees: ({chain}) =>
    commonRetryFunc(
      providers[chain],
      async provider => {
        return await provider.getTransactionFees({chain});
      },
      null,
      providerName[chain],
    ),
  createTransaction: ({chain, txHex}) =>
    commonRetryFunc(
      providers[chain],
      async provider => {
        return await provider.createTransaction({chain, txHex});
      },
      null,
      providerName[chain],
    ),
  getTransaction: ({chain, transactionId}) =>
    commonRetryFunc(
      providers[chain],
      async provider => {
        return await provider.getTransaction({chain, transactionId});
      },
      null,
      providerName[chain],
    ),
};
