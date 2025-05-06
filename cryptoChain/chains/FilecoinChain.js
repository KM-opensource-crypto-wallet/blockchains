import {keyPairFromPrivateKey} from '@nodefactory/filecoin-address';
import axios from 'axios';
import BigNumber from 'bignumber.js';
import {config, IS_SANDBOX} from 'dok-wallet-blockchain-networks/config/config';
import {parseBalance} from 'dok-wallet-blockchain-networks/helper';
import {getFreeRPCUrl} from 'dok-wallet-blockchain-networks/rpcUrls/rpcUrls';
import {
  HttpJsonRpcConnector,
  LotusClient,
  LotusWalletProvider,
  MnemonicWalletProvider,
} from 'filecoin.js';

const derivedPath = IS_SANDBOX ? "m/44'/1'/0'/0/0" : "m/44'/461'/0'/0/0";

export const FilecoinChain = chain_name => {
  const [rpcUrl] = getFreeRPCUrl(chain_name);
  const connector = new HttpJsonRpcConnector(rpcUrl);
  const lotusClient = new LotusClient(connector);
  const wallet = new LotusWalletProvider(lotusClient);

  return {
    isValidAddress: ({address}) => {
      try {
        let regex = /^f1[a-zA-Z0-9]{39}$/;
        if (IS_SANDBOX) {
          regex = /^t1[a-zA-Z0-9]{39}$/;
        }
        return regex.test(address);
      } catch (e) {
        console.log('🚀 - filecoin / isValidAddress: - e:', e);
        return false;
      }
    },
    isValidPrivateKey: async ({privateKey}) => {
      try {
        const generatedKeypair = await FilecoinChain(
          chain_name,
        ).createWalletByPrivateKey({privateKey});
        return !!generatedKeypair?.address;
      } catch (e) {
        console.log('🚀 - isValidPrivateKey: - e:', e);
        return false;
      }
    },
    createWalletByPrivateKey: async ({privateKey}) => {
      try {
        const generatedKeypair = keyPairFromPrivateKey(
          privateKey,
          IS_SANDBOX ? 't' : 'f',
        );
        return {
          address: generatedKeypair?.address?.toString(),
          privateKey: privateKey,
        };
      } catch (e) {
        console.error('error in create wallet from private key', e);
        return null;
      }
    },
    getBalance: async ({address}) => {
      try {
        const balance = await wallet.getBalance(address);
        return balance.toString();
      } catch (e) {
        console.error('error in get balance from filecoin', e);
        return '0';
      }
    },
    getEstimateFee: async ({toAddress, fromAddress, amount}) => {
      try {
        const amountToSend = new BigNumber(amount || 0).times(
          new BigNumber(10).exponentiatedBy(18),
        );
        const nonce = await wallet.getNonce(fromAddress);
        const {GasFeeCap, GasLimit, GasPremium} = await wallet.createMessage({
          Nonce: nonce,
          To: toAddress,
          From: fromAddress,
          Value: amountToSend,
        });
        const gasFee = new BigNumber(GasFeeCap)
          .times(GasLimit)
          .plus(parseFloat(GasPremium.toString()));
        return {
          fee: parseBalance(gasFee.toString(), 18),
          estimateGas: GasLimit,
          gasFee: GasFeeCap.toString(),
        };
      } catch (e) {
        console.error('Error in filecoin gas fee', e);
        throw e;
      }
    },
    getTransactions: async ({address}) => {
      try {
        const lookupId = await wallet.lookupId(address);
        const url = `${config.FILECOIN_SCAN_URL.replace(
          '/en',
          '/api',
        )}/v1/address/${lookupId}/messages?pageSize=20&page=0`;
        const res = await axios.get(url);
        return res.data.messages.map(item => {
          const bnValue = BigInt(item?.value);
          const txHash = item?.cid;
          return {
            amount: bnValue?.toString(),
            link: txHash.substring(0, 13) + '...',
            date: item?.timestamp * 1000,
            status: item?.receipt?.exitCode === 0 ? 'SUCCESS' : 'FAILED',
            url: `${config.FILECOIN_SCAN_URL}/message/${txHash}`,
            from: item?.from,
            to: item?.to,
          };
        });
      } catch (e) {
        console.error('error in get balance from filecoin', e);
        return [];
      }
    },
    send: async ({to, from, amount, phrase}) => {
      try {
        const walletProvider = new MnemonicWalletProvider(
          lotusClient,
          phrase,
          derivedPath,
        );
        await walletProvider.newAddress();
        const nonce = await walletProvider.getNonce(from);
        const amountToSend = new BigNumber(amount || 0).times(
          new BigNumber(10).exponentiatedBy(18),
        );
        const message = await wallet.createMessage({
          To: to,
          From: from,
          Nonce: nonce,
          Value: amountToSend,
        });
        const sendMessage = await walletProvider.signMessage(message);
        const sendSignedMessage = await walletProvider.sendSignedMessage(
          sendMessage,
        );
        return sendSignedMessage['/'];
      } catch (e) {
        console.error('Error in send filecoin transaction', e);
      }
    },
    waitForConfirmation: async ({transaction, interval}) => {
      return new Promise(resolve => {
        const timer = setInterval(async () => {
          try {
            const receipt = await lotusClient.state.waitMsg(
              {'/': transaction},
              0,
            );
            if (receipt?.Receipt?.ExitCode === 0) {
              clearInterval(timer);
              resolve(receipt);
            }
          } catch (error) {
            clearInterval(timer);
            console.log('🚀 - waitForConfirmation: - error:', error);
          }
        }, interval);
      });
    },
  };
};
