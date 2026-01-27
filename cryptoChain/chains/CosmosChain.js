import BigNumber from 'bignumber.js';
import {ethers} from 'ethers';
import {
  convertToSmallAmount,
  getCosmosRequiredFeeAmount,
  isValidStringWithValue,
} from 'dok-wallet-blockchain-networks/helper';
import {
  coins,
  SigningStargateClient,
  StargateClient,
  assertIsDeliverTxSuccess,
} from '@cosmjs/stargate';
import {DirectSecp256k1Wallet} from '@cosmjs/proto-signing';
import {fromBech32} from '@cosmjs/encoding';
import {CosmosScan} from 'dok-wallet-blockchain-networks/service/mintscan';
import {config} from 'dok-wallet-blockchain-networks/config/config';
import {getRPCUrl} from 'dok-wallet-blockchain-networks/rpcUrls/rpcUrls';

export const CosmosChain = () => {
  return {
    isValidAddress: ({address}) => {
      try {
        const {prefix, data} = fromBech32(address);
        if (prefix !== 'cosmos') {
          return false;
        }
        return data.length === 20;
      } catch {
        return false;
      }
    },
    isValidPrivateKey: async ({privateKey}) => {
      try {
        const wallet = await DirectSecp256k1Wallet.fromKey(
          // eslint-disable-next-line no-undef
          Buffer.from(privateKey, 'hex'),
        );
        const [account] = await wallet.getAccounts();
        return !!account?.address;
      } catch (e) {
        return false;
      }
    },
    createWalletByPrivateKey: async ({privateKey}) => {
      const wallet = await DirectSecp256k1Wallet.fromKey(
        // eslint-disable-next-line no-undef
        Buffer.from(privateKey, 'hex'),
      );
      const [account] = await wallet.getAccounts();
      return {
        address: account.address,
        privateKey: privateKey,
      };
    },
    getBalance: async ({address}) => {
      try {
        const client = await StargateClient.connect(getRPCUrl('cosmos'));
        const balances = await client.getAllBalances(address);
        const atomObj = balances?.find(item => item.denom === 'uatom');
        return atomObj?.amount || '0';
      } catch (e) {
        console.error('error in get balance from cosmos', e);
        return '0';
      }
    },
    getEstimateFee: async ({toAddress, amount, privateKey}) => {
      let finalEstimateGas = new BigNumber(0);
      try {
        const wallet = await DirectSecp256k1Wallet.fromKey(
          // eslint-disable-next-line no-undef
          Buffer.from(privateKey, 'hex'),
        );
        const [firstAccount] = await wallet.getAccounts();
        const rpcEndpoint = getRPCUrl('cosmos');
        const client = await SigningStargateClient.connectWithSigner(
          rpcEndpoint,
          wallet,
        );
        const parseAmount = convertToSmallAmount('0.0001', 6);
        const msgSend = {
          fromAddress: firstAccount.address,
          toAddress,
          amount: coins(parseAmount, 'uatom'),
        };
        const msgAny = {
          typeUrl: '/cosmos.bank.v1beta1.MsgSend',
          value: msgSend,
        };
        const estimateGas = await client.simulate(
          firstAccount.address,
          [msgAny],
          null,
        );
        // noinspection JSUnusedAssignment
        finalEstimateGas = new BigNumber(estimateGas).multipliedBy(
          new BigNumber(1.4),
        );
        const parseAmont = {
          denom: 'uatom',
          amount: convertToSmallAmount(amount, 6),
        };
        await client.sendTokens(firstAccount.address, toAddress, [parseAmont], {
          amount: [{amount: '1', denom: 'uatom'}],
          gas: estimateGas.toString(),
        });
        return {
          fee: '0',
          estimateGas: '',
          gasFee: '',
        };
      } catch (e) {
        const requireAmount = getCosmosRequiredFeeAmount(e?.message);
        if (requireAmount) {
          const finalFee = Math.round(Number(requireAmount * 1.4))?.toString();
          return {
            fee: ethers.formatUnits(finalFee, 6) || '0',
            estimateGas: finalEstimateGas?.toFixed(0),
            gasFee: {
              amount: [
                {
                  amount: finalFee,
                  denom: 'uatom',
                },
              ],
              gas: finalEstimateGas?.toFixed(0),
            },
          };
        }
        console.error('Error in cosmos gas fee', e.stack);
        throw e;
      }
    },
    getTransactions: async ({address}) => {
      try {
        const transactions = await CosmosScan.getTransactions(address);
        if (Array.isArray(transactions?.data)) {
          return transactions?.data?.map(item => {
            const txHash = item?.txhash;
            const events = item?.logs[0]?.events || [];
            const transferObj = events?.find(
              subItem => subItem.type === 'transfer',
            );
            const sender = transferObj?.attributes?.find(
              subItem => subItem?.key === 'sender',
            )?.value;
            const recipient = transferObj?.attributes?.find(
              subItem => subItem?.key === 'recipient',
            )?.value;
            const amount = transferObj?.attributes?.find(
              subItem => subItem?.key === 'amount',
            )?.value;
            const finalAmount = parseInt(amount || 0, 10);
            return {
              amount: finalAmount.toString(),
              link: txHash.substring(0, 13) + '...',
              url: `${config.COSMOS_SCAN_URL}/cosmos/tx/${txHash}`,
              status: !item?.code ? 'SUCCESS' : 'Failed',
              date: new Date(item?.timestamp), //new Date(transaction.raw_data.timestamp),
              from: sender,
              to: recipient,
              totalCourse: '0$',
            };
          });
        }
        return [];
      } catch (e) {
        console.error(`error getting transactions for cosmos ${e}`);
        return [];
      }
    },
    send: async ({
      to,
      from,
      amount,
      privateKey,
      transactionFee,
      gasFee,
      memo,
    }) => {
      try {
        const wallet = await DirectSecp256k1Wallet.fromKey(
          // eslint-disable-next-line no-undef
          Buffer.from(privateKey, 'hex'),
        );
        const [firstAccount] = await wallet.getAccounts();
        const rpcEndpoint = getRPCUrl('cosmos');
        const client = await SigningStargateClient.connectWithSigner(
          rpcEndpoint,
          wallet,
        );
        const parseAmont = {
          denom: 'uatom',
          amount: convertToSmallAmount(amount, 6),
        };
        const result = await client.sendTokens(
          firstAccount.address,
          to,
          [parseAmont],
          gasFee,
          isValidStringWithValue(memo) ? memo : null,
        );
        assertIsDeliverTxSuccess(result);
        return result?.transactionHash;
      } catch (e) {
        console.error('Error in send cosmos transaction', e);
      }
    },
    waitForConfirmation: async () => {
      return true;
    },
  };
};
