import BigNumber from 'bignumber.js';
import {Client} from 'xrpl';
import {sign, deriveAddress} from 'ripple-keypairs';
import {encodeForSigning} from 'ripple-binary-codec';
import {ec as EC, eddsa as EDDSA} from 'elliptic';
import {getRPCUrl} from 'dok-wallet-blockchain-networks/rpcUrls/rpcUrls';
import {
  convertToSmallAmount,
  getExplorerTxUrl,
  validateNumber,
} from 'dok-wallet-blockchain-networks/helper';

function extractTxJson(data) {
  if (!data) {
    return {};
  }
  if (Array.isArray(data)) {
    return extractTxJson(data[0]);
  }
  if (data.tx_json) {
    return data.tx_json;
  }
  if (data.transaction) {
    return data.transaction;
  }
  return data;
}

function hexToBytes(hex) {
  const bytes = [];
  for (let i = 0; i < hex.length; i += 2) {
    bytes.push(Number.parseInt(hex.slice(i, i + 2), 16));
  }
  return bytes;
}

function bytesToHex(bytes) {
  return Array.from(bytes)
    .map(b => b.toString(16).padStart(2, '0'))
    .join('')
    .toUpperCase();
}

function derivePublicKey(privateKey) {
  const keyUpper = privateKey.toUpperCase();
  if (keyUpper.startsWith('ED')) {
    const ed = new EDDSA('ed25519');
    return (
      'ED' +
      bytesToHex(ed.keyFromSecret(hexToBytes(keyUpper.slice(2))).pubBytes())
    );
  }
  const secp = new EC('secp256k1');
  const rawPrivKey = keyUpper.startsWith('00') ? keyUpper.slice(2) : keyUpper;
  return bytesToHex(
    secp.keyFromPrivate(rawPrivKey, 'hex').getPublic().encodeCompressed(),
  );
}

export const RippleChain = () => {
  let rippleProvider;
  try {
    rippleProvider = new Client(getRPCUrl('ripple'));
  } catch (e) {
    console.error(`error creating RippleChain ${e}`);
    throw e;
  }
  return {
    isValidAddress: ({address}) => {
      return !(
        /^r[rpshnaf39wBUDNEGHJKLM4PQRST7VWXYZ2bcdeCg65jkm8oFqi1tuvAxyz]{27,35}$/.test(
          address,
        ) === false
      );
    },
    getBalance: async ({address}) => {
      try {
        await rippleProvider.connect();
        const balances = await rippleProvider.getBalances(address);
        if (!balances[0]?.value) {
          return '0';
        }
        return new BigNumber(balances[0].value)
          .multipliedBy(new BigNumber(1000000))
          .toString();
      } catch (e) {
        console.error('error in get balance from ripple', e);
        return '0';
      }
    },
    getEstimateFee: async ({toAddress, amount, minimumBalance}) => {
      try {
        const isAccountExist = await RippleChain().isAccountExist(toAddress);
        const localMinimumBalance = minimumBalance || 10;
        if (
          !isAccountExist &&
          new BigNumber(amount).lt(new BigNumber(localMinimumBalance))
        ) {
          throw Error(
            `The account does not exist on the ripple so transaction must be greater than or equal to ${localMinimumBalance} XRP`,
          );
        }
        await rippleProvider.connect();
        const data = await rippleProvider.request({command: 'server_info'});
        const loadFactor = data?.result?.info?.load_factor || 1;
        const baseFee =
          data?.result?.info?.validated_ledger?.base_fee_xrp || 0.00001;
        const finalAmount = new BigNumber(baseFee).multipliedBy(loadFactor);
        return {
          fee: finalAmount?.toString(),
          gasFee: finalAmount?.toString(),
        };
      } catch (e) {
        console.error('Error in gas fee for ripple', e);
        throw e;
      }
    },
    getTransactions: async ({address}) => {
      try {
        await rippleProvider.connect();
        const data = await rippleProvider.request({
          command: 'account_tx',
          account: address,
          ledger_index_min: -1,
          ledger_index_max: -1,
          binary: false,
          limit: 20,
          forward: false,
        });
        if (Array.isArray(data?.result?.transactions)) {
          return data?.result?.transactions.map(item => {
            const tx = item;
            const bnValue = BigInt(tx?.tx_json?.DeliverMax || 0);
            const txHash = tx?.hash;
            return {
              amount: bnValue?.toString(),
              link: txHash,
              url: getExplorerTxUrl('ripple', txHash),
              status: item?.validated ? 'SUCCESS' : 'FAIL',
              date: new Date(tx?.close_time_iso), //new Date(transaction.raw_data.timestamp),
              from: tx?.tx_json?.Account,
              to: tx?.tx_json?.Destination,
              totalCourse: '0$',
              transactionType: 'regular',
              blockNumber: item?.ledger_index,
            };
          });
        }
        return [];
      } catch (e) {
        console.error(`error getting transactions for ripple ${e}`);
        return [];
      }
    },
    getTransaction: async ({txHash}) => {
      try {
        await rippleProvider.connect();
        const [data, ledgerData] = await Promise.all([
          rippleProvider.request({
            command: 'tx',
            transaction: txHash,
            binary: false,
          }),
          rippleProvider.request({command: 'ledger_current'}).catch(() => null),
        ]);
        const tx = data?.result;
        const bnValue = BigInt(tx?.tx_json?.DeliverMax || 0);
        const blockNumber = tx?.ledger_index ?? null;
        const currentLedger = ledgerData?.result?.ledger_current_index ?? null;
        const confirmations =
          blockNumber !== null && currentLedger !== null
            ? currentLedger - blockNumber
            : null;
        return {
          data: {
            amount: bnValue?.toString(),
            link: txHash,
            url: getExplorerTxUrl('ripple', txHash),
            status: tx?.validated ? 'SUCCESS' : 'FAIL',
            date: new Date(tx?.close_time_iso),
            from: tx?.tx_json?.Account,
            to: tx?.tx_json?.Destination,
            totalCourse: '0$',
            blockNumber,
            confirmations,
          },
        };
      } catch (e) {
        console.error(`error getting transaction for ripple ${e}`);
        return {data: null};
      }
    },
    signRawTransaction: async ({transaction, privateKey}) => {
      try {
        await rippleProvider.connect();
        const publicKey = derivePublicKey(privateKey);
        const txJson = extractTxJson(transaction);
        const tx = {
          ...txJson,
          Account: txJson.Account ?? deriveAddress(publicKey),
        };
        // Drop any LastLedgerSequence the dApp pre-computed — by the time
        // the user reviews and approves in the WC modal it may already
        // have expired, so let autofill recompute it fresh relative to now.
        delete tx.LastLedgerSequence;
        const prepared = await rippleProvider.autofill(tx);
        prepared.SigningPubKey = publicKey;
        const encoded = encodeForSigning(prepared);
        prepared.TxnSignature = sign(encoded, privateKey);
        return prepared;
      } catch (e) {
        console.error('Error in ripple signTransaction', e);
        throw e;
      }
    },
    sendRawTransaction: async ({transaction, privateKey}) => {
      try {
        await rippleProvider.connect();
        const publicKey = derivePublicKey(privateKey);
        const txJson = extractTxJson(transaction);
        const tx = {
          ...txJson,
          Account: txJson.Account ?? deriveAddress(publicKey),
        };
        delete tx.LastLedgerSequence;
        const prepared = await rippleProvider.autofill(tx);
        prepared.SigningPubKey = publicKey;
        const encoded = encodeForSigning(prepared);
        prepared.TxnSignature = sign(encoded, privateKey);
        const result = await rippleProvider.submitAndWait(prepared);
        return {hash: result?.result?.hash ?? result?.hash};
      } catch (e) {
        console.error('Error in ripple signAndSubmitTransaction', e);
        throw e;
      }
    },
    signMessage: ({message, privateKey}) => {
      try {
        // eslint-disable-next-line no-undef
        const messageHex = Buffer.from(message, 'utf8')
          .toString('hex')
          .toUpperCase();
        return sign(messageHex, privateKey);
      } catch (e) {
        console.error('Error in ripple signMessage', e);
        throw e;
      }
    },
    send: async ({to, from, amount, privateKey, publicKey, gasFee, memo}) => {
      try {
        await rippleProvider.connect();
        const transaction = {
          TransactionType: 'Payment',
          Account: from,
          Fee: convertToSmallAmount(gasFee, 6).toString(),
          Amount: convertToSmallAmount(amount, 6).toString(),
          Destination: to,
        };
        if (validateNumber(memo)) {
          transaction.DestinationTag = Number(memo);
        }
        const preparedTransaction = await rippleProvider.autofill(transaction);
        preparedTransaction.SigningPubKey = publicKey; // HERE: move this up above the encoding
        const preparedTransactionHex = encodeForSigning(preparedTransaction);
        preparedTransaction.TxnSignature = sign(
          preparedTransactionHex,
          privateKey,
        );
        return await rippleProvider.submitAndWait(preparedTransaction);
      } catch (e) {
        console.error('Error in send ripple transaction', e);
      }
    },
    waitForConfirmation: async () => {
      return true;
    },
    isAccountExist: async address => {
      try {
        await rippleProvider.connect();
        const balances = await rippleProvider.getBalances(address);
        return !!balances;
      } catch (e) {
        return false;
      }
    },
  };
};
