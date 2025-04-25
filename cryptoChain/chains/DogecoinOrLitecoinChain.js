import ECPairFactory from 'ecpair';
import ecc from '@bitcoinerlab/secp256k1';
import * as bitcoin from 'bitcoinjs-lib';
import {config} from 'dok-wallet-blockchain-networks/config/config';
import BigNumber from 'bignumber.js';
import {ethers} from 'ethers';
import {
  parseBalance,
  validateNumber,
} from 'dok-wallet-blockchain-networks/helper';
import {BitcoinFork} from 'dok-wallet-blockchain-networks/service/bitcoinFork';
import {toCashAddress} from 'bchaddrjs';

const chainDetails = {
  dogecoin: 'doge',
  litecoin: 'ltc',
  bitcoin_cash: 'bch',
};

const ALL_SCAN_URL = {
  bitcoin_cash: config.BITCOIN_CASH_SCAN_URL,
  dogecoin: config.DOGECOIN_SCAN_URL,
  litecoin: config.LITECOIN_SCAN_URL,
};

const ALL_NETWORKS = {
  bitcoin_cash: config.BITCOIN_CASH_NETWORK,
  dogecoin: config.DOGECOIN_NETWORK_STRING,
  litecoin: config.LITECOIN_NETWORK_STRING,
};

export const DogecoinOrLitecoinChain = chain_name => {
  const isBitcoinCash = chain_name === 'bitcoin_cash';
  const network = ALL_NETWORKS[chain_name];
  const scanUrl = ALL_SCAN_URL[chain_name];

  return {
    isValidAddress: ({address}) => {
      try {
        bitcoin.address.toOutputScript(
          convertAddress(address, chain_name),
          network,
        );
        return true;
      } catch (e) {
        return false;
      }
    },
    isValidPrivateKey: ({privateKey}) => {
      try {
        const ECPair = ECPairFactory(ecc);
        const keyPair = ECPair.fromWIF(privateKey, network);
        return !!keyPair?.publicKey;
      } catch (e) {
        return false;
      }
    },
    createWalletByPrivateKey: ({privateKey}) => {
      const ECPair = ECPairFactory(ecc);
      const keyPair = ECPair.fromWIF(privateKey, network);
      let {address} = bitcoin.payments.p2pkh({
        pubkey: keyPair.publicKey,
        network: network,
      });
      if (isBitcoinCash) {
        address = toCashAddress(address).replace('bitcoincash:', '');
      }
      return {
        address,
        privateKey: keyPair.toWIF(),
      };
    },
    getBalance: async ({address}) => {
      try {
        return await BitcoinFork.getBalance({
          chain: chainDetails[chain_name],
          address,
        });
      } catch (e) {
        console.error(`error in get balance from ${chain_name}`, e);
        return '0';
      }
    },
    getEstimateFee: async ({
      fromAddress,
      toAddress,
      amount,
      privateKey,
      feeMultiplier,
      estimateGas: virtualSize,
      feesType,
    }) => {
      try {
        const amountToSend = new BigNumber(amount);
        return await buildUTXO({
          privateKey,
          changeAddress: fromAddress,
          amount: amountToSend.times(new BigNumber(10).exponentiatedBy(8)),
          toAddress: toAddress,
          chain_name,
          network,
          isGenerateFee: true,
          feeMultiplier,
          virtualSize,
          feesType,
        });
      } catch (e) {
        console.error(`Error in ${chain_name} gas fee`, e);
        throw e;
      }
    },
    getTransactions: async ({address}) => {
      try {
        const transactions = await BitcoinFork.getTransactions({
          chain: chainDetails[chain_name],
          address,
        });
        if (Array.isArray(transactions)) {
          return transactions.map(item => {
            const txHash = item?.hash;
            return {
              amount: item?.amount.toString(),
              link: txHash.substring(0, 13) + '...',
              url: `${scanUrl}/transaction/${txHash}`,
              status: item?.status ? 'SUCCESS' : 'Pending',
              date: new Date(item?.timestamp), //new Date(transaction.raw_data.timestamp),
              from: item?.from,
              to: item?.to,
              totalCourse: '0$',
            };
          });
        }
        return [];
      } catch (e) {
        console.error(`error getting transactions for ${chain_name} ${e}`);
        return [];
      }
    },
    send: async ({to, from, amount, privateKey, transactionFee}) => {
      try {
        const amountToSend = new BigNumber(amount);
        const built = await buildUTXO({
          privateKey: privateKey,
          changeAddress: from,
          toAddress: to,
          amount: amountToSend.times(new BigNumber(10).exponentiatedBy(8)),
          fee: transactionFee,
          chain_name,
          network,
        });

        if (built) {
          return await BitcoinFork.createTransaction({
            chain: chainDetails[chain_name],
            txHex: built,
          });
        } else {
          throw new Error('no built found');
        }
      } catch (e) {
        console.error(`Error in send ${chain_name} transaction`, e);
      }
    },
    waitForConfirmation: async ({transaction}) => {
      const transactionID = transaction;
      if (!transactionID) {
        console.error(`No transaction id found for ${chain_name}`);
        return null;
      }
      return new Promise((resolve, reject) => {
        let numberOfRetries = 0;
        let timer = setInterval(async () => {
          try {
            numberOfRetries += 1;
            console.log(
              `[${Date.now()}]in waitForConfirmation, going to call ${chain_name}, transactionID: ${transactionID}`,
            );
            const isConfirmed = await BitcoinFork.getTransaction({
              chain: chainDetails[chain_name],
              transactionId: transactionID,
            });
            if (isConfirmed) {
              clearInterval(timer);
              resolve(isConfirmed);
            } else if (numberOfRetries === 15) {
              clearInterval(timer);
              resolve('pending');
            }
          } catch (e) {
            clearInterval(timer);
            console.error('Error in get tranaction', e);
            reject(e);
          }
        }, 5000);
      });
    },
  };
};

const buildUTXO = async ({
  privateKey,
  changeAddress,
  toAddress,
  amount,
  fee,
  chain_name,
  network,
  isGenerateFee,
  feeMultiplier,
  virtualSize,
  feesType,
}) => {
  let amountWithFees = new BigNumber(amount);
  let vSize = virtualSize;
  let createdTx;
  let fees;
  if (!vSize) {
    const utxos = await BitcoinFork.getUTXO({
      chain: chainDetails[chain_name],
      address: changeAddress,
    });
    const ECPair = ECPairFactory(ecc);
    const keyPair = ECPair.fromWIF(privateKey, network);
    const tx = new bitcoin.Psbt({network: network});
    if (fee) {
      const feeBn = ethers.parseUnits(fee, 8);
      fees = new BigNumber(feeBn ? feeBn?.toString() : 10000);
      amountWithFees = amountWithFees.plus(fees);
    }
    // Only use the required utxos
    const [usedUTXOs, sum] = utxos.reduce(
      ([utxoAcc, total], utxo) =>
        total.lte(amountWithFees)
          ? [[...utxoAcc, utxo], total.plus(new BigNumber(utxo.value))]
          : [utxoAcc, total],
      [[], new BigNumber(0)],
    );
    if (sum.lt(amountWithFees)) {
      throw new Error('Insufficient balance to broadcast transaction');
    }
    const fetchTransactionData = usedUTXOs.map(item => ({
      fromAddress: changeAddress,
      txid: item.hash,
      value: item.value,
      vout: item?.vout,
    }));
    const resp = await BitcoinFork.fetchTransactionDetails({
      chain: chainDetails[chain_name],
      transactionData: fetchTransactionData,
      address: changeAddress,
    });
    const inputData = resp?.data;
    const isBitcoincash = chain_name === 'bitcoin_cash';
    let extraInput = {};
    if (isBitcoincash) {
      const hashType =
        bitcoin.Transaction.SIGHASH_ALL |
        bitcoin.Transaction.SIGHASH_BITCOINCASHBIP143;
      extraInput = {
        sighashType: hashType,
      };
    }
    inputData.map(utxo => {
      if (utxo.scriptpubkey) {
        tx.addInput({
          hash: utxo.txid,
          index: utxo.vout,
          sequence: 0xfffffffd,

          witnessUtxo: {
            // eslint-disable-next-line no-undef
            script: Buffer.from(utxo.scriptpubkey, 'hex'),
            value: utxo.value, // value in satoshi
          },
          ...extraInput,
        });
      } else if (utxo.txhash) {
        tx.addInput({
          hash: utxo.txid,
          index: utxo.vout,
          sequence: 0xfffffffd,
          // eslint-disable-next-line no-undef
          nonWitnessUtxo: Buffer.from(utxo.txhash, 'hex'),
          ...extraInput,
        });
      }
    });

    const change = sum.minus(amountWithFees);

    // Add outputs
    tx.addOutput({
      address: convertAddress(toAddress, chain_name),
      value: Number(amount),
    });
    if (change.gt(0)) {
      tx.addOutput({
        address: convertAddress(changeAddress, chain_name),
        value: change.toNumber(),
      });
    }
    tx.setMaximumFeeRate(fees ? fees.toNumber() : 10000);

    // Sign inputs
    await tx.signAllInputsAsync(keyPair);
    const validator = (pubkey, msghash, signature) =>
      ECPair.fromPublicKey(pubkey).verify(msghash, signature);
    const isvalidate = tx.validateSignaturesOfAllInputs(validator);
    if (!isvalidate) {
      throw new Error(`Error in validation of ${chain_name} transaction`);
    }
    tx.finalizeAllInputs();
    createdTx = tx.extractTransaction();
  }
  if (isGenerateFee) {
    vSize = vSize || createdTx.virtualSize();
    const feeRate = await BitcoinFork.getTransactionFees({
      chain: chainDetails[chain_name],
    });
    const feeRateNumber = validateNumber(feeRate) || 20;
    const normal = feeMultiplier?.normal || 1.4;
    const recommended = feeMultiplier?.recommended || 1.65;
    const recommendPrice = Math.round(recommended * feeRateNumber);
    const normalPrice = Math.round(normal * feeRateNumber);
    const feesOptions = [
      {
        title: 'Recommended',
        gasPrice: recommendPrice,
      },
      {
        title: 'Normal',
        gasPrice: normalPrice,
      },
    ];
    const multiplier =
      feesType === 'normal' ? normal || 1.4 : recommended || 1.65;
    const totalFeeRate = Math.round(feeRateNumber * multiplier);
    const totalFees = Math.round(totalFeeRate * vSize);
    return {
      fee: parseBalance(totalFees, 8),
      estimateGas: vSize,
      feesOptions,
    };
  }
  return createdTx.toHex();
};

const convertAddress = (address, chain_name) => {
  const isBitcoinCash = chain_name === 'bitcoin_cash';
  if (
    isBitcoinCash &&
    !address?.startsWith('1') &&
    !address?.startsWith('bitcoincash:')
  ) {
    return `bitcoincash:${address}`;
  }
  return address;
};
