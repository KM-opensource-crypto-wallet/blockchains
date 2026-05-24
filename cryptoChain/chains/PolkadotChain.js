import BigNumber from 'bignumber.js';
import {
  convertToSmallAmount,
  getExplorerTxUrl,
  parseBalance,
} from 'dok-wallet-blockchain-networks/helper';
import {ApiPromise, HttpProvider, WsProvider} from '@polkadot/api';
import {Keyring} from '@polkadot/keyring';
import {decodeAddress, encodeAddress} from '@polkadot/util-crypto';
import {PolkadotScan} from 'dok-wallet-blockchain-networks/service/PolkadotScan';
import {getRPCUrl} from 'dok-wallet-blockchain-networks/rpcUrls/rpcUrls';

let polkadotProvider;
const createOrGetPolkadotProvider = async () => {
  try {
    if (polkadotProvider) {
      return polkadotProvider;
    }
    const rpcUrl = getRPCUrl('polkadot');
    const isWs = rpcUrl?.startsWith('ws');
    const provider = isWs ? new WsProvider(rpcUrl) : new HttpProvider(rpcUrl);
    polkadotProvider = await ApiPromise.create({provider: provider});
    return polkadotProvider;
  } catch (e) {
    console.error('Error in createOrGetPolkadotProvider', e);
  }
};

export const PolkadotChain = () => {
  return {
    isValidAddress: ({address}) => {
      try {
        const decodedAddress = decodeAddress(address);
        return !!decodedAddress;
      } catch {
        return false;
      }
    },
    isValidPrivateKey: async ({privateKey}) => {
      try {
        const keyring = new Keyring({ss58Format: 0});
        const keypair = keyring.addFromSeed(
          // eslint-disable-next-line no-undef
          Buffer.from(privateKey, 'hex'),
        );
        return !!keypair?.address;
      } catch (e) {
        return false;
      }
    },
    createWalletByPrivateKey: async ({privateKey}) => {
      const keyring = new Keyring({ss58Format: 0});
      const keypair = keyring.addFromSeed(
        // eslint-disable-next-line no-undef
        Buffer.from(privateKey, 'hex'),
      );
      return {
        address: keypair.address,
        privateKey: privateKey,
      };
    },
    getBalance: async ({address}) => {
      try {
        const provider = await createOrGetPolkadotProvider();
        const resp = await provider.query.system.account(address);
        return resp?.data.free?.toString() || '0';
      } catch (e) {
        console.error('error in get balance from polkadot', e);
        return '0';
      }
    },
    getEstimateFee: async ({toAddress, amount, privateKey, fromAddress}) => {
      try {
        const provider = await createOrGetPolkadotProvider();
        const BNamount = new BigNumber(amount);
        if (BNamount.lt(new BigNumber(1))) {
          const resp = await provider.query.system.account(toAddress);
          const receiverAmount = new BigNumber(
            resp?.data.free?.toString() || '0',
          );
          if (receiverAmount.lte(new BigNumber(0))) {
            throw new Error('polkadot_receiver_should_1_dot');
          }
        }
        const info = await provider.tx.balances
          .transferAllowDeath(toAddress, convertToSmallAmount(amount, 10))
          .paymentInfo(fromAddress);
        return {
          fee: parseBalance(info?.partialFee?.toString(), 10),
          estimateGas: '',
          gasFee: '',
        };
      } catch (e) {
        console.error('Error in polkadot gas fee', e);
        throw e;
      }
    },
    getTransactions: async ({address}) => {
      try {
        const transactions = await PolkadotScan.getTransactions(address);
        if (Array.isArray(transactions?.data)) {
          return transactions?.data?.map(item => {
            const txHash = item?.hash;

            return {
              amount: item?.amount_v2 || '',
              link: txHash,
              url: getExplorerTxUrl('polkadot', item?.extrinsic_index),
              status: item?.success ? 'SUCCESS' : 'Failed',
              date: new Date(item?.block_timestamp * 1000), //new Date(transaction.raw_data.timestamp),
              from: item?.from,
              to: item?.to,
              totalCourse: '0$',
              transactionType: 'regular',
              blockNumber: item.block_num,
            };
          });
        }
        return [];
      } catch (e) {
        console.error(`error getting transactions for polkadot ${e}`);
        return [];
      }
    },
    getTransaction: async ({txHash, address}) => {
      try {
        const [transaction, latestBlockNumber] = await Promise.all([
          PolkadotScan.getTransaction(txHash),
          PolkadotScan.getLatestBlockNumber(),
        ]);
        if (transaction) {
          const txData = transaction?.data;
          const extrinsic_index = txData?.extrinsic_index;
          const block_timestamp = txData?.block_timestamp;
          const blockNumber = txData?.block_num ?? null;
          const confirmations =
            blockNumber !== null && latestBlockNumber !== null
              ? Math.max(0, latestBlockNumber - parseInt(blockNumber, 10))
              : null;
          const legacyTransfer = txData?.transfer;
          let from, to, amount, success;
          if (legacyTransfer) {
            from = legacyTransfer.from;
            to = legacyTransfer.to;
            amount = legacyTransfer.amount || '';
            success = legacyTransfer.success;
          } else {
            from = txData?.account_id ?? null;
            success = txData?.success ?? false;

            const callsParam = txData?.params?.find(p => p.name === 'calls');
            if (callsParam && Array.isArray(callsParam.value)) {
              const transferCalls = callsParam.value.filter(
                call =>
                  call.call_module === 'Balances' && Array.isArray(call.params),
              );
              const decodeDestAddress = call => {
                const destHex = call.params.find(p => p.name === 'dest')?.value
                  ?.Id;
                if (!destHex) {
                  return null;
                }
                try {
                  return encodeAddress(destHex, 0);
                } catch {
                  return destHex;
                }
              };
              // If we have the user's address, find the transfer matching them
              let matchedCall = null;
              if (address) {
                matchedCall = transferCalls.find(
                  call => decodeDestAddress(call) === address,
                );
              }
              const relevantCall = matchedCall ?? transferCalls[0];
              if (relevantCall) {
                to = decodeDestAddress(relevantCall);
                const valueParam = relevantCall.params.find(
                  p => p.name === 'value',
                );
                amount = valueParam?.value ?? '';
              }
            } else {
              const destParam = txData?.params?.find(p => p.name === 'dest');
              const destHex = destParam?.value?.Id ?? null;
              if (destHex) {
                try {
                  to = encodeAddress(destHex, 0);
                } catch {
                  to = destHex;
                }
              } else {
                to = null;
              }
              const valueParam = txData?.params?.find(p => p.name === 'value');
              amount = valueParam?.value ?? '';
            }
          }
          return {
            data: {
              amount,
              link: txHash,
              url: getExplorerTxUrl('polkadot', extrinsic_index),
              status: success ? 'SUCCESS' : 'Failed',
              date: new Date(block_timestamp * 1000),
              from,
              to,
              totalCourse: '0$',
              blockNumber,
              confirmations,
            },
          };
        }
      } catch (e) {
        console.error(`error getting transactions for polkadot ${e}`);
        return {data: null};
      }
    },
    send: async ({to, from, amount, privateKey, transactionFee, gasFee}) => {
      try {
        const provider = await createOrGetPolkadotProvider();
        const BNamount = new BigNumber(amount);
        if (BNamount.lt(new BigNumber(1))) {
          const resp = await provider.query.system.account(to);
          const receiverAmount = new BigNumber(
            resp?.data.free?.toString() || '0',
          );
          if (receiverAmount.lt(new BigNumber(0))) {
            throw new Error('polkadot_receiver_should_1_dot');
          }
        }
        const keyring = new Keyring({ss58Format: 0});
        const keypair = keyring.addFromSeed(
          // eslint-disable-next-line no-undef
          Buffer.from(privateKey, 'hex'),
        );
        return await provider.tx.balances
          .transferAllowDeath(to, convertToSmallAmount(amount, 10))
          .signAndSend(keypair);
      } catch (e) {
        console.error('Error in send polkadot transaction', e);
      }
    },
    waitForConfirmation: async () => {
      return new Promise(async (resolve, reject) => {
        const provider = await createOrGetPolkadotProvider();

        // no blockHash is specified, so we retrieve the latest
        const signedBlock = await provider.rpc.chain.getBlock();

        // get the api and events at a specific block
        const apiAt = await provider.at(signedBlock.block.header.hash);
        const allRecords = await apiAt.query.system.events();

        // map between the extrinsics and events
        signedBlock.block.extrinsics.forEach(
          ({method: {method, section}}, index) => {
            allRecords
              // filter the specific events based on the phase and then the
              // index of our extrinsic in the block
              .filter(
                ({phase}) =>
                  phase.isApplyExtrinsic && phase.asApplyExtrinsic.eq(index),
              )
              // test the events against the specific types we are looking for
              .forEach(({event}) => {
                if (provider.events.system.ExtrinsicSuccess.is(event)) {
                  // extract the data for this event
                  // (In TS, because of the guard above, these will be typed)
                  return resolve(true);
                } else if (provider.events.system.ExtrinsicFailed.is(event)) {
                  // extract the data for this event
                  const [dispatchError, dispatchInfo] = event.data;
                  let errorInfo;

                  // decode the error
                  if (dispatchError.isModule) {
                    // for module errors, we have the section indexed, lookup
                    // (For specific known errors, we can also do a check against the
                    // api.errors.<module>.<ErrorName>.is(dispatchError.asModule) guard)
                    const decoded = provider.registry.findMetaError(
                      dispatchError.asModule,
                    );

                    errorInfo = `${decoded.section}.${decoded.name}`;
                  } else {
                    // Other, CannotLookup, BadOrigin, no extra info
                    errorInfo = dispatchError.toString();
                  }

                  console.log(
                    `${section}.${method}:: ExtrinsicFailed:: ${errorInfo}`,
                  );
                  return reject(false);
                }
              });
          },
        );
      });
    },
  };
};
