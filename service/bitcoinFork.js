import {BlockCypher} from 'dok-wallet-blockchain-networks/service/blockCypher';
import {Mempool} from './mempool';
import {commonRetryFunc} from '../helper';
import {BlockDaemon} from './blockDaemon';
import {BlockChair} from './blockChair';
import {PremiumBlockChair} from './premiumBlockChair';

const providerName = {
  ltc: [
    'LitecoinSpace',
    'LitecoinBlockCypher',
    'LitecoinBlockChair',
    'LitecoinBlockDaemon',
    'LitecoinPremiumBlockChair',
  ],
  btc: [
    'BitcoinMempool',
    'BitcoinBlockChair',
    'BitcoinBlockDaemon',
    'BitcoinPremiumBlockChair',
  ],
  doge: [
    'DogeBlockChair',
    'DogeBlockCypher',
    'DogeBlockDaemon',
    'DogePremiumBlockChair',
  ],
  bch: [
    'BCHBlockChair',
    'BCHBlockDaemon',
    'BCHMempool',
    'BCHPremiumBlockChair',
  ],
};
const providers = {
  ltc: [Mempool, BlockCypher, BlockChair, BlockDaemon, PremiumBlockChair],
  btc: [Mempool, BlockChair, BlockDaemon, PremiumBlockChair],
  doge: [BlockChair, BlockCypher, BlockDaemon, PremiumBlockChair],
  bch: [BlockChair, BlockDaemon, Mempool, PremiumBlockChair],
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
