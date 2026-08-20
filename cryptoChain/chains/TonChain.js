import {
  convertToSmallAmount,
  getExplorerTxUrl,
  isValidStringWithValue,
  parseBalance,
} from 'dok-wallet-blockchain-networks/helper';
import {
  TonClient,
  WalletContractV4,
  Address,
  internal,
  SendMode,
  JettonMaster,
  beginCell,
  toNano,
  Cell,
  loadStateInit,
  storeStateInit,
} from '@ton/ton';
import {keyPairFromSeed, sign, sha256_sync} from '@ton/crypto';
import {getRPCUrl} from 'dok-wallet-blockchain-networks/rpcUrls/rpcUrls';
import BigNumber from 'bignumber.js';
import {TonScan} from 'dok-wallet-blockchain-networks/service/tonScan';
import {WL_APP_NAME} from 'utils/wlData';

const findTxHashBySeqno = async (tonClient, address, seqno) => {
  const txs = await tonClient.getTransactions(address, {limit: 20});
  for (const tx of txs) {
    if (!tx.inMessage?.body) {
      continue;
    }
    try {
      const slice = tx.inMessage.body.beginParse();
      slice.loadBits(512); // skip ed25519 signature
      slice.loadUint(32); // subwallet_id
      slice.loadUint(32); // valid_untilconst txSeqno = slice.loadUint(32);
      const txSeqno = slice.loadUint(32);
      if (txSeqno === seqno) {
        return tx.hash().toString('hex');
      }
    } catch {
      console.error('errro in process ton transctions', seqno);
    }
  }
  return null;
};

const getDomainFromUrl = url => {
  return (url || '').replace(/^[a-zA-Z]+:\/\//, '').split(/[/?#]/)[0];
};

// message = 0xffff || "ton-connect/sign-data/" || workchain || address_hash
//   || domain_len || domain || timestamp || type_prefix || payload_len || payload
const createTextBinaryHash = ({
  type,
  content,
  workChain,
  addressHash,
  domain,
  timestamp,
}) => {
  // eslint-disable-next-line no-undef
  const wcBuffer = Buffer.alloc(4);
  wcBuffer.writeInt32BE(workChain);

  // eslint-disable-next-line no-undef
  const domainBuffer = Buffer.from(domain, 'utf8');
  // eslint-disable-next-line no-undef
  const domainLenBuffer = Buffer.alloc(4);
  domainLenBuffer.writeUInt32BE(domainBuffer.length);

  // eslint-disable-next-line no-undef
  const tsBuffer = Buffer.alloc(8);
  tsBuffer.writeBigUInt64BE(BigInt(timestamp));

  // eslint-disable-next-line no-undef
  const typePrefix = Buffer.from(type === 'text' ? 'txt' : 'bin');
  // eslint-disable-next-line no-undef
  const payloadBuffer = Buffer.from(
    content,
    type === 'text' ? 'utf8' : 'base64',
  );
  // eslint-disable-next-line no-undef
  const payloadLenBuffer = Buffer.alloc(4);
  payloadLenBuffer.writeUInt32BE(payloadBuffer.length);

  // eslint-disable-next-line no-undef
  const message = Buffer.concat([
    // eslint-disable-next-line no-undef
    Buffer.from([0xff, 0xff]),
    // eslint-disable-next-line no-undef
    Buffer.from('ton-connect/sign-data/'),
    wcBuffer,
    addressHash,
    domainLenBuffer,
    domainBuffer,
    tsBuffer,
    typePrefix,
    payloadLenBuffer,
    payloadBuffer,
  ]);

  return sha256_sync(message);
};

export const TonChain = () => {
  const tonClient = new TonClient({
    endpoint: getRPCUrl('ton'),
    apiKey: getRPCUrl('ton_api_key'),
  });

  return {
    isValidAddress: ({address}) => {
      try {
        return !!Address.parse(address);
      } catch (e) {
        return false;
      }
    },
    isValidPrivateKey: async ({privateKey}) => {
      try {
        // eslint-disable-next-line no-undef
        return !!keyPairFromSeed(Buffer.from(privateKey, 'hex'));
      } catch (e) {
        return false;
      }
    },
    createWalletByPrivateKey: async ({privateKey}) => {
      // eslint-disable-next-line no-undef
      const keyPair = keyPairFromSeed(Buffer.from(privateKey, 'hex'));
      const wallet = WalletContractV4.create({
        publicKey: keyPair.publicKey,
        workchain: 0,
      });
      return {
        address: wallet?.address?.toString(),
        privateKey: privateKey,
      };
    },
    getSessionProperties: ({privateKey}) => {
      // eslint-disable-next-line no-undef
      const keyPair = keyPairFromSeed(Buffer.from(privateKey, 'hex'));
      const wallet = WalletContractV4.create({
        publicKey: keyPair.publicKey,
        workchain: 0,
      });
      // eslint-disable-next-line no-undef
      const ton_getPublicKey = Buffer.from(keyPair.publicKey).toString('hex');
      const stateInitCell = beginCell()
        .store(storeStateInit(wallet.init))
        .endCell();
      const ton_getStateInit = stateInitCell.toBoc().toString('base64');
      return {ton_getPublicKey, ton_getStateInit};
    },
    sendRawTransaction: async ({payload, privateKey}) => {
      try {
        // eslint-disable-next-line no-undef
        const keyPair = keyPairFromSeed(Buffer.from(privateKey, 'hex'));
        const wallet = WalletContractV4.create({
          publicKey: keyPair.publicKey,
          workchain: 0,
        });
        const walletContract = tonClient.open(wallet);
        const seqno = await walletContract.getSeqno();
        const messages = (payload?.messages || []).map(msg => {
          const body = msg.payload ? Cell.fromBase64(msg.payload) : undefined;
          const init = msg.stateInit
            ? loadStateInit(Cell.fromBase64(msg.stateInit).beginParse())
            : undefined;
          return internal({
            to: msg.address,
            value: BigInt(msg.amount),
            body,
            init,
            bounce: false,
          });
        });
        const transfer = walletContract.createTransfer({
          sendMode: SendMode.PAY_GAS_SEPARATELY,
          secretKey: keyPair.secretKey,
          seqno,
          messages,
        });
        await walletContract.send(transfer);
        return {boc: transfer.toBoc().toString('base64')};
      } catch (e) {
        console.error('Error in ton sendMessage', e);
        throw e;
      }
    },
    signMessage: async ({signTypeData, privateKey, domain}) => {
      try {
        const data = Array.isArray(signTypeData)
          ? signTypeData[0]
          : signTypeData;
        // eslint-disable-next-line no-undef
        const keyPair = keyPairFromSeed(Buffer.from(privateKey, 'hex'));
        const wallet = WalletContractV4.create({
          publicKey: keyPair.publicKey,
          workchain: 0,
        });
        const timestamp = Math.floor(Date.now() / 1000);
        const parsedDomain = getDomainFromUrl(domain);
        let messageHash;
        if (data?.type === 'text' || data?.type === 'binary') {
          messageHash = createTextBinaryHash({
            type: data.type,
            content: data.type === 'text' ? data.text : data.bytes,
            workChain: wallet.address.workChain,
            addressHash: wallet.address.hash,
            domain: parsedDomain,
            timestamp,
          });
        } else {
          throw new Error('Unsupported ton_signData type');
        }
        const signature = sign(messageHash, keyPair.secretKey);
        return {
          // eslint-disable-next-line no-undef
          signature: Buffer.from(signature).toString('base64'),
          address: wallet.address.toString(),
          timestamp,
          domain: parsedDomain,
          payload: data,
        };
      } catch (e) {
        console.error('Error in ton signData', e);
        throw e;
      }
    },
    getBalance: async ({address}) => {
      try {
        const balance = await tonClient.getBalance(address);
        return balance?.toString() || '0';
      } catch (e) {
        console.error('error in get balance from ton', e);
        return '0';
      }
    },
    getTokenBalance: async ({address, contractAddress}) => {
      try {
        const parseContractAddress = Address.parse(contractAddress);
        const parseAddress = Address.parse(address);
        const jettonMaster = tonClient.open(
          JettonMaster.create(parseContractAddress),
        );
        const myJettonWalletAddr = await jettonMaster.getWalletAddress(
          parseAddress,
        );
        const jettonData = await tonClient.runMethod(
          myJettonWalletAddr,
          'get_wallet_data',
        );
        return jettonData?.stack?.pop()?.value?.toString() || '0';
      } catch (e) {
        console.error(`error getting token balance for ton ${e}`);
        return '0';
      }
    },
    getEstimateFee: async ({toAddress, amount, privateKey, memo}) => {
      try {
        // eslint-disable-next-line no-undef
        const keyPair = keyPairFromSeed(Buffer.from(privateKey, 'hex'));

        const wallet = WalletContractV4.create({
          publicKey: keyPair.publicKey,
          workchain: 0,
        });

        const walletContract = tonClient.open(wallet);
        const seqno = await walletContract.getSeqno();
        const transfer = walletContract.createTransfer({
          sendMode: SendMode.PAY_GAS_SEPARATELY,
          secretKey: keyPair.secretKey,
          seqno,
          messages: [
            internal({
              to: toAddress,
              value: BigInt(convertToSmallAmount(amount, 9)),
              body: isValidStringWithValue(memo)
                ? memo
                : `Transfer from ${WL_APP_NAME}`,
              bounce: false,
            }),
          ],
        });
        const fees = await tonClient.estimateExternalMessageFee(
          wallet.address,
          {body: transfer},
        );
        const sourceFees = fees?.source_fees;
        const total =
          sourceFees.fwd_fee +
          sourceFees.in_fwd_fee +
          sourceFees.gas_fee +
          sourceFees.storage_fee +
          15000;
        return {
          fee: parseBalance(total?.toString(), 9),
          transactionFee: parseBalance(total?.toString(), 9),
        };
      } catch (e) {
        console.error('Error in ton gas fee', e);
        throw e;
      }
    },
    getEstimateFeeForToken: async ({
      toAddress,
      contractAddress,
      amount,
      decimals,
      privateKey,
      memo,
    }) => {
      try {
        // eslint-disable-next-line no-undef
        const keyPair = keyPairFromSeed(Buffer.from(privateKey, 'hex'));
        const wallet = WalletContractV4.create({
          publicKey: keyPair.publicKey,
          workchain: 0,
        });
        const walletContract = tonClient.open(wallet);
        const jettonWalletAddress = Address.parse(contractAddress);
        const toParseAddress = Address.parse(toAddress);
        const jettonMaster = tonClient.open(
          JettonMaster.create(jettonWalletAddress),
        );
        const myJettonWalletAddr = await jettonMaster.getWalletAddress(
          wallet.address,
        );
        let seqno = await walletContract.getSeqno();
        const forwardPayload = beginCell()
          .storeUint(0, 32) // 0 opcode means we have a comment
          .storeStringTail(
            isValidStringWithValue(memo)
              ? memo
              : `Transfer from ${WL_APP_NAME}`,
          )
          .endCell();

        const messageBody = beginCell()
          .storeUint(0x0f8a7ea5, 32) // opcode for jetton transfer
          .storeUint(0, 64) // query id
          .storeCoins(convertToSmallAmount(amount, decimals)) // jetton amount, amount * 10^9
          .storeAddress(toParseAddress)
          .storeAddress(wallet.address) // response destination
          .storeBit(0) // no custom payload
          .storeCoins(toNano('0.000000001')) // forward amount - if >0, will send notification message
          .storeBit(1) // we store forwardPayload as a reference
          .storeRef(forwardPayload)
          .endCell();

        // Send it
        const transfer = walletContract.createTransfer({
          seqno,
          secretKey: keyPair.secretKey,
          messages: [
            internal({
              value: toNano('0.2'),
              to: myJettonWalletAddr,
              body: messageBody,
            }),
          ],
        });
        transfer.hash();
        const fees = await tonClient.estimateExternalMessageFee(
          wallet.address,
          {body: transfer},
        );
        const sourceFees = fees?.source_fees;
        const total =
          sourceFees.fwd_fee +
          sourceFees.in_fwd_fee +
          sourceFees.gas_fee +
          sourceFees.storage_fee +
          200000000 +
          15000;
        return {
          fee: parseBalance(total?.toString(), 9),
          transactionFee: parseBalance(total?.toString(), 9),
        };
      } catch (e) {
        console.error('Error in ton token gas fee', e);
        throw e;
      }
    },
    getTransactions: async ({address}) => {
      try {
        const transactions = await tonClient.getTransactions(address, {
          limit: 20,
        });
        // const transactionsss = await TonScan.getTonTransactions(address);
        // console.log('dasdsa', transactionsss);
        if (Array.isArray(transactions)) {
          return transactions?.map(item => {
            const txHash = item.hash()?.toString('hex');
            let date, to, from, amount;
            from = item?.inMessage?.info?.src?.toString();
            if (from) {
              date = new Date(item?.inMessage?.info?.createdAt * 1000);
              to = item?.inMessage?.info.dest?.toString();
              amount = item?.inMessage?.info?.value?.coins?.toString() || '0';
            } else {
              const outMessages = item.outMessages.values();
              date = new Date(outMessages?.[0]?.info?.createdAt * 1000);
              to = outMessages?.[0]?.info?.dest?.toString();
              from = outMessages?.[0]?.info?.src?.toString();
              amount = outMessages?.[0]?.info?.value?.coins?.toString() || '0';
            }
            return {
              amount: amount,
              link: txHash,
              url: getExplorerTxUrl('ton', txHash),
              status: from && to ? 'SUCCESS' : 'FAILED',
              date: date,
              from: from,
              to: to,
              totalCourse: '0$',
              transactionType: 'regular',
            };
          });
        }
        return [];
      } catch (e) {
        console.error('error getting transactions for tonchain', e);
        return [];
      }
    },
    getTransaction: async ({txHash}) => {
      try {
        let resolvedTxHash = null;
        if (typeof txHash === 'object' && txHash !== null) {
          const {seqno, walletContract} = txHash;
          for (let i = 0; i < 10; i++) {
            await new Promise(r => setTimeout(r, 5000));
            const currentSeqno = await walletContract.getSeqno();
            if (currentSeqno >= seqno) {
              resolvedTxHash = await findTxHashBySeqno(
                tonClient,
                walletContract.address,
                seqno,
              );
              if (resolvedTxHash) {
                break;
              }
            }
          }
        } else if (typeof txHash === 'string') {
          resolvedTxHash = txHash;
        }

        if (!resolvedTxHash) return null;

        const res = TonScan.getTransactionByHash({txHash: resolvedTxHash});
        const transactions = res?.data;
        if (!Array.isArray(transactions) || transactions.length === 0) {
          return null;
        }
        const item = transactions[0];
        let date, to, from, amount;
        from = item?.in_msg?.source
          ? Address.parse(item?.in_msg?.source)?.toString()
          : undefined;
        if (from) {
          date = new Date(item?.now * 1000);
          to = item?.in_msg?.destination
            ? Address.parse(item?.in_msg?.destination)?.toString()
            : undefined;
          amount = item?.in_msg?.value || '0';
        } else {
          const outMsg = item?.out_msgs?.[0];
          date = new Date(item?.now * 1000);
          to = outMsg?.destination
            ? Address.parse(outMsg?.destination).toString()
            : undefined;
          from = outMsg?.source
            ? Address.parse(outMsg?.source).toString()
            : undefined;
          amount = outMsg?.value || '0';
        }

        return {
          data: {
            amount: amount || '0',
            link: resolvedTxHash,
            url: getExplorerTxUrl('ton', resolvedTxHash),
            status: from && to ? 'SUCCESS' : 'FAILED',
            date: date,
            from: from,
            to: to,
            totalCourse: '0$',
          },
        };
      } catch (e) {
        console.error('error getting transaction for tonchain', e);
        return {data: null};
      }
    },
    getTokenTransactions: async ({address, contractAddress}) => {
      try {
        const res = await TonScan.getTokenTransactions({
          address,
          contractAddress,
        });
        const data = Array.isArray(res?.data) ? res?.data : [];
        return data.map(transaction => {
          const txHash = transaction?.transaction_hash;
          return {
            amount: transaction?.amount,
            link: txHash,
            url: getExplorerTxUrl('ton', txHash),
            status: 'Unknown',
            date: new Date(transaction?.transaction_now * 1000), //new Date(transaction.raw_data.timestamp),
            from: Address.parse(transaction?.source_wallet)?.toString(),
            to: Address.parse(transaction?.destination)?.toString(),
            totalCourse: '0$',
          };
        });
      } catch (e) {
        console.error(`error getting getTokenTransactions for ton ${e}`);
        return [];
      }
    },
    send: async ({to, from, amount, privateKey, transactionFee, memo}) => {
      try {
        // eslint-disable-next-line no-undef
        const keyPair = keyPairFromSeed(Buffer.from(privateKey, 'hex'));

        const wallet = WalletContractV4.create({
          publicKey: keyPair.publicKey,
          workchain: 0,
        });
        const totalAmount = new BigNumber(amount).plus(
          new BigNumber(transactionFee),
        );
        const balance = await TonChain().getBalance({address: from});
        const parsedBalance = new BigNumber(parseBalance(balance, 9));
        const walletContract = tonClient.open(wallet);
        const seqno = await walletContract.getSeqno();

        const transfer = walletContract.createTransfer({
          sendMode: totalAmount.gte(parsedBalance)
            ? SendMode.CARRY_ALL_REMAINING_BALANCE
            : SendMode.PAY_GAS_SEPARATELY,
          secretKey: keyPair.secretKey,
          seqno,
          messages: [
            internal({
              to: to,
              value: BigInt(convertToSmallAmount(amount, 9)),
              body: isValidStringWithValue(memo)
                ? memo
                : `Transfer from ${WL_APP_NAME}`,
              bounce: false,
            }),
          ],
        });

        await walletContract.send(transfer);
        return {seqno, walletContract};
      } catch (e) {
        console.error('Error in send ton transaction', e);
      }
    },
    sendToken: async ({
      contractAddress,
      to,
      amount,
      privateKey,
      decimal,
      memo,
    }) => {
      try {
        // eslint-disable-next-line no-undef
        const keyPair = keyPairFromSeed(Buffer.from(privateKey, 'hex'));
        const wallet = WalletContractV4.create({
          publicKey: keyPair.publicKey,
          workchain: 0,
        });
        const walletContract = tonClient.open(wallet);
        const jettonWalletAddress = Address.parse(contractAddress);
        const toParseAddress = Address.parse(to);
        const jettonMaster = tonClient.open(
          JettonMaster.create(jettonWalletAddress),
        );
        const myJettonWalletAddr = await jettonMaster.getWalletAddress(
          wallet.address,
        );
        let seqno = await walletContract.getSeqno();
        const forwardPayload = beginCell()
          .storeUint(0, 32) // 0 opcode means we have a comment
          .storeStringTail(
            isValidStringWithValue(memo) ? memo : `${WL_APP_NAME}`,
          )
          .endCell();

        const messageBody = beginCell()
          .storeUint(0x0f8a7ea5, 32) // opcode for jetton transfer
          .storeUint(0, 64) // query id
          .storeCoins(convertToSmallAmount(amount, decimal)) // jetton amount, amount * 10^9
          .storeAddress(toParseAddress)
          .storeAddress(wallet.address) // response destination
          .storeBit(0) // no custom payload
          .storeCoins(toNano('0.000000001')) // forward amount - if >0, will send notification message
          .storeBit(1) // we store forwardPayload as a reference
          .storeRef(forwardPayload)
          .endCell();

        // Send it
        await walletContract.sendTransfer({
          seqno,
          secretKey: keyPair.secretKey,
          messages: [
            internal({
              value: toNano('0.2'),
              to: myJettonWalletAddr,
              body: messageBody,
            }),
          ],
        });
        return {seqno, walletContract};
      } catch (e) {
        console.error('Error in send ton transaction', e);
        throw e;
      }
    },
    waitForConfirmation: async ({transaction}) => {
      if (!transaction?.seqno || !transaction?.walletContract) {
        console.error('No transaction id found for ton');
        return null;
      }
      return new Promise((resolve, reject) => {
        let numberOfRetries = 0;
        let timer = setInterval(async () => {
          try {
            numberOfRetries += 1;
            const currentSeqno = await transaction?.walletContract?.getSeqno();

            if (currentSeqno >= transaction?.seqno) {
              clearInterval(timer);
              return resolve(true);
            } else if (numberOfRetries === 5) {
              clearInterval(timer);
              resolve('pending');
            }
          } catch (e) {
            clearInterval(timer);
            console.error('Error in get tranaction', e);
            reject(e);
          }
        }, 10000);
      });
    },
  };
};
