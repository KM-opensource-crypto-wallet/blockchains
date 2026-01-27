import {ethers} from 'ethers';
import {config} from 'dok-wallet-blockchain-networks/config/config';
import BigNumber from 'bignumber.js';
import {Client} from 'xrpl';
import {sign} from 'ripple-keypairs';
import {encodeForSigning} from 'ripple-binary-codec';
import {getRPCUrl} from 'dok-wallet-blockchain-networks/rpcUrls/rpcUrls';
import {validateNumber} from 'dok-wallet-blockchain-networks/helper';

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
              link: txHash.substring(0, 13) + '...',
              url: `${config.RIPPLE_SCAN_URL}/transactions/${txHash}`,
              status: item?.validated ? 'SUCCESS' : 'FAIL',
              date: new Date(tx?.close_time_iso), //new Date(transaction.raw_data.timestamp),
              from: tx?.tx_json?.Account,
              to: tx?.tx_json?.Destination,
              totalCourse: '0$',
            };
          });
        }
        return [];
      } catch (e) {
        console.error(`error getting transactions for ripple ${e}`);
        return [];
      }
    },
    send: async ({to, from, amount, privateKey, publicKey, gasFee, memo}) => {
      try {
        await rippleProvider.connect();
        const transaction = {
          TransactionType: 'Payment',
          Account: from,
          Fee: ethers.parseUnits(gasFee, 6).toString(),
          Amount: ethers.parseUnits(amount, 6).toString(),
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
