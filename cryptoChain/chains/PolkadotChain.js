import BigNumber from 'bignumber.js';
import {
  convertToSmallAmount,
  getExplorerTxUrl,
  parseBalance,
} from 'dok-wallet-blockchain-networks/helper';
import {ApiPromise, WsProvider} from '@polkadot/api';
import {Keyring} from '@polkadot/keyring';
import {u8aToHex, u8aToU8a, u8aWrapBytes} from '@polkadot/util';
import {decodeAddress, encodeAddress} from '@polkadot/util-crypto';
import {PolkadotScan} from 'dok-wallet-blockchain-networks/service/PolkadotScan';
import {
  getFreeRPCUrl,
  getPremiumRPCUrl,
} from 'dok-wallet-blockchain-networks/rpcUrls/rpcUrls';
import {PolkadotHttpProvider} from 'dok-wallet-blockchain-networks/rpcUrls/polkadotHttpProvider';

// Errors that come from our own validation, not from the RPC. They are
// deterministic, so retrying them on another endpoint would only repeat them.
const POLKADOT_BUSINESS_ERRORS = ['polkadot_receiver_should_1_dot'];
const isPolkadotBusinessError = e =>
  POLKADOT_BUSINESS_ERRORS.includes(e?.message);

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

// `send` returns the H256 codec from author.submitExtrinsic; callers may also
// hand back a hex string or an object carrying `hash`. Check toHex before
// `.hash`: every codec has a `.hash` getter, and it is NOT the tx hash.
const toTxHash = transaction => {
  if (!transaction) {
    return undefined;
  }
  if (typeof transaction === 'string') {
    return transaction;
  }
  if (typeof transaction.toHex === 'function') {
    return transaction.toHex();
  }
  return transaction.hash;
};

// Outcome of the extrinsic at `index` from the block's system events:
// {success: true}, {success: false, errorInfo} or undefined if neither
// ExtrinsicSuccess nor ExtrinsicFailed was emitted for it.
const getExtrinsicOutcome = (api, allRecords, index) => {
  let outcome;
  allRecords
    .filter(
      ({phase}) => phase.isApplyExtrinsic && phase.asApplyExtrinsic.eq(index),
    )
    .forEach(({event}) => {
      if (outcome) {
        return;
      }
      if (api.events.system.ExtrinsicSuccess.is(event)) {
        outcome = {success: true};
      } else if (api.events.system.ExtrinsicFailed.is(event)) {
        const [dispatchError] = event.data;
        let errorInfo;
        if (dispatchError.isModule) {
          // for module errors, we have the section indexed, lookup
          const decoded = api.registry.findMetaError(dispatchError.asModule);
          errorInfo = `${decoded.section}.${decoded.name}`;
        } else {
          // Other, CannotLookup, BadOrigin, no extra info
          errorInfo = dispatchError.toString();
        }
        outcome = {success: false, errorInfo};
      }
    });
  return outcome;
};

// Premium (secure-rpc proxy) first, then the public Asset Hub endpoints.
const getPolkadotRpcUrls = () =>
  [getPremiumRPCUrl('polkadot'), ...getFreeRPCUrl('polkadot')].filter(Boolean);

// One HTTP transport for proxy and public endpoints: it attaches the
// short-lived x-rpc-session token for proxy URLs (passthrough otherwise),
// applies the 20s fetch timeout.
const createProvider = url =>
  url.startsWith('ws') ? new WsProvider(url) : new PolkadotHttpProvider(url);

// ApiPromise.create downloads the chain metadata, so unlike Solana's cheap
// Connection the api is cached per URL. Concurrent callers share the same
// in-flight init promise.
const apiCache = new Map();

// Identity check so a slow, failing caller can't drop a newer healthy entry.
// Eviction is also the only metadata refresh path: an HTTP api never
// re-fetches metadata after a runtime upgrade.
const evictApi = (url, promise) => {
  if (apiCache.get(url) !== promise) {
    return;
  }
  apiCache.delete(url);
  promise.then(api => api.disconnect()).catch(() => {});
};

const getOrCreateApi = url => {
  let promise = apiCache.get(url);
  if (!promise) {
    // Without throwOnConnect, create() resolves only on success and never
    // rejects, so a dead endpoint would hang instead of falling through.
    promise = ApiPromise.create({
      provider: createProvider(url),
      throwOnConnect: true,
      noInitWarn: true,
    }).catch(e => {
      evictApi(url, promise);
      throw e;
    });
    apiCache.set(url, promise);
  }
  return promise;
};

export const PolkadotChain = () => {
  // Runs cb against each endpoint in turn. Business errors are rethrown at
  // once; anything else evicts that endpoint's api and moves to the next.
  // On the last endpoint: throw, or return defaultResponse when given.
  const retryFunc = async (cb, defaultResponse) => {
    const rpcs = getPolkadotRpcUrls();
    for (let i = 0; i < rpcs.length; i++) {
      const apiPromise = getOrCreateApi(rpcs[i]);
      try {
        return await cb(await apiPromise);
      } catch (e) {
        console.log('Error for polkadot rpc', rpcs[i], 'Errors:', e);
        if (isPolkadotBusinessError(e)) {
          throw e;
        }
        evictApi(rpcs[i], apiPromise);
        if (i === rpcs.length - 1) {
          if (defaultResponse === undefined) {
            throw e;
          }
          return defaultResponse;
        }
      }
    }
  };

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
    // WalletConnect polkadot_signTransaction: signs only, the dApp broadcasts.
    sendRawTransaction: async ({signTypeData, privateKey}) => {
      try {
        return await retryFunc(async api => {
          const keyring = new Keyring({ss58Format: 0});
          const keypair = keyring.addFromSeed(
            // eslint-disable-next-line no-undef
            Buffer.from(privateKey, 'hex'),
          );
          const transactionPayload =
            signTypeData?.transactionPayload ?? signTypeData;
          // The registry is shared by every call on this cached api, so
          // restore its signed extensions after signing with the dApp's.
          const previousSignedExtensions = api.registry.signedExtensions;
          try {
            if (transactionPayload?.signedExtensions) {
              api.registry.setSignedExtensions(
                transactionPayload.signedExtensions,
              );
            }
            const payload = api.registry.createType(
              'ExtrinsicPayload',
              transactionPayload,
              {version: transactionPayload?.version ?? 4},
            );
            const {signature} = payload.sign(keypair);
            return {id: 1, signature};
          } finally {
            if (transactionPayload?.signedExtensions) {
              api.registry.setSignedExtensions(previousSignedExtensions);
            }
          }
        });
      } catch (e) {
        console.error('Error in polkadot signTransaction', e);
        throw e;
      }
    },
    signMessage: async ({signTypeData, privateKey}) => {
      try {
        const keyring = new Keyring({ss58Format: 0});
        const keypair = keyring.addFromSeed(
          // eslint-disable-next-line no-undef
          Buffer.from(privateKey, 'hex'),
        );
        const message = signTypeData?.message ?? signTypeData;
        const type = signTypeData?.type;
        if (typeof message !== 'string') {
          throw new Error(
            'Invalid polkadot_signMessage: data must be a string',
          );
        }
        // WalletConnect polkadot_signMessage (SignerPayloadRaw) sends `data`
        // hex-encoded. For type 'bytes' (the default) the dApp has already
        // wrapped the text in <Bytes>…</Bytes> before hex-encoding, so decode
        // the hex and rely on u8aWrapBytes being a no-op on wrapped input
        // (same as polkadot-js extension signRaw). A non-hex string is still
        // UTF-8 encoded, keeping plain-text callers working. type 'payload'
        // is transaction-like data and must be signed unwrapped.
        const bytes = u8aToU8a(message);
        const toSign = type === 'payload' ? bytes : u8aWrapBytes(bytes);
        const signature = keypair.sign(toSign);
        return {signature: u8aToHex(signature)};
      } catch (e) {
        console.error('Error in polkadot signMessage', e);
        throw e;
      }
    },
    getBalance: async ({address}) =>
      retryFunc(async api => {
        const resp = await api.query.system.account(address);
        return resp?.data.free?.toString() || '0';
      }, '0'),
    getEstimateFee: async ({toAddress, amount, privateKey, fromAddress}) => {
      try {
        return await retryFunc(async api => {
          const BNamount = new BigNumber(amount);
          if (BNamount.lt(new BigNumber(1))) {
            const resp = await api.query.system.account(toAddress);
            const receiverAmount = new BigNumber(
              resp?.data.free?.toString() || '0',
            );
            if (receiverAmount.lte(new BigNumber(0))) {
              throw new Error('polkadot_receiver_should_1_dot');
            }
          }
          const info = await api.tx.balances
            .transferAllowDeath(toAddress, convertToSmallAmount(amount, 10))
            .paymentInfo(fromAddress);
          return {
            fee: parseBalance(info?.partialFee?.toString(), 10),
            estimateGas: '',
            gasFee: '',
          };
        });
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
        // Reads and signing may rotate across endpoints; the broadcast below
        // happens exactly once, through the api that signed, so a transport
        // error can never re-submit the transfer on another endpoint.
        const {api, signedTx} = await retryFunc(async currentApi => {
          const BNamount = new BigNumber(amount);
          if (BNamount.lt(new BigNumber(1))) {
            const resp = await currentApi.query.system.account(to);
            const receiverAmount = new BigNumber(
              resp?.data.free?.toString() || '0',
            );
            if (receiverAmount.lte(new BigNumber(0))) {
              throw new Error('polkadot_receiver_should_1_dot');
            }
          }
          const keyring = new Keyring({ss58Format: 0});
          const keypair = keyring.addFromSeed(
            // eslint-disable-next-line no-undef
            Buffer.from(privateKey, 'hex'),
          );
          // signAsync fetches nonce and blockHash like signAndSend but does
          // not broadcast.
          const tx = await currentApi.tx.balances
            .transferAllowDeath(to, convertToSmallAmount(amount, 10))
            .signAsync(keypair);
          return {api: currentApi, signedTx: tx};
        });
        return await api.rpc.author.submitExtrinsic(signedTx);
      } catch (e) {
        console.error('Error in send polkadot transaction', e);
        throw e;
      }
    },
    // Confirms the submitted extrinsic, not "the latest block succeeded":
    // Polkadot blocks always carry successful inherents (timestamp.set), so
    // checking any ExtrinsicSuccess in the head block reports every transfer
    // as confirmed, including ones that failed or were never included.
    // Scans forward from the head at call time until a block contains our
    // hash, then reads only that extrinsic's system events. Resolves
    // {hash, blockHash} on ExtrinsicSuccess, {status: 'failed', err} on
    // ExtrinsicFailed and 'pending' if not included within retries × interval,
    // matching the shapes the send flow already handles for other chains.
    waitForConfirmation: async ({
      transaction,
      interval = 6000,
      retries = 10,
    } = {}) => {
      const txHash = toTxHash(transaction);
      if (!txHash) {
        console.error('No transaction hash found for polkadot');
        return null;
      }
      // Kept outside retryFunc so an endpoint rotation resumes the scan
      // instead of restarting from a newer head and skipping blocks.
      let nextBlockNumber;
      return retryFunc(async api => {
        for (let attempt = 0; attempt < retries; attempt++) {
          const head = (await api.rpc.chain.getHeader()).number.toNumber();
          if (nextBlockNumber === undefined) {
            // The extrinsic was broadcast just before this call; one block
            // back covers an inclusion that happened in between.
            nextBlockNumber = Math.max(head - 1, 0);
          }
          for (; nextBlockNumber <= head; nextBlockNumber++) {
            const blockHash = await api.rpc.chain.getBlockHash(nextBlockNumber);
            const signedBlock = await api.rpc.chain.getBlock(blockHash);
            const index = signedBlock.block.extrinsics.findIndex(ext =>
              ext.hash.eq(txHash),
            );
            if (index === -1) {
              continue;
            }
            const apiAt = await api.at(blockHash);
            const allRecords = await apiAt.query.system.events();
            const outcome = getExtrinsicOutcome(api, allRecords, index);
            if (!outcome?.success) {
              console.log(
                `polkadot ${txHash}:: ExtrinsicFailed:: ${outcome?.errorInfo}`,
              );
              return {status: 'failed', err: outcome?.errorInfo};
            }
            return {hash: txHash, blockHash: blockHash.toHex()};
          }
          if (attempt < retries - 1) {
            await sleep(interval);
          }
        }
        return 'pending';
      });
    },
  };
};
