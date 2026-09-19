import {BlockCypher} from 'dok-wallet-blockchain-networks/service/bitcoinFork/blockCypher';
import {Mempool} from './mempool';
import {commonRetryFunc} from '../../helper';
import {BlockDaemon} from './blockDaemon';
import {BlockChair} from './blockChair';
import {PremiumBlockChair} from './premiumBlockChair';
import {Cipherscan} from './cipherscan';

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
  zec: ['ZcashPremiumBlockChair', 'ZcashCipherscan', 'ZcashBlockChair'],
};
const providers = {
  ltc: [PremiumBlockChair, Mempool, BlockCypher, BlockChair, BlockDaemon],
  btc: [PremiumBlockChair, Mempool, BlockChair, BlockDaemon],
  doge: [PremiumBlockChair, BlockChair, BlockCypher, BlockDaemon],
  bch: [PremiumBlockChair, BlockChair, BlockDaemon],
  zec: [PremiumBlockChair, Cipherscan, BlockChair],
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
  // No defaultResponse: unlike the other calls here, a broadcast failure
  // must surface the last provider's actual rejection reason (bad-txns-*,
  // insufficient fee, etc.) rather than being swallowed into a fallback
  // value -- a caller can't do anything useful with a `null` "did it work?".
  createTransaction: ({chain, txHex}) =>
    commonRetryFunc(
      providers[chain],
      async provider => {
        return await provider.createTransaction({chain, txHex});
      },
      undefined,
      providerName[chain],
    ),
  getTransaction: ({chain, transactionId, address, derive_addresses}) =>
    commonRetryFunc(
      providers[chain],
      async provider => {
        return await provider.getTransaction({
          chain,
          transactionId,
          address,
          derive_addresses,
        });
      },
      null,
      providerName[chain],
    ),
};
