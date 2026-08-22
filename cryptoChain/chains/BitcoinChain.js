import ECPairFactory from 'ecpair';
import ecc from '@bitcoinerlab/secp256k1';
import * as bitcoin from 'bitcoinjs-lib';
import {toXOnly} from 'bitcoinjs-lib/src/psbt/bip371';
import {config} from 'dok-wallet-blockchain-networks/config/config';
import BigNumber from 'bignumber.js';
import {
  convertToSmallAmount,
  getExplorerTxUrl,
  mergeUniqueAccounts,
  parseBalance,
  validateNumber,
} from 'dok-wallet-blockchain-networks/helper';
import {
  CHANGE_CHAIN,
  ensureStandardAddresses,
  extendByGapLimit,
  getLegacyWindowItems,
  getNetworkByChainName,
  getStandardChainItems,
  parsePathTail,
  removeLegacyWindowItems,
  shouldPruneLegacyWindow,
} from 'dok-wallet-blockchain-networks/service/bitcoinHdAddress';
import {
  isElectrumAvailable,
  electrumFetchAddressUsage,
} from 'dok-wallet-blockchain-networks/service/electrum';
import {BIP32Factory} from 'bip32';
import * as bip39 from 'bip39';
import {getBitcoinAddresses} from 'dok-wallet-blockchain-networks/service/dokApi';
import {
  fetchBitcoinBalances,
  fetchBitcoinTransactionDetails,
  fetchBitcoinUTXO,
  fetchBitcoinTransactions,
  fetchBitcoinTransaction,
  broadcastBitcoinTransaction,
  fetchBitcoinFeeRate,
} from 'dok-wallet-blockchain-networks/service/bitcoinDataSource';

bitcoin.initEccLib(ecc);

// Sorting weight so UTXOs order by (chainIndex, addressIndex); no chain ever
// holds this many addresses (bitcoinHdAddress caps chains at 500).
const MAX_UTXO_SORT_INDEX = 1000000;

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
      isLegacyScanDone,
    }) => {
      let newDeriveAddresses = deriveAddresses;
      // A lost/near-empty list means backend recovery may merge old-scheme
      // entries back in below, so the resolved flag is ignored for this call
      // and the legacy window is regenerated and rescanned in the same pass.
      let legacyResolved =
        !!isLegacyScanDone &&
        Array.isArray(deriveAddresses) &&
        deriveAddresses.length > 1;
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
            // Merge (old-first) instead of replacing: a lone custom entry
            // must survive backend recovery.
            newDeriveAddresses = mergeUniqueAccounts(
              Array.isArray(newDeriveAddresses) ? newDeriveAddresses : [],
              resp.data,
            );
          }
        }
        // BIP44 discovery: make sure the standard receive/change window
        // exists, then extend it past the last used address (gap limit).
        newDeriveAddresses = ensureStandardAddresses({
          chain_name,
          deriveAddresses: newDeriveAddresses,
          accountKey: extendedPublicKey,
          includeLegacyWindow: !legacyResolved,
        });
        if (extendedPublicKey && isElectrumAvailable()) {
          if (!legacyResolved) {
            try {
              const legacyItems = getLegacyWindowItems(
                chain_name,
                newDeriveAddresses,
              );
              if (legacyItems.length) {
                const usage = await electrumFetchAddressUsage({
                  addresses: legacyItems.map(item => item.address),
                });
                // All-or-nothing: one used legacy address keeps all of them.
                if (
                  shouldPruneLegacyWindow({
                    legacyItems,
                    usage,
                    keepAddresses: new Set([address]),
                  })
                ) {
                  newDeriveAddresses = removeLegacyWindowItems(
                    chain_name,
                    newDeriveAddresses,
                  );
                }
              }
              legacyResolved = true;
            } catch (e) {
              // Nothing pruned; the coin's flag stays unset so the scan
              // retries on the next refresh.
              console.warn('bitcoin legacy-window scan failed', e?.message);
            }
          }
          try {
            for (let round = 0; round < 3; round++) {
              const standardItems = getStandardChainItems(
                chain_name,
                newDeriveAddresses,
              );
              const usage = await electrumFetchAddressUsage({
                addresses: standardItems.map(item => item.address),
              });
              const usedAddresses = new Set(
                standardItems
                  .filter(item => usage[item.address])
                  .map(item => item.address),
              );
              const extended = extendByGapLimit({
                chain_name,
                deriveAddresses: newDeriveAddresses,
                accountKey: extendedPublicKey,
                usedAddresses,
              });
              if (extended === newDeriveAddresses) {
                break;
              }
              newDeriveAddresses = extended;
            }
          } catch (e) {
            console.warn('bitcoin gap-limit scan failed', e?.message);
          }
        }
        if (newDeriveAddresses?.length && newDeriveAddresses?.[0]?.address) {
          const resp = await fetchBitcoinBalances({
            derive_addresses: newDeriveAddresses,
          });
          return resp?.data
            ? {...resp.data, isLegacyScanDone: legacyResolved}
            : resp?.data;
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
      memo,
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
          memo,
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
        const transactions = await fetchBitcoinTransactions({
          address,
          derive_addresses: allAddresses,
        });
        if (Array.isArray(transactions)) {
          return transactions.map(item => {
            const txHash = item?.hash;
            return {
              amount: item?.amount?.toString(),
              link: txHash,
              url: getExplorerTxUrl('bitcoin', txHash),
              status: item?.status ? 'SUCCESS' : 'Pending',
              date: item?.timestamp, //new Date(transaction.raw_data.timestamp),
              from: item?.from,
              to: item?.to,
              totalCourse: '0$',
              transactionType: 'regular',
              blockNumber: item?.blockNumber || null,
              confirmations: item?.confirmations ?? null,
            };
          });
        }
        return [];
      } catch (e) {
        console.error(`error getting transactions for bitcoin ${e}`);
        return [];
      }
    },
    getTransaction: async ({txHash, address, deriveAddresses}) => {
      try {
        const allAddresses = deriveAddresses?.map?.(item => item?.address);
        const response = await fetchBitcoinTransaction({
          transactionId: txHash,
          address,
          derive_addresses: allAddresses,
        });
        if (!response) return null;
        return {
          data: {
            amount: response?.amount?.toString() || '0',
            link: response.hash,
            url: getExplorerTxUrl('bitcoin', txHash),
            status: response?.status ? 'SUCCESS' : 'Pending',
            date: response?.timestamp,
            from: response?.from,
            to: response?.to,
            fee: response?.fee,
            totalCourse: '0',
            blockNumber: response?.blockNumber || null,
            confirmations: response?.confirmations ?? null,
          },
        };
      } catch (e) {
        console.error(`error getting transaction for bitcoin ${e}`);
        return {data: null};
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
      memo,
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
          memo,
        });
        if (built) {
          return await broadcastBitcoinTransaction({
            txHex: built,
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
        console.error('No transaction id found for bitcoin');
        return null;
      }
      return new Promise(resolve => {
        let numberOfRetries = 0;
        let timer = setInterval(async () => {
          try {
            numberOfRetries += 1;
            console.log(
              `[${Date.now()}]in waitForConfirmation, going to call bitcoin, transactionID: ${transactionID}`,
            );
            const response = await fetchBitcoinTransaction({
              transactionId: transaction,
            });
            // status alone is not proof of confirmation: some providers
            // report mempool txs as confirmed (Blockchair block_id -1),
            // so also require a real block height.
            if (response?.status && Number(response?.blockNumber) > 0) {
              clearInterval(timer);
              resolve(response);
            } else if (numberOfRetries >= 15) {
              clearInterval(timer);
              resolve('pending');
            }
          } catch (e) {
            // The tx is already broadcast — a transient provider error must
            // not fail the flow, keep polling until the retry limit.
            console.error('Error in get tranaction', e);
            if (numberOfRetries >= 15) {
              clearInterval(timer);
              resolve('pending');
            }
          }
        }, 5000);
      });
    },
    createCustomDerivedAddress: async ({chain_name, mnemonic, derivePath}) => {
      try {
        const customNetwork = getNetworkByChainName(chain_name);
        const seed = bip39.mnemonicToSeedSync(mnemonic);
        const bip32 = BIP32Factory(ecc);
        const root = bip32.fromSeed(seed, customNetwork);
        const child1 = root.derivePath(derivePath);
        let data = {};
        if (chain_name === 'bitcoin_legacy') {
          data = bitcoin.payments.p2pkh({
            pubkey: child1.publicKey,
            network: customNetwork,
          });
        } else if (chain_name === 'bitcoin_segwit') {
          const p2wpkh = bitcoin.payments.p2wpkh({
            pubkey: child1.publicKey,
            network: customNetwork,
          });
          data = bitcoin.payments.p2sh({
            redeem: p2wpkh,
          });
        }
        return {
          account: {
            privateKey: child1.toWIF(),
            address: data.address,
            derivePath: derivePath,
          },
        };
      } catch (error) {
        console.error(error);
        throw error;
      }
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
  memo,
}) => {
  // memo is a hex-encoded OP_RETURN payload (exchange providers like LI.FI
  // route shared-vault BTC deposits by it). Validate up front: a malformed
  // or oversized memo must fail the build, never produce a memo-less send —
  // a vault deposit without its memo is unrecoverable.
  if (memo) {
    const isValidMemo =
      typeof memo === 'string' &&
      /^[0-9a-fA-F]+$/.test(memo) &&
      memo.length % 2 === 0 &&
      memo.length <= 160; // 80 bytes, the standard OP_RETURN relay limit
    if (!isValidMemo) {
      throw new Error('Invalid bitcoin memo: expected hex of at most 80 bytes');
    }
  }
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
      const feeBn = convertToSmallAmount(fee, 8);
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

    // Only use the required utxos (receive chain first, then by index)
    const sortRank = derivePath => {
      const {chainIndex, addressIndex} = parsePathTail(derivePath);
      return chainIndex * MAX_UTXO_SORT_INDEX + addressIndex;
    };
    const finalUtxos = allUtxos.sort(
      (a, b) => sortRank(a.derivePath) - sortRank(b.derivePath),
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
        // Works for both standard (…/chain/index) and legacy (…/index/0)
        // paths: always derive the last two path segments in order.
        const {chainIndex, addressIndex} = parsePathTail(derivePath);
        const childNode = root.derive(chainIndex).derive(addressIndex);
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
    if (memo) {
      tx.addOutput({
        // eslint-disable-next-line no-undef
        script: bitcoin.payments.embed({data: [Buffer.from(memo, 'hex')]})
          .output,
        value: 0,
      });
    }
    if (change.gt(0)) {
      const changeAddress = getChangeAddress(
        usedDerivedAddress,
        deriveAddresses,
        extendedPrivateKey,
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
    const feeRate = await fetchBitcoinFeeRate();
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

// Change goes to the first unused internal-chain address (…/1/i), like
// BlueWallet/Electrum. Falls back to the sending address for coins without
// an internal chain (private-key imports).
const getChangeAddress = (
  usedAddresses,
  allDeriveAddresses,
  extendedPrivateKey,
) => {
  const allItems = Array.isArray(allDeriveAddresses) ? allDeriveAddresses : [];
  const spendingSet = new Set((usedAddresses || []).map(item => item?.address));
  // Watch-only entries are only spendable later through the xprv fallback in
  // buildUTXO — never route change to one when that key is unavailable.
  const canSpendXpubDerived = !!extendedPrivateKey;
  const internal = allItems
    .filter(
      item =>
        parsePathTail(item?.derivePath).chainIndex === CHANGE_CHAIN &&
        (item?.privateKey || canSpendXpubDerived),
    )
    .sort(
      (a, b) =>
        parsePathTail(a?.derivePath).addressIndex -
        parsePathTail(b?.derivePath).addressIndex,
    );
  const unused = internal.find(
    item => !(Number(item?.balance) > 0) && !spendingSet.has(item?.address),
  );
  return (
    unused?.address ||
    internal[0]?.address ||
    usedAddresses?.[0]?.address ||
    allItems[0]?.address
  );
};
