import {IS_SANDBOX} from 'dok-wallet-blockchain-networks/config/config';
import {ethers} from 'ethers';
import BigNumber from 'bignumber.js';
import {createWallet} from 'myWallet/wallet.service';
import {HEDERA} from 'dok-wallet-blockchain-networks/service/Hedera';

import {
  AccountId,
  Client,
  Hbar,
  PrivateKey,
  Status,
  Transaction,
  TransferTransaction,
} from '@hiero-ledger/sdk';
import {
  getExplorerTxUrl,
  HEDERA_UNACTIVATED_MESSAGE,
} from 'dok-wallet-blockchain-networks/helper';

/**
 * Account model (HIP-583).
 *
 * The wallet derives an ECDSA secp256k1 key (same path as the Ethereum coin)
 * and stores its EVM address as `wallet.address` until the account exists on
 * the ledger. Hedera creates the account itself the first time anyone sends
 * HBAR or a token to that EVM address — the *sender* pays the CryptoCreate fee,
 * the recipient receives the full amount and the new account is "hollow" (no
 * key) until the owner's first outgoing transaction completes it. No operator
 * account is involved anywhere.
 *
 * Once the mirror node resolves the EVM address to `0.0.N`, `upgradeWalletAddress`
 * flips the stored address to the account id (see cryptoChain/index.js), so an
 * activated wallet looks exactly like the pre-HIP-583 model the rest of the app
 * (exchange, WalletConnect, tx history) was written against. Every method here
 * therefore accepts either form.
 */

// USD ceilings used for max transaction fee. A plain HBAR CryptoTransfer costs
// ~$0.0001; MAX_HBAR_TRANSFER_USD is the cap we set. Auto-creating the
// recipient account charges the payer the CryptoCreate fee ($0.05) on top —
// keep a margin for exchange-rate drift between estimate and submit, otherwise
// the node rejects the transfer with INSUFFICIENT_TX_FEE.
const MAX_HBAR_TRANSFER_USD = 0.0021;
export const ACCOUNT_CREATE_USD = 0.05 * 1.5;

const ACCOUNT_ID_REGEX = /^\d+\.\d+\.\d+$/;
const EVM_ADDRESS_REGEX = /^(0x)?[0-9a-fA-F]{40}$/;
const HBAR_DECIMALS = 8;
// Accounts 0.0.0–0.0.1000 are reserved (nodes, fee collection 0.0.98, staking
// rewards 0.0.800/801). Used only to pick counterparties out of a transfer list.
const SYSTEM_ACCOUNT_MAX_NUM = 1000;
// A missing account is re-checked after this long; a found one is immutable.
const NEGATIVE_LOOKUP_TTL_MS = 30 * 1000;

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
 * balance polling and the Receive screen do not hammer the mirror node.
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

// Receipt queries are free and need no operator.
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

export const HederaChain = () => {
  const buildWallet = (evmAddress, privateKey) => {
    if (!isHederaEvmAddress(evmAddress) || !privateKey) {
      throw new Error('Unable to derive Hedera key');
    }
    return {address: normalizeEvmAddress(evmAddress), privateKey};
  };

  return {
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
    // Name kept for cryptoChain/index.js; nothing is created on-chain any more.
    getOrCreateHederaWallet: async ({mnemonic}) => {
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
    signMessage: ({signTypeData, privateKey}) => {
      try {
        const message = signTypeData?.message ?? signTypeData;
        const key = PrivateKey.fromStringECDSA(privateKey);
        // eslint-disable-next-line no-undef
        const messageBytes = Buffer.from(message, 'base64');
        const signatureBytes = key.sign(messageBytes);
        return {
          signatureMap: [
            {
              publicKey: key.publicKey.toStringDer(),
              // eslint-disable-next-line no-undef
              signature: Buffer.from(signatureBytes).toString('base64'),
            },
          ],
        };
      } catch (e) {
        console.error('Error in hedera signMessage', e);
        throw e;
      }
    },
    signRawTransaction: async ({signTypeData, privateKey}) => {
      try {
        const transactionList = signTypeData?.transactionList ?? signTypeData;
        const key = PrivateKey.fromStringECDSA(privateKey);
        const transaction = Transaction.fromBytes(
          // eslint-disable-next-line no-undef
          Buffer.from(transactionList, 'base64'),
        );
        await transaction.sign(key);
        return {
          // eslint-disable-next-line no-undef
          transactionList: Buffer.from(transaction.toBytes()).toString(
            'base64',
          ),
        };
      } catch (e) {
        console.error('Error in hedera signTransaction', e);
        throw e;
      }
    },
    sendRawTransaction: async ({signTypeData, privateKey}) => {
      let tempClient;
      try {
        const transactionList = signTypeData?.transactionList ?? signTypeData;
        const signerAccountId = parseSignerAccountId(
          signTypeData?.signerAccountId,
        );
        const key = PrivateKey.fromStringECDSA(privateKey);
        const transaction = Transaction.fromBytes(
          // eslint-disable-next-line no-undef
          Buffer.from(transactionList, 'base64'),
        );
        tempClient = newClient().setOperator(signerAccountId, key);
        await transaction.sign(key);
        const response = await transaction.execute(tempClient);
        const receipt = await response.getReceipt(tempClient);
        return {
          transactionId: response.transactionId.toString(),
          nodeId: response.nodeId?.toString(),
          // eslint-disable-next-line no-undef
          transactionHash: Buffer.from(response.transactionHash).toString(
            'base64',
          ),
          status: receipt.status.toString(),
        };
      } catch (e) {
        console.error('Error in hedera signAndExecuteTransaction', e);
        throw e;
      } finally {
        closeClient(tempClient);
      }
    },
    // The mirror node accepts both `0.0.N` and an EVM address here; an
    // unfunded address 404s, which reads as a zero balance.
    getBalance: async ({address}) => {
      try {
        const resp = await HEDERA.getAccountInfo(address);
        return resp?.data?.balance?.balance?.toString() || '0';
      } catch (e) {
        console.error('error in get balance from hedera', e);
        return '0';
      }
    },

    getEstimateFee: async ({toAddress} = {}) => {
      try {
        const resp = await HEDERA.getExchangeFee();
        const currentRate = resp?.data?.current_rate;
        const centEquivalent = currentRate?.cent_equivalent;
        const hbarEquivalent = currentRate?.hbar_equivalent;
        const hbarToDollar = centEquivalent / hbarEquivalent / 100;
        if (!Number.isFinite(hbarToDollar) || hbarToDollar <= 0) {
          throw new Error('Invalid HBAR exchange rate');
        }
        let usd = MAX_HBAR_TRANSFER_USD;
        // Sending to an address with no account auto-creates it and the
        // sender is charged the CryptoCreate fee.
        if (toAddress && !isHederaAccountId(toAddress)) {
          const recipientAccountId = await resolveHederaAccountId(toAddress);
          if (!recipientAccountId) {
            usd += ACCOUNT_CREATE_USD;
          }
        }
        const hbar = usd / hbarToDollar;
        return {
          fee: hbar.toFixed(HBAR_DECIMALS),
          transactionFee: hbar.toFixed(HBAR_DECIMALS),
        };
      } catch (e) {
        console.error('Error in hedera gas fee', e);
        throw e;
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
          return resp.data.map(item => {
            const {from, to, amount} = extractTransferParties(
              item,
              accountId,
              address,
            );
            const txHash = item?.transaction_id;
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
          });
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
        const finalTransaction = transaction?.data;
        if (finalTransaction) {
          const accountId = address
            ? await resolveHederaAccountId(address)
            : null;
          const {from, to, amount} = extractTransferParties(
            finalTransaction,
            accountId,
            address,
          );
          return {
            data: {
              amount: amount?.toString() ?? null,
              link: txHash,
              url: getExplorerTxUrl('hedera', txHash),
              status:
                finalTransaction?.result === 'SUCCESS' ? 'SUCCESS' : 'FAIL',
              date: consensusDateMs(finalTransaction?.consensus_timestamp),
              from,
              to,
              totalCourse: '0$',
              blockNumber: finalTransaction?.blockNumber ?? null,
              confirmations: finalTransaction?.confirmations ?? null,
            },
          };
        }
        return {data: null};
      } catch (e) {
        console.error(`error getting transactions for hedera ${e}`);
        return {data: null};
      }
    },

    /**
     * `to` may be `0.0.N`, an EVM address (funded or not — an unfunded one is
     * auto-created at the sender's expense) or a long-zero address. Our own
     * account must exist: a wallet that was never funded has nothing to send.
     */
    send: async ({to, from, amount, privateKey, memo, transactionFee}) => {
      let client;
      try {
        const fromAccountId = await resolveHederaAccountId(from);
        if (!fromAccountId) {
          throw new Error(HEDERA_UNACTIVATED_MESSAGE);
        }
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
