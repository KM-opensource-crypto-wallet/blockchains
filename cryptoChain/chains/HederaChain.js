import {IS_SANDBOX} from 'dok-wallet-blockchain-networks/config/config';
import {ethers} from 'ethers';
import BigNumber from 'bignumber.js';
import {createWallet} from 'myWallet/wallet.service';
import {HEDERA} from 'dok-wallet-blockchain-networks/service/Hedera';

import {
  AccountCreateTransaction,
  AccountId,
  Client,
  FeeEstimateMode,
  FeeEstimateQuery,
  Hbar,
  PrecheckStatusError,
  PrivateKey,
  Query,
  Status,
  Transaction,
  TransactionId,
  TransferTransaction,
} from '@hiero-ledger/sdk';
import {proto} from '@hiero-ledger/proto';
import {
  getExplorerTxUrl,
  HEDERA_KEY_MISMATCH_MESSAGE,
  HEDERA_UNACTIVATED_MESSAGE,
} from 'dok-wallet-blockchain-networks/helper';

/**
 * Account model (HIP-583).
 *
 * The wallet derives an ECDSA secp256k1 key (same path as the Ethereum coin)
 * and its EVM address is `wallet.address`, permanently. Hedera creates the
 * ledger account itself the first time anyone sends HBAR or a token to that
 * EVM address — the *sender* pays the CryptoCreate fee, the recipient receives
 * the full amount and the new account is "hollow" (no key) until the owner's
 * first outgoing transaction completes it. No operator account is involved.
 *
 * Once the mirror node resolves the EVM address to `0.0.N`, `attachAccountId`
 * stores that id in a separate `accountId` field (see resolveWallet in
 * cryptoChain/index.js); the address itself never changes. Wallets saved by
 * older builds with `0.0.N` as the address are migrated once. Exchange,
 * WalletConnect and the mirror node's history endpoint need `0.0.N`, so every
 * method here accepts either form and resolves as needed.
 *
 * Legacy caveat: an early (June 2024) build of the removed operator flow
 * created accounts whose alias is the user's EVM address but whose key is the
 * operator's (testnet `0.0.4459557` carries the key of `0.0.4454415`). The alias
 * lookup still returns such an account, but the wallet key cannot sign for it —
 * the node rejects with INVALID_SIGNATURE at precheck. `send` and
 * `sendRawTransaction` check the on-chain key first and fail with
 * HEDERA_KEY_MISMATCH_MESSAGE instead.
 */

const ACCOUNT_ID_REGEX = /^\d+\.\d+\.\d+$/;
const EVM_ADDRESS_REGEX = /^(0x)?[0-9a-fA-F]{40}$/;
const HBAR_DECIMALS = 8;
// Accounts 0.0.0–0.0.1000 are reserved (nodes, fee collection 0.0.98, staking
// rewards 0.0.800/801). Used only to pick counterparties out of a transfer list.
const SYSTEM_ACCOUNT_MAX_NUM = 1000;
// A missing account is re-checked after this long; a found one is immutable.
const NEGATIVE_LOOKUP_TTL_MS = 30 * 1000;

// Fee estimation (HIP-1261). The mirror node prices the exact transaction we
// are about to send from its protobuf, in tinycents (USD × 1e-10), using the
// live network fee schedule. INTRINSIC mode only looks at the transaction body,
// so a placeholder payer/recipient is fine — the payer's state is irrelevant
// and the transaction is never submitted.
const FEE_ESTIMATE_PAYER = '0.0.2';
const FEE_ESTIMATE_RECIPIENT = '0.0.3';
const FEE_ESTIMATE_NODE = new AccountId(3);
const TINYCENTS_PER_USD = 1e10;
// The estimate is exact at estimate time; the HBAR exchange rate the node uses
// at consensus can differ (it updates hourly), and setMaxTransactionFee below
// the real charge fails with INSUFFICIENT_TX_FEE. The margin only caps what
// the node may charge — the actual fee is what the estimate says.
const MAX_FEE_MARGIN = 1.5;

const accountIdByEvmAddress = new Map();
const missingAccountUntil = new Map();

export const isHederaAccountId = value =>
  typeof value === 'string' && ACCOUNT_ID_REGEX.test(value);

export const isHederaEvmAddress = value =>
  typeof value === 'string' && EVM_ADDRESS_REGEX.test(value);

const normalizeEvmAddress = value => {
  const hex = value.startsWith('0x') ? value : `0x${value}`;
  return hex.toLowerCase();
};

export const deriveHederaEvmAddress = privateKey =>
  new ethers.Wallet(privateKey).address.toLowerCase();

/**
 * `0.0.N` for an account id or an EVM address that already has an account;
 * null while the address has never been funded. Successful lookups are cached
 * for the process lifetime (the mapping never changes), misses for 30 s so
 * balance polling and the Receive screen do not hammer the mirror node. A
 * mirror-node failure propagates and is not cached as a miss.
 */
export const resolveHederaAccountId = async addressOrId => {
  if (isHederaAccountId(addressOrId)) {
    return addressOrId;
  }
  if (!isHederaEvmAddress(addressOrId)) {
    return null;
  }
  const evmAddress = normalizeEvmAddress(addressOrId);
  const cached = accountIdByEvmAddress.get(evmAddress);
  if (cached) {
    return cached;
  }
  const retryAt = missingAccountUntil.get(evmAddress);
  if (retryAt && retryAt > Date.now()) {
    return null;
  }
  const accountId = await HEDERA.getAccountByEvmAddress(evmAddress);
  if (isHederaAccountId(accountId)) {
    accountIdByEvmAddress.set(evmAddress, accountId);
    missingAccountUntil.delete(evmAddress);
    return accountId;
  }
  missingAccountUntil.set(evmAddress, Date.now() + NEGATIVE_LOOKUP_TTL_MS);
  return null;
};

/** Test hook. */
export const __resetHederaAccountCache = () => {
  accountIdByEvmAddress.clear();
  missingAccountUntil.clear();
};

const newClient = () =>
  IS_SANDBOX ? Client.forTestnet() : Client.forMainnet();

// Receipt queries and fee estimates are free and need no operator.
const getReadOnlyClient = () => newClient();

const getSignerClient = (accountId, privateKey) =>
  newClient().setOperator(accountId, PrivateKey.fromStringECDSA(privateKey));

const closeClient = client => {
  try {
    client?.close();
  } catch (e) {
    // closing is best-effort
  }
};

const parseSignerAccountId = signerAccountId =>
  signerAccountId?.split(':')?.pop();

/*
 * WalletConnect (HIP-820). Request params and results follow the reference
 * wallet in @hashgraph/hedera-wallet-connect: messages are signed with the
 * "Hedera Signed Message" prefix, signatures travel as a base64 protobuf
 * SignatureMap, submitted transactions return TransactionResponse.toJSON()
 * and node rejections become JSON-RPC error 9000 with the status code as
 * `data`. The app is pinned to one network (IS_SANDBOX); the dApp's chain id
 * is checked against it and never used to build a signing client.
 */
const HEDERA_SIGNED_MESSAGE_PREFIX = '\x19Hedera Signed Message:\n';
const HEDERA_JSON_RPC_ERROR_CODE = 9000;

const appNetwork = () => (IS_SANDBOX ? 'testnet' : 'mainnet');

const assertNetwork = chainId => {
  const requested = chainId?.split(':')?.[1];
  if (requested && requested !== appNetwork()) {
    throw new Error(
      `This wallet is on Hedera ${appNetwork()}; the dApp requested ${requested}.`,
    );
  }
};

const requireStringParam = (name, value) => {
  if (typeof value !== 'string') {
    throw new Error(`Invalid Hedera request: ${name} must be a string`);
  }
  return value;
};

// HIP-820 prepends `len(message)` without defining it. The canonical
// verifier, `verifyMessageSignature` in @hashgraph/hedera-wallet-connect,
// uses the JS string length (UTF-16 code units), not the UTF-8 byte length,
// so `message.length` is deliberate: switching to Buffer.byteLength would
// break dApp-side verification of any non-ASCII message.
const prefixMessage = message =>
  // eslint-disable-next-line no-undef
  Buffer.from(
    `${HEDERA_SIGNED_MESSAGE_PREFIX}${message.length}${message}`,
    'utf8',
  );

// eslint-disable-next-line no-undef
const toBase64 = bytes => Buffer.from(bytes).toString('base64');
// eslint-disable-next-line no-undef
const fromBase64 = value => Buffer.from(value, 'base64');

const encodeSignatureMap = (key, signature) =>
  toBase64(
    proto.SignatureMap.encode({
      sigPair: [key.publicKey._toProtobufSignature(signature)],
    }).finish(),
  );

// Node precheck failures carry the ResponseCodeEnum the dApp needs.
const withJsonRpcError = e => {
  if (e instanceof PrecheckStatusError) {
    e.jsonRpcError = {
      code: HEDERA_JSON_RPC_ERROR_CODE,
      message: e.message,
      data: String(e.status?._code),
    };
  }
  throw e;
};

const encodeQueryResult = result =>
  toBase64(result instanceof Uint8Array ? result : result.toBytes());

const toHbar = amount =>
  new Hbar(new BigNumber(amount).toFixed(HBAR_DECIMALS, BigNumber.ROUND_DOWN));

const toMaxFeeHbar = fee =>
  new Hbar(new BigNumber(fee).toFixed(HBAR_DECIMALS, BigNumber.ROUND_UP));

// SDK prints `0.0.N@sec.nanos`; the mirror node (and our tx history links)
// use `0.0.N-sec-nanos`.
export const toMirrorTransactionId = transactionId => {
  const [accountId, timestamp = ''] = transactionId.toString().split('@');
  const [seconds, nanos = '0'] = timestamp.split('?')[0].split('.');
  return `${accountId}-${seconds}-${nanos.padStart(9, '0')}`;
};

/**
 * Refuses to sign for an account whose on-chain key is not ours. Hollow
 * accounts have no key yet (the wallet key completes them), and threshold/key
 * lists (`ProtobufEncoded`) or an unreachable mirror node are left to the node
 * to judge. Only a plain key that is provably someone else's is rejected.
 */
const assertAccountControlledByKey = async (accountId, privateKey) => {
  let key;
  try {
    const resp = await HEDERA.getAccountInfo(accountId);
    if (!resp?.data) {
      return;
    }
    key = resp.data.key;
  } catch (e) {
    return;
  }
  if (!key) {
    return;
  }
  if (key._type === 'ECDSA_SECP256K1') {
    const ours = PrivateKey.fromStringECDSA(privateKey)
      .publicKey.toStringRaw()
      .toLowerCase();
    if (String(key.key ?? '').toLowerCase() !== ours) {
      throw new Error(HEDERA_KEY_MISMATCH_MESSAGE);
    }
    return;
  }
  if (key._type === 'ED25519') {
    throw new Error(HEDERA_KEY_MISMATCH_MESSAGE);
  }
};

// USD cost of one transaction according to the mirror node's fee estimator.
const estimateUsd = async (client, transaction) => {
  const frozen = transaction
    .setTransactionId(TransactionId.generate(FEE_ESTIMATE_PAYER))
    .setNodeAccountIds([FEE_ESTIMATE_NODE])
    .freeze();
  const estimate = await new FeeEstimateQuery()
    .setTransaction(frozen)
    .setMode(FeeEstimateMode.INTRINSIC)
    .execute(client);
  const tinycents = Number(estimate?.total?.toString());
  if (!Number.isFinite(tinycents) || tinycents <= 0) {
    throw new Error('Invalid Hedera fee estimate');
  }
  return tinycents / TINYCENTS_PER_USD;
};

const hbarPerUsd = async () => {
  const resp = await HEDERA.getExchangeFee();
  const currentRate = resp?.data?.current_rate;
  const hbarToDollar =
    currentRate?.cent_equivalent / currentRate?.hbar_equivalent / 100;
  if (!Number.isFinite(hbarToDollar) || hbarToDollar <= 0) {
    throw new Error('Invalid HBAR exchange rate');
  }
  return 1 / hbarToDollar;
};

const isSystemAccount = account => {
  const num = Number(account?.split('.')?.pop());
  return Number.isFinite(num) && num <= SYSTEM_ACCOUNT_MAX_NUM;
};

/**
 * Picks `from`/`to`/`amount` (tinybars) out of a mirror-node transfer list.
 * `accountId` is our account on the ledger, `address` the form the wallet
 * stores it as — the self side is reported as `address` because the UI decides
 * transaction direction by comparing against `coin.address`.
 */
const extractTransferParties = (item, accountId, address) => {
  const transfers = Array.isArray(item?.transfers) ? item.transfers : [];
  const chargedFee = item?.charged_tx_fee || 0;
  let from = null;
  let to = null;
  let amount = null;
  const self = accountId
    ? transfers.find(transfer => transfer.account === accountId)
    : null;
  if (self) {
    if (self.amount < 0) {
      from = accountId;
      amount = Math.abs(self.amount) - chargedFee;
      to =
        transfers.find(
          transfer =>
            transfer.account !== accountId && transfer.amount === amount,
        )?.account ??
        transfers
          .filter(
            transfer =>
              transfer.account !== accountId &&
              transfer.amount > 0 &&
              !isSystemAccount(transfer.account),
          )
          .sort((a, b) => b.amount - a.amount)[0]?.account ??
        null;
    } else {
      to = accountId;
      amount = self.amount;
      from =
        transfers
          .filter(
            transfer => transfer.account !== accountId && transfer.amount < 0,
          )
          .sort((a, b) => a.amount - b.amount)[0]?.account ?? null;
    }
  } else {
    const debit = transfers
      .filter(transfer => transfer.amount < 0)
      .sort((a, b) => a.amount - b.amount)[0];
    const credit = transfers
      .filter(
        transfer => transfer.amount > 0 && !isSystemAccount(transfer.account),
      )
      .sort((a, b) => b.amount - a.amount)[0];
    from = debit?.account ?? null;
    to = credit?.account ?? null;
    amount = credit?.amount ?? null;
  }
  if (address && accountId) {
    if (from === accountId) {
      from = address;
    }
    if (to === accountId) {
      to = address;
    }
  }
  return {from, to, amount};
};

const consensusDateMs = consensusTimestamp => {
  const seconds = consensusTimestamp?.substring(
    0,
    consensusTimestamp?.indexOf('.'),
  );
  return Number(seconds) * 1000;
};

// One mirror-node record → the shape the transaction list and detail screen
// share. `txHash` is the mirror-style id used for links.
const toTransactionRecord = (item, txHash, accountId, address) => {
  const {from, to, amount} = extractTransferParties(item, accountId, address);
  return {
    amount: amount?.toString() ?? null,
    link: txHash,
    url: getExplorerTxUrl('hedera', txHash),
    status: item?.result === 'SUCCESS' ? 'SUCCESS' : 'FAIL',
    date: consensusDateMs(item?.consensus_timestamp),
    from,
    to,
    totalCourse: '0$',
    transactionType: 'regular',
    blockNumber: item?.blockNumber ?? null,
    confirmations: item?.confirmations ?? null,
  };
};

export const HederaChain = (chain_name = 'hedera', phrase, customRpcUrl) => {
  const buildWallet = (evmAddress, privateKey) => {
    if (!isHederaEvmAddress(evmAddress) || !privateKey) {
      throw new Error('Unable to derive Hedera key');
    }
    return {address: normalizeEvmAddress(evmAddress), privateKey};
  };
  let evmChain;

  return {
    /**
     * Executor for WalletConnect's `eip155:295/296` namespace: the same coin
     * and key on Hedera's JSON-RPC relay (CHAIN_CONFIG.hedera.free_rpc_urls).
     * Built on first use so the native path never loads ethers' RPC stack.
     */
    get evm() {
      if (!evmChain) {
        const {EVMChain} = require('./EVMChain');
        evmChain = EVMChain(chain_name, phrase, customRpcUrl);
      }
      return evmChain;
    },
    isValidAddress: ({address}) => {
      try {
        return !!AccountId.fromString(address).toString();
      } catch {
        return false;
      }
    },
    isValidPrivateKey: async ({privateKey}) => {
      try {
        const wallet = new ethers.Wallet(privateKey);
        return !!wallet?.address;
      } catch (e) {
        return false;
      }
    },
    // Pure derivation; the ledger account appears with the first deposit.
    createHederaWallet: async ({mnemonic}) => {
      try {
        const etherWallet = await createWallet(
          'ethereum',
          mnemonic,
          IS_SANDBOX,
        );
        return buildWallet(etherWallet?.address, etherWallet?.privateKey);
      } catch (e) {
        console.error('Error in create hedera wallet', e);
        throw e;
      }
    },
    createWalletByPrivateKey: async ({privateKey}) => {
      try {
        const wallet = new ethers.Wallet(privateKey);
        return buildWallet(wallet?.address, wallet?.privateKey);
      } catch (e) {
        console.error('Error in create hedera wallet by private key', e);
        throw e;
      }
    },
    /**
     * Adds `accountId` (`0.0.N`) next to the stored EVM address once the
     * ledger has the account. `address` never changes — except for wallets
     * saved by older builds as `0.0.N`, which are migrated once to the EVM
     * address with the old id kept as `accountId`. An id is never removed:
     * a failed lookup leaves the wallet as it was.
     */
    attachAccountId: async wallet => {
      try {
        if (!wallet?.address) {
          return wallet;
        }
        if (isHederaAccountId(wallet.address)) {
          if (!wallet.privateKey) {
            return wallet;
          }
          return {
            ...wallet,
            address: deriveHederaEvmAddress(wallet.privateKey),
            accountId: wallet.address,
          };
        }
        if (wallet.accountId) {
          return wallet;
        }
        const accountId = await resolveHederaAccountId(wallet.address);
        return accountId ? {...wallet, accountId} : wallet;
      } catch (e) {
        console.error('Error in hedera attachAccountId', e);
        return wallet;
      }
    },
    /**
     * What the ledger knows about an arbitrary recipient, for the Send screen.
     * `inputType` tells the caller which form the user typed. Never throws.
     */
    lookupAddressIdentifiers: async ({address}) => {
      const value = typeof address === 'string' ? address.trim() : '';
      const none = {
        inputType: 'unknown',
        accountId: null,
        evmAddress: null,
        exists: false,
      };
      try {
        if (isHederaAccountId(value)) {
          const resp = await HEDERA.getAccountInfo(value);
          const data = resp?.data;
          if (!data?.account) {
            return {...none, inputType: 'accountId', accountId: value};
          }
          return {
            inputType: 'accountId',
            accountId: data.account,
            evmAddress: data.evm_address
              ? normalizeEvmAddress(data.evm_address)
              : null,
            exists: true,
          };
        }
        if (isHederaEvmAddress(value)) {
          const evmAddress = normalizeEvmAddress(value);
          const accountId = await resolveHederaAccountId(evmAddress);
          return {
            inputType: 'evmAddress',
            accountId,
            evmAddress,
            exists: !!accountId,
          };
        }
        return none;
      } catch (e) {
        console.error('Error in hedera lookupAddressIdentifiers', e);
        return none;
      }
    },
    getAccountIdentifiers: async ({address, privateKey}) => {
      let evmAddress = isHederaEvmAddress(address)
        ? normalizeEvmAddress(address)
        : null;
      if (!evmAddress && privateKey) {
        try {
          evmAddress = deriveHederaEvmAddress(privateKey);
        } catch (e) {
          evmAddress = null;
        }
      }
      let accountId = null;
      try {
        accountId = await resolveHederaAccountId(address);
      } catch (e) {
        console.error('Error in hedera getAccountIdentifiers', e);
      }
      return {evmAddress, accountId, isActivated: !!accountId};
    },
    // hedera_getNodeAddresses: consensus nodes of the requested network.
    getNodeAddresses: async ({network} = {}) => {
      let client;
      try {
        client = Client.forName(network || appNetwork());
        return {nodes: Object.values(client.network).map(String)};
      } finally {
        closeClient(client);
      }
    },
    // hedera_signMessage: {signerAccountId, message} → {signatureMap}
    signMessage: async ({signTypeData, privateKey, chainId}) => {
      try {
        assertNetwork(chainId);
        const message = requireStringParam('message', signTypeData?.message);
        const key = PrivateKey.fromStringECDSA(privateKey);
        return {
          signatureMap: encodeSignatureMap(
            key,
            key.sign(prefixMessage(message)),
          ),
        };
      } catch (e) {
        console.error('Error in hedera signMessage', e);
        throw e;
      }
    },
    // hedera_signTransaction: {signerAccountId, transactionBody} → {signatureMap}
    // The dApp sends one node's TransactionBody and merges the signature into
    // its own TransactionList, so only the raw body bytes are signed here.
    signRawTransaction: async ({signTypeData, privateKey, chainId}) => {
      try {
        assertNetwork(chainId);
        if (
          signTypeData?.transactionBody === undefined &&
          signTypeData?.transactionList !== undefined
        ) {
          throw new Error(
            'hedera_signTransaction expects transactionBody (base64 TransactionBody bytes), not transactionList',
          );
        }
        const bodyBytes = fromBase64(
          requireStringParam('transactionBody', signTypeData?.transactionBody),
        );
        proto.TransactionBody.decode(bodyBytes);
        const key = PrivateKey.fromStringECDSA(privateKey);
        return {signatureMap: encodeSignatureMap(key, key.sign(bodyBytes))};
      } catch (e) {
        console.error('Error in hedera signTransaction', e);
        throw e;
      }
    },
    // hedera_signAndExecuteTransaction: {signerAccountId, transactionList}
    // → TransactionResponse.toJSON(). Incomplete transactions (HIP-745) are
    // frozen with our client first. Returns after precheck like the reference
    // wallet; the dApp fetches its own receipt.
    sendRawTransaction: async ({signTypeData, privateKey, chainId}) => {
      let client;
      try {
        assertNetwork(chainId);
        const transactionList = requireStringParam(
          'transactionList',
          signTypeData?.transactionList,
        );
        const signerAccountId = parseSignerAccountId(
          requireStringParam('signerAccountId', signTypeData?.signerAccountId),
        );
        await assertAccountControlledByKey(signerAccountId, privateKey);
        const key = PrivateKey.fromStringECDSA(privateKey);
        const transaction = Transaction.fromBytes(fromBase64(transactionList));
        client = newClient().setOperator(signerAccountId, key);
        if (!transaction.isFrozen()) {
          transaction.freezeWith(client);
        }
        await transaction.sign(key);
        const response = await transaction.execute(client);
        return response.toJSON();
      } catch (e) {
        console.error('Error in hedera signAndExecuteTransaction', e);
        withJsonRpcError(e);
      } finally {
        closeClient(client);
      }
    },
    // hedera_executeTransaction: {transactionList} (already signed) →
    // TransactionResponse.toJSON(). No operator: nothing is signed here.
    executeTransaction: async ({signTypeData, chainId}) => {
      let client;
      try {
        assertNetwork(chainId);
        const transactionList = requireStringParam(
          'transactionList',
          signTypeData?.transactionList,
        );
        const transaction = Transaction.fromBytes(fromBase64(transactionList));
        client = newClient();
        const response = await transaction.execute(client);
        return response.toJSON();
      } catch (e) {
        console.error('Error in hedera executeTransaction', e);
        withJsonRpcError(e);
      } finally {
        closeClient(client);
      }
    },
    // hedera_signAndExecuteQuery: {signerAccountId, query} → {response}. The
    // signer pays the query fee, so it runs on an operator client.
    signAndExecuteQuery: async ({signTypeData, privateKey, chainId}) => {
      let client;
      try {
        assertNetwork(chainId);
        const queryBytes = requireStringParam('query', signTypeData?.query);
        const signerAccountId = parseSignerAccountId(
          requireStringParam('signerAccountId', signTypeData?.signerAccountId),
        );
        const key = PrivateKey.fromStringECDSA(privateKey);
        const query = Query.fromBytes(fromBase64(queryBytes));
        client = newClient().setOperator(signerAccountId, key);
        const result = await query.execute(client);
        return {
          response: Array.isArray(result)
            ? result.map(encodeQueryResult).join(',')
            : encodeQueryResult(result),
        };
      } catch (e) {
        console.error('Error in hedera signAndExecuteQuery', e);
        withJsonRpcError(e);
      } finally {
        closeClient(client);
      }
    },
    // An unfunded EVM address has no account yet, which reads as zero.
    getBalance: async ({address}) => {
      try {
        const resp = await HEDERA.getAccountInfo(address);
        return resp?.data?.balance?.balance?.toString() || '0';
      } catch (e) {
        console.error('error in get balance from hedera', e);
        return '0';
      }
    },

    /**
     * Prices the transfer with the network's fee estimator and converts with
     * the current exchange rate. `estimatedFee` is what the sender will pay
     * and what the Transfer screen shows; `fee`/`transactionFee` is the cap
     * handed to setMaxTransactionFee. Sending to an EVM address without an
     * account also charges the payer for creating it, so that CryptoCreate is
     * estimated and added.
     */
    getEstimateFee: async ({toAddress, privateKey, memo} = {}) => {
      let client;
      try {
        client = getReadOnlyClient();
        const recipient = toAddress || FEE_ESTIMATE_RECIPIENT;
        let usd = await estimateUsd(
          client,
          new TransferTransaction()
            .addHbarTransfer(FEE_ESTIMATE_PAYER, new Hbar(-1))
            .addHbarTransfer(recipient, new Hbar(1))
            .setTransactionMemo(memo?.toString() || ''),
        );
        if (isHederaEvmAddress(toAddress)) {
          const recipientAccountId = await resolveHederaAccountId(toAddress);
          if (!recipientAccountId) {
            const publicKey = privateKey
              ? PrivateKey.fromStringECDSA(privateKey).publicKey
              : PrivateKey.generateECDSA().publicKey;
            usd += await estimateUsd(
              client,
              new AccountCreateTransaction()
                .setKeyWithoutAlias(publicKey)
                .setAlias(normalizeEvmAddress(toAddress)),
            );
          }
        }
        const rate = await hbarPerUsd();
        const estimatedFee = new BigNumber(usd)
          .multipliedBy(rate)
          .toFixed(HBAR_DECIMALS, BigNumber.ROUND_UP);
        const fee = new BigNumber(estimatedFee)
          .multipliedBy(MAX_FEE_MARGIN)
          .toFixed(HBAR_DECIMALS, BigNumber.ROUND_UP);
        return {estimatedFee, fee, transactionFee: fee};
      } catch (e) {
        console.error('Error in hedera gas fee', e);
        throw e;
      } finally {
        closeClient(client);
      }
    },

    getTransactions: async ({address}) => {
      try {
        const accountId = await resolveHederaAccountId(address);
        if (!accountId) {
          return [];
        }
        const resp = await HEDERA?.getTransactions(accountId);
        if (Array.isArray(resp?.data)) {
          return resp.data.map(item =>
            toTransactionRecord(item, item?.transaction_id, accountId, address),
          );
        }
        return [];
      } catch (e) {
        console.error(`error getting transactions for hedera ${e}`);
        return [];
      }
    },
    getTransaction: async ({txHash, address}) => {
      try {
        const transaction = await HEDERA?.getTransaction(txHash);
        const record = transaction?.data;
        if (!record) {
          return {data: null};
        }
        const accountId = address
          ? await resolveHederaAccountId(address)
          : null;
        return {data: toTransactionRecord(record, txHash, accountId, address)};
      } catch (e) {
        console.error(`error getting transactions for hedera ${e}`);
        return {data: null};
      }
    },

    /**
     * `to` may be `0.0.N`, an EVM address (funded or not — an unfunded one is
     * auto-created at the sender's expense) or a long-zero address. Our own
     * account must exist and be bound to our key.
     */
    send: async ({to, from, amount, privateKey, memo, transactionFee}) => {
      let client;
      try {
        const fromAccountId = await resolveHederaAccountId(from);
        if (!fromAccountId) {
          throw new Error(HEDERA_UNACTIVATED_MESSAGE);
        }
        await assertAccountControlledByKey(fromAccountId, privateKey);
        const hbar = toHbar(amount);
        client = getSignerClient(fromAccountId, privateKey);
        const transaction = new TransferTransaction()
          .addHbarTransfer(fromAccountId, hbar.negated())
          .addHbarTransfer(to, hbar)
          .setTransactionMemo(memo?.toString() || '');
        if (transactionFee) {
          transaction.setMaxTransactionFee(toMaxFeeHbar(transactionFee));
        }
        const response = await transaction.execute(client);
        return {
          transactionId: toMirrorTransactionId(response.transactionId),
          // eslint-disable-next-line no-undef
          transactionHash: Buffer.from(response.transactionHash).toString(
            'hex',
          ),
          response,
        };
      } catch (e) {
        console.error('Error in send hedera transaction', e);
        throw e;
      } finally {
        closeClient(client);
      }
    },
    waitForConfirmation: async ({transaction}) => {
      let client;
      try {
        const response = transaction?.response ?? transaction;
        client = getReadOnlyClient();
        // getReceipt throws ReceiptStatusError on any non-success status.
        const receipt = await response.getReceipt(client);
        if (receipt.status !== Status.Success) {
          console.error('Transaction status', receipt?.status);
          throw new Error('Transaction failed');
        }
        return transaction;
      } catch (e) {
        console.error('error in wait for transaction', e);
        throw e;
      } finally {
        closeClient(client);
      }
    },
  };
};
