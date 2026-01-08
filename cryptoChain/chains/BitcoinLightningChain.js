import {Alert} from 'react-native';
import {
    connect,
    defaultConfig,
    Network,
    Seed,
    ReceivePaymentMethod,
    SendPaymentMethod,
} from '@breeztech/breez-sdk-spark-react-native';
import * as bitcoin from 'bitcoinjs-lib';
import ecc from '@bitcoinerlab/secp256k1';
import { config, IS_SANDBOX } from '../../../dok-wallet-blockchain-networks/config/config';

bitcoin.initEccLib(ecc);
import { DocumentDirectoryPath } from 'react-native-fs';
import BigNumber from 'bignumber.js';
class JsEventListener {
    constructor(callback) {
        this.callback = callback;
    }

    onEvent = event => {
        console.log(`Received event: ${JSON.stringify(event)}`);
        if (this.callback) {
            this.callback(event);
        }
    };
}

let sdkInstance = null;
let connectingPromise = null;
export const BitcoinLightningChain = ({ mnemonic }) => {


    async function connectToSdk() {
        // ✅ Already connected
        if (sdkInstance) {
            return sdkInstance;
        }

        // ✅ Connection already in progress
        if (connectingPromise) {
            return connectingPromise;
        }

        connectingPromise = (async () => {
            try {
                let config = defaultConfig(Network.Regtest);
                config.apiKey = process.env.BREEZ_API_KEY;

                const baseDir = DocumentDirectoryPath.replace('file://', '');
                const workingDir = `${baseDir}breezSdkSpark`;

                const seed = new Seed.Mnemonic({ mnemonic });

                console.log('🔌 Connecting to Breez SDK...');
                sdkInstance = await connect({
                    config,
                    seed,
                    storageDir: workingDir,
                });

                console.log('✅ Breez SDK connected');
                return sdkInstance;
            } catch (err) {
                console.error('❌ Connection error:', err);
                sdkInstance = null;
                connectingPromise = null;
                throw err;
            }
        })();

        return connectingPromise;
    }

    async function getBalance() {
        const sdk = await connectToSdk();

        const info = await sdk.getInfo({});
        console.log('Balance:', info.balanceSats);
        return info.balanceSats;
    }

    async function isValidAddress({ address }) {
        return true;
    }
    // NOTE: fetch payments
    async function fetchPayments() {
        const sdkInstance = await connectToSdk()
        if (!sdkInstance) return;

        try {
            const response = await sdkInstance.listPayments({
                offset: undefined,
                limit: 20,
            });
            console.log('Payments loaded:', response.payments.length);
            return {
                paymentDetails: response.payments,
            }
        } catch (err) {
            console.error('Error fetching payments:', err);
            Alert.alert('payment fetch Error', err.message);
        }
    }

    // NOTE: generate invoice
    async function generateInvoiceViaBolt11({ invoiceAmount, invoiceDescription }) {
        const sdk = await connectToSdk(mnemonic)
        if (!sdk) {
            Alert.alert('Error', 'SDK not connected');
            return;
        }

        try {
            const amountSats = invoiceAmount ? BigInt(invoiceAmount) : undefined;

            const response = await sdk.receivePayment({
                paymentMethod: new ReceivePaymentMethod.Bolt11Invoice({
                    description: invoiceDescription || 'Payment',
                    amountSats,
                }),
            });
            console.log("response=>", response)
            // NOTE vai btc address ub regtest
            // const response = await sdk.receivePayment({
            //   paymentMethod: new ReceivePaymentMethod.BitcoinAddress()
            // })

            console.log('Invoice generated:', response.paymentRequest);
            console.log('Receive fees:', response.fee);
            Alert.alert('Invoice Generated', 'Check the invoice field below');
            return {
                generatedInvoice: response.paymentRequest,
                receiveFeeSats: response.fee,
            }

        } catch (err) {
            console.error('Error generating invoice:', err);
            Alert.alert('Invoice Error', err.message);
        }
    }

    // NOTE: generate invoice via bitcoin address
    async function generateInvoiceViaBitcoinAddress() {
        const sdk = await connectToSdk()
        if (!sdk) {
            Alert.alert('Error', 'SDK not connected');
            return;
        }

        try {
            // const amountSats = invoiceAmount ? BigInt(invoiceAmount) : undefined;

            // NOTE vai btc address ub regtest
            const response = await sdk.receivePayment({
                paymentMethod: new ReceivePaymentMethod.BitcoinAddress()
            })

            console.log('Invoice generated:', response.paymentRequest);
            console.log('Receive fees:', response.fee);
            return {
                address: response.paymentRequest,
                receiveFeeSats: response.fee,
            }

        } catch (err) {
            console.error('Error generating invoice:', err);
            Alert.alert('Invoice Error', err.message);
        }
    }

    // NOTE: prepare payment and send payment
    async function prepareAndSendPayment(paymentRequest, sendAmount) {
        const sdk = await connectToSdk(mnemonic)
        if (!sdk || !paymentRequest) {
            Alert.alert('Error', 'SDK not connected or no payment request');
            return;
        }

        try {
            const amountSats = sendAmount ? BigInt(sendAmount) : undefined;

            const prepareResponse = await sdk.prepareSendPayment({
                paymentRequest,
                amountSats,
            });

            if (prepareResponse.paymentMethod instanceof SendPaymentMethod.Bolt11Invoice) {
                const lightningFee = prepareResponse.paymentMethod.inner.lightningFeeSats;
                const sparkFee = prepareResponse.paymentMethod.inner.sparkTransferFeeSats;
                console.log('Payment Prepared')
                console.log(`Lightning Fees: ${lightningFee} sats\nSpark Fees: ${sparkFee || 'N/A'} sats`)
                const response = await sdk.sendPayment({ prepareResponse });

                console.log('Payment sent:', response);
                Alert.alert('Success', 'Payment sent successfully!');

                // Clear form and refresh

            }
        } catch (err) {
            console.error('Error preparing payment:', err);
            Alert.alert('Prepare Error', err.message);
        }
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
            const amountToSend = new BigNumber(amount);
            console.log("amountToSend:", amountToSend)
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
            const amountToSend = new BigNumber(amount);
            console.log("Send trx data=>", {
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
            })
        } catch (error) {
            console.error('Error in bitcoin gas fee', error);
            throw error;
        }
    }
    async function waitForConfirmation({ transaction }) {
        try {
            const transactionID = transaction;
            console.log("transactionID:", transactionID)
        } catch (error) {
            console.error('Error in bitcoin gas fee', error);
            throw error;
        }
    }

    return {
        connectToSdk,
        getBalance,
        isValidAddress,
        fetchPayments,
        generateInvoiceViaBolt11,
        generateInvoiceViaBitcoinAddress,
        prepareAndSendPayment,
        getEstimateFee,
        send,
        waitForConfirmation,
    }
}