import ECPairFactory from 'ecpair';
import ecc from '@bitcoinerlab/secp256k1';
import * as bitcoin from 'bitcoinjs-lib';
import {toXOnly} from 'bitcoinjs-lib/src/psbt/bip371';
import {config, IS_SANDBOX} from 'dok-wallet-blockchain-networks/config/config';
import BigNumber from 'bignumber.js';
import {BitcoinFork} from 'dok-wallet-blockchain-networks/service/bitcoinFork';
import {ethers} from 'ethers';
import {
  getLastIndexOfDerivations,
  parseBalance,
  validateNumber,
} from 'dok-wallet-blockchain-networks/helper';
import {BIP32Factory} from 'bip32';
import * as bip39 from 'bip39';
import {
  fetchBitcoinBalances,
  fetchBitcoinTransactionDetails,
  fetchBitcoinUTXO,
  getBitcoinAddresses,
} from 'dok-wallet-blockchain-networks/service/dokApi';

bitcoin.initEccLib(ecc);

const mainNetworkKeys = {
  bitcoin: {
    public: 0x04b24746,
    private: 0x04b2430c,
  },
  bitcoin_segwit: {
    public: 0x049d7cb2,
    private: 0x049d7878,
  },
  bitcoin_legacy: {
    public: 0x0488b21e,
    private: 0x0488ade4,
  },
};

const testnetNetworkKeys = {
  bitcoin: {
    public: 0x045f1cf6,
    private: 0x045f18bc,
  },
  bitcoin_segwit: {
    public: 0x044a5262,
    private: 0x044a4e28,
  },
  bitcoin_legacy: {
    public: 0x043587cf,
    private: 0x04358394,
  },
};

export const BitcoinChain = () => {
  return {
    isValidAddress: ({address}) => {
      try {
        bitcoin.address.toOutputScript(address, config.BITCOIN_NETWORK_STRING);
        return true;
      } catch (e) {
        return false;
      }
    },
    isValidPrivateKey: ({privateKey}) => {
      try {
        const ECPair = ECPairFactory(ecc);
        const keyPair = ECPair.fromWIF(
          privateKey,
          config.BITCOIN_NETWORK_STRING,
        );
        return !!keyPair?.publicKey;
      } catch (e) {
        return false;
      }
    },
    createWalletByPrivateKey: ({privateKey, chain_name}) => {
      const customNetwork = getNetworkByChainName(chain_name);
      const ECPair = ECPairFactory(ecc);
      const keyPair = ECPair.fromWIF(privateKey, customNetwork);
      let data = {};
      if (chain_name === 'bitcoin_legacy') {
        data = bitcoin.payments.p2pkh({
          pubkey: keyPair.publicKey,
          network: customNetwork,
        });
      } else if (chain_name === 'bitcoin_segwit') {
        const p2wpkh = bitcoin.payments.p2wpkh({
          pubkey: keyPair.publicKey,
          network: customNetwork,
        });
        data = bitcoin.payments.p2sh({
          redeem: p2wpkh,
        });
      } else if (chain_name === 'bitcoin') {
        data = bitcoin.payments.p2wpkh({
          pubkey: keyPair.publicKey,
          network: customNetwork,
        });
      }
      return {
        address: data.address,
        privateKey: keyPair.toWIF(),
      };
    },
    getBalance: async ({
      address,
      chain_name,
      extendedPublicKey,
      deriveAddresses,
    }) => {
      let newDeriveAddresses = deriveAddresses;
      try {
        if (
          (!Array.isArray(deriveAddresses) || deriveAddresses?.length <= 1) &&
          extendedPublicKey
        ) {
          const resp = await getBitcoinAddresses({
            chain_name,
            extended_pub_key: extendedPublicKey,
          });
          if (Array.isArray(resp?.data)) {
            newDeriveAddresses = resp?.data;
          }
        }
        if (newDeriveAddresses?.length && newDeriveAddresses?.[0]?.address) {
          const resp = await fetchBitcoinBalances({
            derive_addresses: newDeriveAddresses,
          });
          return resp?.data;
        } else {
          const deriveAddress = getDeriveAddressByChain(chain_name);
          const resp = await fetchBitcoinBalances({
            derive_addresses: [
              {
                derivePath: deriveAddress,
                address,
              },
            ],
          });
          return resp?.data;
        }
      } catch (e) {
        console.error('error in get balance from bitcoin', e);
        return '0';
      }
    },
    createBitcoinLegacyWallet: async ({mnemonic}) => {
      try {
        const customNetwork = getNetworkByChainName('bitcoin_legacy');
        const seed = bip39.mnemonicToSeedSync(mnemonic);
        const bip32 = BIP32Factory(ecc);
        const root = bip32.fromSeed(seed, customNetwork);
        const child1 = root.derivePath(
          getDeriveAddressByChain('bitcoin_legacy'),
        );
        const extendedKey = root.derivePath("m/44'/0'/0'");
        const xPubKey = extendedKey.neutered().toBase58();
        const xPrvKey = extendedKey.toBase58();
        const {address} = bitcoin.payments.p2pkh({
          pubkey: child1.publicKey,
          network: customNetwork,
        });
        return {
          privateKey: child1.toWIF(),
          address,
          extendedPublicKey: xPubKey,
          extendedPrivateKey: xPrvKey,
        };
      } catch (e) {
        console.error('Error in createBitcoinLegacyWallet', e);
      }
    },
    createBitcoinTaprootWallet: async ({mnemonic}) => {
      try {
        const seed = bip39.mnemonicToSeedSync(mnemonic);
        const bip32 = BIP32Factory(ecc);
        const root = bip32.fromSeed(seed, config.BITCOIN_NETWORK_STRING);
        const child1 = root.derivePath("m/86'/0'/0'/0/0");

        const {address} = bitcoin.payments.p2tr({
          internalPubkey: toXOnly(child1.publicKey),
          network: config.BITCOIN_NETWORK_STRING,
        });
        return {
          privateKey: child1.toWIF(),
          address,
        };
      } catch (e) {
        console.error('Error in createBitcoinTaprootWallet', e);
      }
    },
    createBitcoinSegwitWallet: async ({mnemonic}) => {
      try {
        const customNetwork = getNetworkByChainName('bitcoin_segwit');
        const seed = bip39.mnemonicToSeedSync(mnemonic);
        const bip32 = BIP32Factory(ecc);
        const root = bip32.fromSeed(seed, customNetwork);
        const child1 = root.derivePath(
          getDeriveAddressByChain('bitcoin_segwit'),
        );
        const extendedKey = root.derivePath("m/49'/0'/0'");
        const yPubKey = extendedKey.neutered().toBase58();
        const yPrvKey = extendedKey.toBase58();
        const p2wpkh = bitcoin.payments.p2wpkh({
          pubkey: child1.publicKey,
          network: customNetwork,
        });
        const {address} = bitcoin.payments.p2sh({
          redeem: p2wpkh,
        });
        return {
          privateKey: child1.toWIF(),
          address,
          extendedPublicKey: yPubKey,
          extendedPrivateKey: yPrvKey,
        };
      } catch (e) {
        console.error('Error in createBitcoinSegwitWallet', e);
      }
    },
    getEstimateFee: async ({
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
    }) => {
      try {
        const amountToSend = new BigNumber(amount);
        return await buildUTXO({
          privateKey,
          fromAddress,
          amount: amountToSend.times(new BigNumber(10).exponentiatedBy(8)),
          toAddress,
          chain_name,
          deriveAddresses,
          balance,
          extendedPrivateKey,
          isGenerateFee: true,
          feeMultiplier,
          virtualSize,
          feesType,
          selectedUTXOs,
        });
      } catch (e) {
        console.error('Error in bitcoin gas fee', e);
        throw e;
      }
    },
    getUTXOs: async ({deriveAddresses}) => {
      try {
        const allDeriveAddress = deriveAddresses;
        const {data: utxos} = await fetchBitcoinUTXO({
          derive_addresses: allDeriveAddress,
        });

        const allUtxos = utxos.reduce((acc, utxo) => {
          if (!utxo) {
            return acc;
          }

          const tx = {
            txid: utxo.transaction_hash,
            value: +utxo.value / 1e8,
            fromAddress: utxo.address,
            vout: utxo.index,
          };

          const existing = acc.find(entry => entry.label === utxo.address);

          if (existing) {
            existing.data.push(tx);
          } else {
            acc.push({
              label: utxo.address,
              data: [tx],
            });
          }

          return acc;
        }, []);
        return allUtxos;
      } catch (e) {
        console.error(`error getting UTXOs for bitcoin ${e}`);
        return [];
      }
    },
    getTransactions: async ({address, deriveAddresses}) => {
      try {
        const allAddresses = deriveAddresses?.map?.(item => item?.address);
        const transactions = await BitcoinFork.getTransactions({
          chain: 'btc',
          address,
          derive_addresses: allAddresses,
        });
        if (Array.isArray(transactions)) {
          return transactions.map(item => {
            const txHash = item?.hash;
            return {
              amount: item?.amount?.toString(),
              link: txHash?.substring(0, 13) + '...',
              url: `${config.BITCOIN_SCAN_URL}/tx/${txHash}`,
              status: item?.status ? 'SUCCESS' : 'Pending',
              date: item?.timestamp, //new Date(transaction.raw_data.timestamp),
              from: item?.from,
              to: item?.to,
              totalCourse: '0$',
            };
          });
        }
        return [];
      } catch (e) {
        console.error(`error getting transactions for bitcoin ${e}`);
        return [];
      }
    },
    send: async ({
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
    }) => {
      try {
        const amountToSend = new BigNumber(amount);
        const built = await buildUTXO({
          privateKey,
          fromAddress: from,
          amount: amountToSend.times(new BigNumber(10).exponentiatedBy(8)),
          toAddress: to,
          chain_name,
          deriveAddresses,
          balance,
          extendedPrivateKey,
          isGenerateFee: false,
          fee: transactionFee,
          selectedUTXOs,
        });
        if (built) {
          return await BitcoinFork.createTransaction({
            txHex: built,
            chain: 'btc',
          });
        } else {
          throw new Error('no built found');
        }
      } catch (e) {
        console.error('Error in send bitcoin transaction', e);
      }
    },
    waitForConfirmation: async ({transaction}) => {
      const transactionID = transaction;
      if (!transactionID) {
        console.error('No transaction id found for tron');
        return null;
      }
      return new Promise((resolve, reject) => {
        let numberOfRetries = 0;
        let timer = setInterval(async () => {
          try {
            numberOfRetries += 1;
            console.log(
              `[${Date.now()}]in waitForConfirmation, going to call bitcoin, transactionID: ${transactionID}`,
            );
            const response = await BitcoinFork.getTransaction({
              transactionId: transaction,
              chain: 'btc',
            });
            if (response?.data?.status?.confirmed) {
              clearInterval(timer);
              resolve(response);
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
  fromAddress,
  amount,
  toAddress,
  privateKey,
  chain_name,
  deriveAddresses,
  balance,
  extendedPrivateKey,
  isGenerateFee,
  fee,
  feeMultiplier,
  virtualSize,
  feesType,
  selectedUTXOs,
}) => {
  let amountWithFees = new BigNumber(amount);
  let vSize = virtualSize;
  let createdTx;
  let fees;

  const filterUTXOsBySelection = (arr = [], vout = 'vout', txid = 'txid') => {
    if (!Array.isArray(arr) || arr.length === 0) {
      return [];
    }
    if (!Array.isArray(selectedUTXOs) || selectedUTXOs.length === 0) {
      return arr;
    }
    return arr.filter(item =>
      selectedUTXOs.some(
        UTXO => UTXO.vout === item?.[vout] && UTXO.txid === item?.[txid],
      ),
    );
  };

  const deriveAddressesFromSelectedUTXOs = (arr = []) => {
    if (!Array.isArray(arr) || arr.length === 0) {
      return [];
    }
    if (!Array.isArray(selectedUTXOs) || selectedUTXOs.length === 0) {
      return arr;
    }
    return arr.filter(item =>
      selectedUTXOs.some(items => items.fromAddress === item.address),
    );
  };

  if (!vSize) {
    if (fee) {
      const feeBn = ethers.parseUnits(fee, 8);
      fees = new BigNumber(feeBn ? feeBn?.toString() : 10000);
      amountWithFees = amountWithFees.plus(fees);
    }
    const allDeriveAddress =
      Array.isArray(deriveAddresses) && deriveAddresses.length > 1
        ? deriveAddressesFromSelectedUTXOs(deriveAddresses)
        : [
            {
              derivePath: getDeriveAddressByChain(chain_name),
              address: fromAddress,
              balance: balance,
              privateKey,
            },
          ];
    // const sortedDeriveAddresses = allDeriveAddress.sort((a, b) =>
    //   new BigNumber(b.balance).gt(new BigNumber(a.balance)),
    // );

    const usedDerivedAddress = [];
    let totalAmount = new BigNumber(0);
    for (let item of allDeriveAddress) {
      totalAmount = totalAmount.plus(new BigNumber(item.balance));
      usedDerivedAddress.push(item);
      if (totalAmount.gte(amountWithFees)) {
        break;
      }
    }
    const {data: utxos} = await fetchBitcoinUTXO({
      derive_addresses: usedDerivedAddress,
    });

    const allUtxos = filterUTXOsBySelection(
      utxos,
      'index',
      'transaction_hash',
    ).map(item => {
      const foundDerivation = usedDerivedAddress.find(
        subItem => item.address === subItem.address,
      );
      return {
        txid: item.transaction_hash,
        value: item.value,
        fromAddress: item.address,
        vout: item.index,
        derivePath: foundDerivation.derivePath,
        privateKey: foundDerivation.privateKey,
      };
    });

    // Only use the required utxos
    const finalUtxos = allUtxos.sort(
      (a, b) =>
        getLastIndexOfDerivations(a.derivePath) -
        getLastIndexOfDerivations(b.derivePath),
    );
    const [usedUTXOs, sum] = finalUtxos.reduce(
      ([utxoAcc, total], utxo) =>
        total.lte(amountWithFees)
          ? [[...utxoAcc, utxo], total.plus(utxo.value)]
          : [utxoAcc, total],
      [[], new BigNumber(0)],
    );
    const customNetwork = getNetworkByChainName(chain_name);
    const tx = new bitcoin.Psbt({network: customNetwork});
    const resp = await fetchBitcoinTransactionDetails({
      transaction_data: usedUTXOs,
    });
    const inputData = filterUTXOsBySelection(resp?.data);
    let keyPairs = {};
    const ECPair = ECPairFactory(ecc);
    const bip32 = BIP32Factory(ecc);

    for (let i = 0; i < inputData.length; i++) {
      const derivePath = inputData[i]?.derivePath;
      const tempPrivateKey = inputData[i]?.privateKey;
      if (!keyPairs[derivePath] && tempPrivateKey) {
        keyPairs[derivePath] = ECPair.fromWIF(tempPrivateKey, customNetwork);
      } else if (!keyPairs[derivePath] && !tempPrivateKey) {
        const root = bip32.fromBase58(extendedPrivateKey, customNetwork);
        const childNode = root
          .derive(getLastIndexOfDerivations(derivePath))
          .derive(0);
        // Convert BIP32 node to ECPair for React Native compatibility
        keyPairs[derivePath] = ECPair.fromPrivateKey(
          // eslint-disable-next-line no-undef
          Buffer.from(childNode.privateKey),
          {network: customNetwork},
        );
      }
    }

    inputData.map(utxo => {
      if (utxo.scriptpubkey) {
        const tempInputData = {
          hash: utxo.txid,
          index: utxo.vout,
          sequence: 0xfffffffd,
          witnessUtxo: {
            // eslint-disable-next-line no-undef
            script: Buffer.from(utxo.scriptpubkey, 'hex'),
            value: utxo.value, // value in satoshi
          },
        };

        if (chain_name === 'bitcoin_segwit') {
          const derivePath = utxo?.derivePath;
          tempInputData.redeemScript = bitcoin.payments.p2sh({
            redeem: bitcoin.payments.p2wpkh({
              pubkey: keyPairs[derivePath]?.publicKey,
              network: customNetwork,
            }),
          }).redeem.output;
        }
        // if (chain_name === 'bitcoin_taproot') {
        //   tempInputData.tapInternalKey = childNodeXOnlyPubkey;
        // }
        tx.addInput(tempInputData);
      } else if (utxo.txhash) {
        const tempInputData = {
          hash: utxo.txid,
          index: utxo.vout,
          sequence: 0xfffffffd,
          // eslint-disable-next-line no-undef
          nonWitnessUtxo: Buffer.from(utxo.txhash, 'hex'),
        };
        if (chain_name === 'bitcoin_segwit') {
          const derivePath = utxo?.derivePath;
          tempInputData.redeemScript = bitcoin.payments.p2sh({
            redeem: bitcoin.payments.p2wpkh({
              pubkey: keyPairs[derivePath]?.publicKey,
              network: customNetwork,
            }),
          }).redeem.output;
        }
        tx.addInput(tempInputData);
      }
    });

    const change = sum.minus(amountWithFees);
    // Add outputs
    tx.addOutput({
      address: toAddress,
      value: Number(amount),
    });
    if (change.gt(0)) {
      const changeAddress = getChangeAddress(
        usedDerivedAddress,
        deriveAddresses,
      );
      tx.addOutput({
        address: changeAddress,
        value: change.toNumber(),
      });
    }

    // Sign inputs
    for (let i = 0; i < inputData.length; i++) {
      const derivePath = inputData[i].derivePath;
      await tx.signInput(i, keyPairs[derivePath]);
    }
    const validator = (pubkey, msghash, signature) =>
      ECPair.fromPublicKey(pubkey).verify(msghash, signature);
    const isvalidate = tx.validateSignaturesOfAllInputs(validator);
    if (!isvalidate) {
      throw new Error('Error in validation of bitcoin transaction');
    }
    tx.finalizeAllInputs();
    createdTx = tx.extractTransaction();
  }
  if (isGenerateFee) {
    vSize = vSize || createdTx.virtualSize();
    const feeRate = await BitcoinFork.getTransactionFees({chain: 'btc'});
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

const getDeriveAddressByChain = chain_name => {
  return chain_name === 'bitcoin'
    ? "m/84'/0'/0'/0/0"
    : chain_name === 'bitcoin_segwit'
    ? "m/49'/0'/0'/0/0"
    : "m/44'/0'/0'/0/0";
};

const getNetworkByChainName = chain_name => {
  return chain_name === 'bitcoin' && IS_SANDBOX
    ? Object.assign({}, bitcoin.networks.testnet, {
        bip32: testnetNetworkKeys.bitcoin,
      })
    : chain_name === 'bitcoin'
    ? Object.assign({}, bitcoin.networks.bitcoin, {
        bip32: mainNetworkKeys.bitcoin,
      })
    : chain_name === 'bitcoin_legacy' && IS_SANDBOX
    ? Object.assign({}, bitcoin.networks.testnet, {
        bip32: testnetNetworkKeys.bitcoin_legacy,
      })
    : chain_name === 'bitcoin_legacy'
    ? Object.assign({}, bitcoin.networks.bitcoin, {
        bip32: mainNetworkKeys.bitcoin_legacy,
      })
    : chain_name === 'bitcoin_segwit' && IS_SANDBOX
    ? Object.assign({}, bitcoin.networks.testnet, {
        bip32: testnetNetworkKeys.bitcoin_segwit,
      })
    : chain_name === 'bitcoin_segwit'
    ? Object.assign({}, bitcoin.networks.bitcoin, {
        bip32: mainNetworkKeys.bitcoin_segwit,
      })
    : '';
};

const getChangeAddress = (usedAddresses, allDeriveAddresses) => {
  if (
    usedAddresses?.length === allDeriveAddresses?.length &&
    usedAddresses.length > 0
  ) {
    return usedAddresses[0].address;
  }
  const lastUsedAddresses = usedAddresses[usedAddresses?.length - 1];
  const lastAddressIndex = getLastIndexOfDerivations(
    lastUsedAddresses?.derivePath,
  );
  const changeAddressIndex = lastAddressIndex === 19 ? 1 : lastAddressIndex + 1;
  return allDeriveAddresses[changeAddressIndex]?.address;
};
