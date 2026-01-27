import {Alert} from 'react-native';
import {
  connect,
  defaultConfig,
  Network,
  Seed,
  ReceivePaymentMethod,
  SendPaymentMethod,
  SendPaymentMethod_Tags,
  InputType_Tags,
} from '@breeztech/breez-sdk-spark-react-native';
import {config, IS_SANDBOX} from 'dok-wallet-blockchain-networks/config/config';

import {DocumentDirectoryPath} from 'react-native-fs';

function decimalStringToBigInt(value, decimals) {
  if (!/^\d+(\.\d+)?$/.test(value)) {
    throw new Error('Invalid decimal string');
  }

  const [intPart, fracPart = ''] = value.split('.');
  const paddedFrac = (fracPart + '0'.repeat(decimals)).slice(0, decimals);

  return BigInt(intPart + paddedFrac);
}

class JsEventListener {
  constructor(callback) {
    this.callback = callback;
  }

  onEvent = event => {
    if (this.callback) {
      this.callback(event);
    }
  };
}

let sdkInstance = null;
let connectingPromise = null;
let prepareSendResponse;

const sdkMap = new Map();
export const BitcoinLightningChain = (chain, phrase) => {
  const commonConnectSdk = async mnemonic => {
    try {
      const network = IS_SANDBOX ? Network.Regtest : Network.Mainnet;
      let config = defaultConfig(network);
      config.apiKey = process.env.BREEZ_API_KEY;
      const baseDir = DocumentDirectoryPath.replace('file://', '');
      const workingDir = `${baseDir}breezSdkSpark`;

      const seed = new Seed.Mnemonic({mnemonic});

      sdkInstance = await connect({
        config,
        seed,
        storageDir: workingDir,
      });
      sdkMap.set(mnemonic, sdkInstance);
      return sdkInstance;
    } catch (err) {
      console.error('❌ Connection error:', err);
      sdkInstance = null;
      connectingPromise = null;
      throw err;
    }
  };

  async function connectToSdk() {
    let mnemonic = phrase;
    if (sdkInstance) {
      if (sdkMap.has(mnemonic)) {
        return sdkMap.get(mnemonic);
      } else {
        // Initialize sdkInstance for the new mnemonic
        if (!mnemonic) return sdkInstance;
        connectingPromise = commonConnectSdk(mnemonic);
        return connectingPromise;
      }
      // return sdkInstance;
    }

    if (connectingPromise) {
      return connectingPromise;
    }

    connectingPromise = commonConnectSdk(mnemonic);

    return connectingPromise;
  }

  async function getBalance() {
    const sdk = await connectToSdk();
    const obj1 = Object.fromEntries(sdkMap);
    const info = await sdk.getInfo({});
    return info.balanceSats;
  }

  async function isValidAddress({address}) {
    const sdk = await connectToSdk();
    if (!sdk) {
      Alert.alert('Error', 'SDK not connected or no payment request');
      return;
    }
    const input = await sdk.parse(address);
    if (input.tag === InputType_Tags.BitcoinAddress) {
      console.log(`Input is Bitcoin address ${input.inner[0].address}`);
      return false;
    } else if (input.tag === InputType_Tags.Bolt11Invoice) {
      console.log(
        `Input is BOLT11 invoice for ${
          input.inner[0].amountMsat != null
            ? input.inner[0].amountMsat.toString()
            : 'unknown'
        } msats`,
      );
      return true;
    } else if (input.tag === InputType_Tags.SparkAddress) {
      console.log(`Input is Spark address ${input.inner[0].address}`);
      return true;
    }
    return false;
  }

  async function fetchPayments() {
    const sdk = await connectToSdk();
    if (!sdk) return;

    try {
      const response = await sdk.listPayments({
        offset: undefined,
        limit: 20,
      });
      return {
        paymentDetails: response.payments,
      };
    } catch (err) {
      console.error('Error fetching payments:', err);
      Alert.alert('payment fetch Error', err.message);
    }
  }

  async function generateInvoiceViaBolt11() {
    const sdk = await connectToSdk();
    if (!sdk) {
      Alert.alert('Error', 'SDK not connected');
      return;
    }
    try {
      const response = await sdk.receivePayment({
        paymentMethod: new ReceivePaymentMethod.Bolt11Invoice({
          description: 'Payment',
        }),
      });
      return {
        address: response.paymentRequest,
        receiveFeeSats: response.fee,
      };
    } catch (err) {
      console.error('Error generating invoice:', err);
      Alert.alert('Invoice Error', err.message);
    }
  }

  async function generateSparkAddress() {
    const sdk = await connectToSdk();
    if (!sdk) {
      Alert.alert('Error', 'SDK not connected');
      return;
    }
    try {
      const response = await sdk.receivePayment({
        paymentMethod: new ReceivePaymentMethod.SparkAddress(),
      });

      return {
        address: response.paymentRequest,
        receiveFeeSats: response.fee,
      };
    } catch (error) {
      console.error('Error generating invoice:', error);
      Alert.alert('Invoice Error', error.message);
    }
  }

  async function generateInvoiceViaBitcoinAddress() {
    const sdk = await connectToSdk();
    if (!sdk) {
      Alert.alert('Error', 'SDK not connected');
      return;
    }

    try {
      const response = await sdk.receivePayment({
        paymentMethod: new ReceivePaymentMethod.BitcoinAddress(),
      });

      return {
        address: response.paymentRequest,
        receiveFeeSats: response.fee,
      };
    } catch (err) {
      console.error('Error generating invoice:', err);
      Alert.alert('Invoice Error', err.message);
    }
  }

  async function prepareAndSendPayment(paymentRequest, amount) {
    const sdk = await connectToSdk();
    if (!sdk || !paymentRequest) {
      Alert.alert('Error', 'SDK not connected or no payment request');
      return;
    }

    try {
      const prepareResponse = await sdk.prepareSendPayment({
        paymentRequest,
        amount: decimalStringToBigInt(amount, 8),
      });
      prepareSendResponse = prepareResponse;
      if (
        prepareResponse.paymentMethod instanceof SendPaymentMethod.Bolt11Invoice
      ) {
        const lightningFee =
          prepareResponse.paymentMethod.inner.lightningFeeSats;
        const sparkFee =
          prepareResponse.paymentMethod.inner.sparkTransferFeeSats;

        return {
          lightningFee: lightningFee,
          sparkFee: sparkFee,
        };
      }
      if (
        prepareResponse.paymentMethod?.tag ===
        SendPaymentMethod_Tags.SparkAddress
      ) {
        const feeSats = prepareResponse.paymentMethod.inner.fee;
        return {
          lightningFee: feeSats,
          sparkFee: '',
        };
      }
      return {};
    } catch (err) {
      console.error('Error preparing payment:', err);
      Alert.alert('Prepare Error', err.message);
    }
  }

  function satoshiToBtc(sats) {
    if (sats === null || sats === undefined) return 0;

    // Handle BigInt or number or string safely
    const satsNumber = typeof sats === 'bigint' ? Number(sats) : Number(sats);

    return satsNumber / 100_000_000;
  }

  async function getEstimateFee({
    fromAddress,
    toAddress,
    amount,
    privateKey,
    chain_name,
    deriveAddresses,
    balance,
    extendedPrivateKey,
    feeMultiplier,
    estimateGas: virtualSize,
    feesType,
    selectedUTXOs,
  }) {
    try {
      const {lightningFee} = await prepareAndSendPayment(toAddress, amount);
      const fee = satoshiToBtc(lightningFee);
      return {
        fee: fee,
        estimateGas: 0,
        feesOptions: [],
      };
    } catch (error) {
      console.error('Error in bitcoin gas fee', error);
      throw error;
    }
  }

  async function send({
    to,
    from,
    amount,
    privateKey,
    transactionFee,
    chain_name,
    deriveAddresses,
    balance,
    extendedPrivateKey,
    selectedUTXOs,
  }) {
    try {
      const sdk = await connectToSdk();
      if (!sdk || !prepareSendResponse) {
        Alert.alert('Error', 'SDK not connected or no payment request');
        return;
      }

      if (
        prepareSendResponse.paymentMethod?.tag ===
        SendPaymentMethod_Tags.SparkAddress
      ) {
        console.log(
          `Token ID: ${prepareSendResponse.paymentMethod.inner.tokenIdentifier}`,
        );
        console.log(
          `Fees: ${prepareSendResponse.paymentMethod.inner.fee} token base units`,
        );
      }
      if (
        prepareSendResponse.paymentMethod?.tag ===
        SendPaymentMethod_Tags.SparkInvoice
      ) {
        console.log(
          `Token ID: ${prepareSendResponse.paymentMethod.inner.tokenIdentifier}`,
        );
        console.log(
          `Fees: ${prepareSendResponse.paymentMethod.inner.fee} token base units`,
        );
      }

      // Send the token payment
      const sendResponse = await sdk.sendPayment({
        prepareResponse: prepareSendResponse,
        options: undefined,
        idempotencyKey: undefined,
      });
      const payment = sendResponse.payment;
      return payment.id;
    } catch (error) {
      console.error('Error in bitcoin gas fee', error);
      throw error;
    }
  }

  async function waitForConfirmation({transaction}) {
    const transactionID = transaction;
    console.log('transactionID:', transactionID);

    const sdk = await connectToSdk();

    if (!sdk) {
      Alert.alert('Error', 'SDK not connected');
      return;
    }

    return new Promise(async (resolve, reject) => {
      let listenerId = null;
      let timeoutId = null;
      let resolved = false;

      try {
        const eventListener = new JsEventListener(async event => {
          if (resolved) return;

          if (event.tag === 'PaymentSucceeded' || event.tag === 'Synced') {
            resolved = true;

            // 🧹 cleanup
            if (listenerId !== null) {
              sdk.removeEventListener(listenerId);
            }
            if (timeoutId) {
              clearTimeout(timeoutId);
            }

            resolve(true);
          }
        });

        listenerId = await sdk.addEventListener(eventListener);

        // ⏱️ 90 seconds timeout
        timeoutId = setTimeout(() => {
          if (resolved) return;

          resolved = true;

          console.log('⏱️ Payment confirmation timeout (90s)');

          // 🧹 cleanup
          if (listenerId !== null) {
            sdk.removeEventListener(listenerId);
          }

          resolve('pending');
        }, 90_000); // 90 seconds
      } catch (error) {
        console.error('Error in waitForConfirmation:', error);

        // 🧹 cleanup
        if (listenerId !== null) {
          sdk.removeEventListener(listenerId);
        }
        if (timeoutId) {
          clearTimeout(timeoutId);
        }

        reject(error);
      }
    });
  }

  async function getTransactions() {
    try {
      const sdk = await connectToSdk();
      Alert.alert('SDK instance', sdk ? 'Connected' : 'Not connected');
      if (!sdk) return;

      const response = await sdk.listPayments({
        offset: undefined,
        limit: 20,
      });
      const transactions = response.payments;
      if (Array.isArray(transactions)) {
        return transactions.map(item => {
          const txHash = item?.details.inner?.paymentHash || item?.id || 'N/A';
          return {
            amount: item.amount,
            link: txHash?.substring(0, 13) + '...',
            url: `${config.BITCOIN_LIGHTNING_URL}/tx/${txHash}`,
            status: item?.status ? 'Pending' : 'SUCCESS',
            date: Number(item?.timestamp) * 1000,
            from: item?.details.inner?.preimage,
            to: item?.details.inner?.destinationPubKey,
            totalCourse: '0$',
            paymentType: item.paymentType,
          };
        });
      }
      return [];
    } catch (error) {
      console.error(
        `error getting transactions for bitcoin lightning ${error}`,
      );
      return [];
    }
  }
  return {
    connectToSdk,
    getBalance,
    isValidAddress,
    fetchPayments,
    generateInvoiceViaBolt11,
    generateInvoiceViaBitcoinAddress,
    generateSparkAddress,
    prepareAndSendPayment,
    getEstimateFee,
    send,
    waitForConfirmation,
    getTransactions,
  };
};
