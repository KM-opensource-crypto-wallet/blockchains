import {ethers, FetchRequest, JsonRpcProvider, Transaction} from 'ethers';
import {
  BATCH_TRANSACTION_CONTRACT_ADDRESS,
  CHAIN_ID,
  GAS_ORACLE_CONTRACT_ADDRESS,
  IS_SANDBOX,
  SCAN_URL,
} from 'dok-wallet-blockchain-networks/config/config';
import erc20Abi from 'dok-wallet-blockchain-networks/abis/erc20.json';
import bep20Abi from 'dok-wallet-blockchain-networks/abis/bep20.json';
import erc721Abi from 'dok-wallet-blockchain-networks/abis/erc721.json';
import gasOracleAbi from 'dok-wallet-blockchain-networks/abis/opbnb_gas_oracle.json';
import BigNumber from 'bignumber.js';
import erc1155Abi from 'dok-wallet-blockchain-networks/abis/erc1155.json';
import {EvmServices} from 'dok-wallet-blockchain-networks/service/evmServices';
import {
  getFreeRPCUrl,
  getRPCUrl,
} from 'dok-wallet-blockchain-networks/rpcUrls/rpcUrls';
import {
  convertToSmallAmount,
  deleteItemAtIndex,
  isEip1559NotSupported,
  isLayer2Chain,
  parseBalance,
  validateNumber,
} from 'dok-wallet-blockchain-networks/helper';
import axios from 'axios';
import {ErrorDecoder} from 'ethers-decode-error';
import {
  getFeesMultiplier,
  getMaxPriorityFee,
} from 'dok-wallet-blockchain-networks/feesInfo/feesInfo';
import contractABI from 'dok-wallet-blockchain-networks/abis/contractABI.json';

const errorDecoder = ErrorDecoder.create();

const FEES_BY_RPC_CHAINS = [
  'viction',
  'ethereum_classic',
  'ethereum_pow',
  'kava',
  'ink',
];
const TIMEOUT = 45000;

const ADDITIONAL_ESTIMATE_GAS = {
  arbitrum: 100000n,
};

export const EVMChain = chain_name => {
  const allRpcUrls = getFreeRPCUrl(chain_name);
  const chainId = CHAIN_ID[chain_name];
  const localErc20ABI =
    chain_name === 'binance_smart_chain' ? bep20Abi : erc20Abi;

  const extraEstimate = ADDITIONAL_ESTIMATE_GAS[chain_name] || 0n;

  async function createAuthorization(wallet, nonce, delegationContractAddress) {
    return await wallet.authorize({
      address: delegationContractAddress,
      nonce: nonce,
    });
  }

  const getScanUrlName = () => {
    if (chain_name === 'polygon') {
      return getRPCUrl('polygon_blockscout')
        ? 'polygon_blockscout'
        : 'polygon_scan';
    }
    return chain_name;
  };
  const getEtherGasPrice = async (feesType, evmProvider) => {
    let resp;
    if (!IS_SANDBOX && !FEES_BY_RPC_CHAINS.includes(chain_name)) {
      resp = await EvmServices?.[chain_name]?.getTransactionFeeData({
        chain_name,
      });
    }
    const feeData = await evmProvider.getFeeData();
    let data = resp?.data;

    const gasPrice = data || feeData?.gasPrice;
    const gasPriceNumber = validateNumber(gasPrice);
    if (!gasPriceNumber) {
      throw new Error('Fee data not available');
    }
    let bnGasPrice = new BigNumber(gasPriceNumber);
    const bnMultiplyGasPrice = bnGasPrice.multipliedBy(
      getFeesMultiplier(chain_name),
    );
    const feesOptions = [
      {
        title: 'Recommended',
        gasPrice: parseBalance(bnMultiplyGasPrice.toFixed(0), 9),
      },
      {
        title: 'Normal',
        gasPrice: parseBalance(bnGasPrice.toFixed(0), 9),
      },
    ];
    const finalGasPrice =
      feesType === 'normal'
        ? BigInt(bnGasPrice.toFixed(0))
        : BigInt(bnMultiplyGasPrice.toFixed(0));

    let maxPriorityFeePerGas =
      feeData?.maxPriorityFeePerGas || getMaxPriorityFee(chain_name);

    if (maxPriorityFeePerGas) {
      try {
        const maxPriorityFeePerGasBigInt = BigInt(maxPriorityFeePerGas);
        if (maxPriorityFeePerGasBigInt >= finalGasPrice) {
          maxPriorityFeePerGas = finalGasPrice - 1n;
        }
      } catch (e) {
        console.error('Error in convert to bigint', e);
      }
    }

    return {
      gasPrice: finalGasPrice,
      feesOptions,
      maxPriorityFeePerGas,
    };
  };

  const parseTransaction = input => {
    try {
      const iface = new ethers.Interface(localErc20ABI);

      const decodeTx = iface.parseTransaction({data: input});

      return (
        {
          value: decodeTx?.args?.[1]?.toString(),
          toAddress: decodeTx?.args?.[0]?.toString(),
        } || null
      );
    } catch (e) {
      console.warn('warning in parse tx', e);
      return null;
    }
  };

  const safeGetTransactionData = async txHash => {
    const isLastIndex = allRpcUrls.length - 1;
    for (let i = 0; i < allRpcUrls.length; i++) {
      try {
        const fetchRequest = new FetchRequest(allRpcUrls[i]);
        fetchRequest.timeout = TIMEOUT;
        const retryEvmProvider = new JsonRpcProvider(fetchRequest, chainId, {
          staticNetwork: true,
        });
        const resp = await retryEvmProvider.getTransaction(txHash);
        if (resp || i === isLastIndex) {
          return resp;
        }
      } catch (e) {
        if (i === isLastIndex) {
          return null;
        }
      }
    }
  };

  const safeGetTransactionStatus = async txHash => {
    const isLastIndex = allRpcUrls.length - 1;
    for (let i = 0; i < allRpcUrls.length; i++) {
      try {
        const fetchRequest = new FetchRequest(allRpcUrls[i]);
        fetchRequest.timeout = TIMEOUT;
        const retryEvmProvider = new JsonRpcProvider(fetchRequest, chainId, {
          staticNetwork: true,
        });
        const resp = await retryEvmProvider.getTransactionReceipt(txHash);
        if (resp || i === isLastIndex) {
          return resp;
        }
      } catch (e) {
        if (i === isLastIndex) {
          return null;
        }
      }
    }
  };

  const fetchPendingTransactions = async ({
    pendingTransactions,
    key,
    dispatch,
    setPendingTransactions,
  }) => {
    const tempPendingTransactions = Array.isArray(pendingTransactions)
      ? pendingTransactions
      : [];
    if (tempPendingTransactions.length) {
      const statuses = await Promise.all(
        tempPendingTransactions.map(item =>
          safeGetTransactionStatus(item?.hash),
        ),
      );
      const transactionDataArray = [];
      const fetchTransactionsData = [];
      for (let i = 0; i < statuses.length; i++) {
        const status = statuses[i];
        const tempTransaction = tempPendingTransactions[i];
        if (!status) {
          transactionDataArray.push(tempTransaction);
          fetchTransactionsData.push(
            safeGetTransactionData(tempTransaction?.hash),
          );
        }
      }
      dispatch(setPendingTransactions({key, value: transactionDataArray}));

      if (fetchTransactionsData.length) {
        let transactionResp = await Promise.all(fetchTransactionsData);
        transactionResp = transactionResp.sort((a, b) => {
          const aNonce = a?.nonce;
          const bNonce = b?.nonce;
          if (aNonce === null || aNonce === undefined) {
            return 1;
          } // If 'a' has null or undefined nonce, move it to the end
          if (bNonce === null || bNonce === undefined) {
            return -1;
          }
          return aNonce - bNonce;
        });
        const finalPendingTransactionData = [];
        for (let i = 0; i < transactionResp.length; i++) {
          const item = transactionResp[i];
          const transactionData = transactionDataArray[i];
          if (item) {
            const txHash = item.hash;
            const decodeTx = parseTransaction(item.data);
            const amount = decodeTx?.value || item?.value?.toString();
            const toAddress = decodeTx?.toAddress || item?.to;

            const tempItem = {
              amount: amount,
              link: txHash.substring(0, 13) + '...',
              url: `${SCAN_URL[getScanUrlName()]}/tx/${txHash}`,
              status: i === 0 ? 'PENDING' : 'QUEUE',
              date: transactionData.date, //new Date(transaction.raw_data.timestamp),
              from: item?.from,
              to: toAddress,
              extraPendingTransactionData: {
                txHash: txHash,
                nonce: item?.nonce,
                data: item?.data,
                value: item?.value?.toString(),
                from: item?.from,
                to: item?.to,
              },
            };
            finalPendingTransactionData.push(tempItem);
          }
        }
        return {
          pendingTransactionsData: finalPendingTransactionData,
          pendingTransactionsHash: transactionDataArray,
        };
      }
      dispatch(setPendingTransactions({key, value: []}));
      return {pendingTransactionsData: [], pendingTransactionsHash: []};
    } else {
      return {pendingTransactionsData: [], pendingTransactionsHash: []};
    }
  };

  const getPendingTransactions = async ({pendingTransactions, key}) => {
    const {store} = require('redux/store');
    const {
      setPendingTransactions,
    } = require('dok-wallet-blockchain-networks/redux/wallets/walletsSlice');
    const dispatch = store.dispatch;
    const {pendingTransactionsHash, pendingTransactionsData} =
      await fetchPendingTransactions({
        pendingTransactions,
        key,
        setPendingTransactions,
        dispatch,
      });

    let tempPendingTransactions = Array.isArray(pendingTransactionsData)
      ? pendingTransactionsData
      : [];
    let tempPendingTransactionsHash = Array.isArray(pendingTransactionsHash)
      ? pendingTransactionsHash
      : [];
    return {
      pendingTransactionsData: tempPendingTransactions,
      pendingTransactionsHash: tempPendingTransactionsHash,
      dispatch,
      setPendingTransactions,
    };
  };
  const retryFunc = async (cb, defaultResponse) => {
    for (let i = 0; i < allRpcUrls.length; i++) {
      try {
        const fetchRequest = new FetchRequest(allRpcUrls[i]);
        fetchRequest.timeout = TIMEOUT;
        const retryEvmProvider = new JsonRpcProvider(fetchRequest, chainId, {
          staticNetwork: true,
        });
        return await cb(retryEvmProvider);
      } catch (e) {
        console.error('Error for EVM rpc', allRpcUrls[i], 'Errors:', e);
        if (i === allRpcUrls.length - 1) {
          if (defaultResponse) {
            return defaultResponse;
          } else {
            throw e;
          }
        }
      }
    }
  };

  const createSendTransactionsPromises = (finalWallet, tx) => {
    return allRpcUrls.map(
      rpcUrl =>
        new Promise(async resolve => {
          try {
            const fetchRequest = new FetchRequest(rpcUrl);
            fetchRequest.timeout = TIMEOUT;
            const tempProvider = new JsonRpcProvider(fetchRequest, chainId, {
              staticNetwork: true,
            });
            const finalWal = finalWallet.connect(tempProvider);
            const tr = await finalWal.sendTransaction(tx);
            resolve({resp: tr, error: null});
          } catch (e) {
            resolve({resp: null, error: e});
          }
        }),
    );
  };

  const createSendTransaction = async (wallet, tx) => {
    const allResp = await Promise.all(
      createSendTransactionsPromises(wallet, tx),
    );
    for (let i = 0; i < allResp.length; i++) {
      const txData = allResp[i].resp;
      const error = allResp[i].error;
      if (txData) {
        return txData;
      }
      if (i === allResp.length - 1 && error) {
        throw error;
      }
    }
  };

  const isValidNameEth = async ({name}) =>
    retryFunc(async evmProvider => {
      try {
        return await ethers.resolveAddress(name, evmProvider);
      } catch (e) {
        if (e?.message?.includes('UNCONFIGURED_NAME')) {
          return null;
        }
        throw e;
      }
    }, false);

  const isValidNameBNB = async ({name}) => {
    try {
      const resp = await axios.get('https://api.prd.space.id/v1/getAddress', {
        params: {
          domain: name,
          tld: name.substring(name.lastIndexOf('.') + 1),
        },
      });
      const address = resp?.data?.address;
      return address === '0x0000000000000000000000000000000000000000'
        ? null
        : address;
    } catch (e) {
      return null;
    }
  };

  const validNameChain = {
    ethereum: isValidNameEth,
    binance_smart_chain: isValidNameBNB,
  };

  const getL1Fee = async ({
    from,
    to,
    amount,
    estimateGas,
    gasFee,
    maxPriorityFeePerGas,
    evmProvider,
    erc20TokenContract,
    nftContract,
    tokenId,
    tokenAmount,
    contract_type,
    additionalL1Fee = 0,
  }) => {
    const nonce = await EVMChain(chain_name).getNonce({address: from});
    const tx = new Transaction();
    let transaction;
    if (erc20TokenContract) {
      const options = {
        gasLimit: estimateGas, // 100000
        maxFeePerGas: gasFee,
        maxPriorityFeePerGas,
      };
      transaction = await erc20TokenContract.transfer.populateTransaction(
        to,
        amount,
        options,
      );
    } else if (nftContract) {
      const options = {
        gasLimit: estimateGas, // 100000
        maxFeePerGas: gasFee,
        maxPriorityFeePerGas,
      };
      transaction =
        contract_type === 'ERC1155'
          ? await nftContract[
              'safeTransferFrom(address,address,uint256,uint256,bytes)'
            ].populateTransaction(
              from,
              to,
              Number(tokenId),
              Number(tokenAmount),
              '0x',
              options,
            )
          : await nftContract[
              'safeTransferFrom(address,address,uint256)'
            ].populateTransaction(from, to, Number(tokenId), options);
    }
    tx.type = 2;
    tx.to = transaction?.to || to;
    tx.gasLimit = estimateGas;
    tx.maxFeePerGas = gasFee;
    tx.maxPriorityFeePerGas = maxPriorityFeePerGas;
    tx.nonce = nonce;
    if (!erc20TokenContract && !nftContract) {
      tx.value = amount;
    }
    if (transaction?.data) {
      tx.data = transaction?.data;
    }
    const str = tx.unsignedSerialized;
    const contractAddress = GAS_ORACLE_CONTRACT_ADDRESS[chain_name];
    const contract = new ethers.Contract(
      contractAddress,
      gasOracleAbi,
      evmProvider,
    );
    const l1Fees = await contract.getL1Fee(str);
    const extraL1Bn = BigInt(new BigNumber(additionalL1Fee).toFixed(0));
    return l1Fees + extraL1Bn;
  };

  const calculateTotalFees = async ({
    feesType,
    evmProvider,
    fromAddress,
    toAddress,
    estimateGas,
    value,
    erc20TokenContract,
    nftContract,
    tokenId,
    tokenAmount,
    contract_type,
    twiceFee,
    additionalL1Fee,
    ignoreLayer2,
  }) => {
    const {gasPrice, feesOptions, maxPriorityFeePerGas} =
      await getEtherGasPrice(feesType, evmProvider);
    let level1Fees = 0n;

    let finalGasPrice = gasPrice;
    if (twiceFee) {
      finalGasPrice = finalGasPrice * 2n;
    }
    if (isLayer2Chain(chain_name) && !ignoreLayer2) {
      level1Fees = await getL1Fee({
        from: fromAddress,
        to: toAddress,
        estimateGas,
        maxPriorityFeePerGas,
        gasFee: finalGasPrice,
        amount: value,
        evmProvider,
        erc20TokenContract,
        nftContract,
        tokenId,
        tokenAmount,
        contract_type,
        additionalL1Fee,
      });
    }
    const transactionFee = estimateGas * finalGasPrice + level1Fees;
    const totalTransactionFee = ethers.formatUnits(transactionFee, 'ether');
    return {
      fee: totalTransactionFee,
      gasFee: finalGasPrice,
      estimateGas: estimateGas,
      maxPriorityFeePerGas,
      feesOptions,
      l1Fees: level1Fees,
    };
  };

  return {
    isValidAddress: ({address}) => {
      return ethers.isAddress(address);
    },
    isValidName: async ({name}) => {
      return validNameChain[chain_name]({name});
    },
    getWallet: ({privateKey}) => {
      return new ethers.Wallet(privateKey);
    },
    isValidPrivateKey: ({privateKey}) => {
      try {
        const wallet = new ethers.Wallet(privateKey);
        return !!wallet?.address;
      } catch (e) {
        return false;
      }
    },
    createWalletByPrivateKey: ({privateKey}) => {
      const wallet = new ethers.Wallet(privateKey);
      return {
        address: wallet.address,
        privateKey: privateKey,
      };
    },
    getContract: async ({contractAddress}) =>
      retryFunc(async evmProvider => {
        try {
          const contract = new ethers.Contract(
            contractAddress,
            localErc20ABI,
            evmProvider,
          );
          if (!contract) {
            console.error('no ether contract found');
          }
          const name = await contract.name();
          const decimals = await contract.decimals();
          const symbol = await contract.symbol();
          return {
            name,
            symbol,
            decimals,
          };
        } catch (e) {
          console.error(`error getting contract for ether ${e}`);
          throw e;
        }
      }, {}),
    getBalance: async ({address}) =>
      retryFunc(async evmProvider => {
        try {
          const balanceWei = await evmProvider.getBalance(address);
          return balanceWei.toString();
        } catch (e) {
          console.error('error in get balance from ether', e);
          throw e;
        }
      }, ''),
    getEstimateFeeForBatchTransaction: async ({calls, privateKey, feesType}) =>
      retryFunc(async evmProvider => {
        try {
          const wallet = new ethers.Wallet(privateKey);
          let walletSigner = wallet.connect(evmProvider);
          const delegatedContract = new ethers.Contract(
            walletSigner.address,
            contractABI,
            walletSigner,
          );
          const currentNonce = await EVMChain(chain_name).getNonce({
            address: wallet.address,
          });
          // Create authorization with incremented nonce for same-wallet transactions
          const auth = await createAuthorization(
            walletSigner,
            currentNonce + 1,
            BATCH_TRANSACTION_CONTRACT_ADDRESS[chain_name],
          );
          const options = {
            type: 4,
            authorizationList: [auth],
          };
          const estimateGas = await delegatedContract[
            'execute((address,uint256,bytes)[])'
          ].estimateGas(calls, options);
          return await calculateTotalFees({
            evmProvider,
            feesType,
            estimateGas,
            ignoreLayer2: true,
          });
        } catch (e) {
          console.error('error in get token fees for batch transaction', e);
          throw e;
        }
      }, null),
    getEstimateFeeForToken: async ({
      fromAddress,
      toAddress,
      contractAddress,
      amount,
      decimals,
      privateKey,
      feesType,
      additionalL1Fee,
    }) =>
      retryFunc(async evmProvider => {
        try {
          const wallet = new ethers.Wallet(privateKey);
          let walletSigner = wallet.connect(evmProvider);
          const contract = new ethers.Contract(
            contractAddress,
            localErc20ABI,
            walletSigner,
          );
          const value = ethers.parseUnits(amount, Number(decimals));
          const estimateGas = await contract[
            'transfer(address,uint256)'
          ].estimateGas(toAddress, value);
          return await calculateTotalFees({
            evmProvider,
            feesType,
            value,
            estimateGas,
            fromAddress,
            toAddress,
            erc20TokenContract: contract,
            additionalL1Fee,
          });
        } catch (e) {
          console.error('error in get token fees for ether', e);
          throw e;
        }
      }, null),

    getEstimateFeeForNFT: async ({
      fromAddress,
      toAddress,
      contractAddress,
      privateKey,
      tokenId,
      contract_type,
      tokenAmount,
      feesType,
      additionalL1Fee,
    }) =>
      retryFunc(async evmProvider => {
        try {
          const wallet = new ethers.Wallet(privateKey);
          let walletSigner = wallet.connect(evmProvider);
          const contract = new ethers.Contract(
            contractAddress,
            contract_type === 'ERC1155' ? erc1155Abi : erc721Abi,
            walletSigner,
          );
          const estimateGas =
            contract_type === 'ERC1155'
              ? await contract[
                  'safeTransferFrom(address,address,uint256,uint256,bytes)'
                ].estimateGas(
                  fromAddress,
                  toAddress,
                  Number(tokenId),
                  Number(tokenAmount),
                  '0x',
                )
              : await contract[
                  'safeTransferFrom(address,address,uint256)'
                ].estimateGas(fromAddress, toAddress, Number(tokenId));

          return await calculateTotalFees({
            estimateGas,
            evmProvider,
            fromAddress,
            toAddress,
            feesType,
            nftContract: contract,
            tokenId,
            tokenAmount,
            contract_type,
            additionalL1Fee,
          });
        } catch (e) {
          console.error('error in get nft fees for ether chain', e);
          throw e;
        }
      }, null),
    getEstimateFee: async ({
      fromAddress,
      toAddress,
      amount,
      feesType,
      additionalL1Fee,
    }) =>
      retryFunc(async evmProvider => {
        try {
          const value = ethers.parseEther(amount);
          const payload = {
            from: fromAddress,
            to: toAddress,
            value,
          };
          const estimateGas = await evmProvider.estimateGas(payload);
          return await calculateTotalFees({
            estimateGas,
            evmProvider,
            fromAddress,
            toAddress,
            value,
            feesType,
            additionalL1Fee,
          });
        } catch (e) {
          console.error('Error in gas fee', e);
          throw e;
        }
      }, null),
    createCall: async ({toAddress, amount, decimals}) => {
      try {
        return [toAddress, convertToSmallAmount(amount, decimals || 18), '0x'];
      } catch (e) {
        console.error('Error in createCall', e);
        throw e;
      }
    },
    createTokenCall: async ({contractAddress, toAddress, amount, decimals}) => {
      try {
        const erc20Interface = new ethers.Interface(erc20Abi);
        const finalAmount = convertToSmallAmount(amount, decimals);
        return [
          contractAddress,
          '0',
          erc20Interface.encodeFunctionData('transfer', [
            toAddress,
            finalAmount,
          ]),
        ];
      } catch (e) {
        console.error('Error in createTokenCall', e);
        throw e;
      }
    },
    createNFTCall: async ({
      contractAddress,
      fromAddress,
      toAddress,
      tokenId,
      contract_type,
      tokenAmount,
    }) => {
      try {
        const abi = contract_type === 'ERC1155' ? erc1155Abi : erc721Abi;
        const nftInterface = new ethers.Interface(abi);
        return [
          contractAddress,
          '0',
          contract_type === 'ERC1155'
            ? nftInterface.encodeFunctionData('safeTransferFrom', [
                fromAddress,
                toAddress,
                Number(tokenId),
                Number(tokenAmount),
                '0x',
              ])
            : nftInterface.encodeFunctionData('safeTransferFrom', [
                fromAddress,
                toAddress,
                Number(tokenId),
              ]),
        ];
      } catch (e) {
        console.error('Error in createNFTCall', e);
        throw e;
      }
    },
    getEstimateFeeForPendingTransaction: async ({
      fromAddress,
      toAddress,
      value,
      feesType,
      data,
      isCancelTransaction,
      additionalL1Fee,
    }) =>
      retryFunc(async evmProvider => {
        try {
          const payload = {
            from: fromAddress,
            to: isCancelTransaction ? fromAddress : toAddress,
            value: value,
            data: data,
          };
          const estimateGas = await evmProvider.estimateGas(payload);
          return await calculateTotalFees({
            estimateGas,
            evmProvider,
            fromAddress,
            toAddress,
            value,
            feesType,
            twiceFee: true,
            additionalL1Fee,
          });
        } catch (e) {
          const {reason} = await errorDecoder.decode(e);
          console.error('Error in getEstimateFeeForPendingTransaction', reason);
          throw new Error(reason);
        }
      }, null),
    getTokenBalance: async ({address, contractAddress}) =>
      retryFunc(async evmProvider => {
        try {
          const contract = new ethers.Contract(
            contractAddress,
            localErc20ABI,
            evmProvider,
          );
          if (contract) {
            const balance = await contract.balanceOf(address);
            return balance.toString();
          }
          return '0';
        } catch (e) {
          console.error(`error getting token balance for ether ${e}`);
          throw e;
        }
      }, '0'),
    getTransactions: async ({address, pendingTransactions, key}) => {
      try {
        const {
          pendingTransactionsData,
          pendingTransactionsHash,
          dispatch,
          setPendingTransactions,
        } = await getPendingTransactions({pendingTransactions, key});
        let tempPendingTransactions = pendingTransactionsData;
        const transactions = await EvmServices[chain_name]?.getTransactions({
          chain_name,
          address,
        });
        const removePendingTransactions = [];
        if (Array.isArray(transactions?.data)) {
          const transactionsData = transactions?.data.map(item => {
            const bnValue = BigInt(item?.value);
            const txHash = item?.hash;
            const nonce = item?.nonce;
            const foundIndex = tempPendingTransactions.findIndex(
              pendingTransaction =>
                pendingTransaction?.extraPendingTransactionData?.nonce?.toString() ===
                nonce?.toString(),
            );

            if (foundIndex !== -1) {
              const {deletedObject, updatedArray} = deleteItemAtIndex(
                tempPendingTransactions,
                foundIndex,
              );
              if (deletedObject && Array.isArray(updatedArray)) {
                removePendingTransactions.push(
                  deletedObject?.extraPendingTransactionData?.txHash,
                );
                tempPendingTransactions = updatedArray;
              }
            }
            return {
              amount: bnValue.toString(),
              link: txHash.substring(0, 13) + '...',
              url: `${SCAN_URL[getScanUrlName()]}/tx/${txHash}`,
              status: Number(item?.txreceipt_status) ? 'SUCCESS' : 'FAIL',
              date: item?.timeStamp * 1000, //new Date(transaction.raw_data.timestamp),
              from: item?.from,
              to: item?.to,
              totalCourse: '0$',
            };
          });
          if (removePendingTransactions.length) {
            const deletedPendingTransactions = pendingTransactionsHash.filter(
              item =>
                removePendingTransactions.findIndex(
                  subItem =>
                    subItem?.toLowerCase() === item.hash?.toLowerCase(),
                ) === -1,
            );
            dispatch(
              setPendingTransactions({key, value: deletedPendingTransactions}),
            );
          }
          const finalTransactions = [
            ...tempPendingTransactions,
            ...transactionsData,
          ];
          return finalTransactions.sort((a, b) => new Date(b) - new Date(a));
        }
        return [...tempPendingTransactions];
      } catch (e) {
        console.error(`error getting transactions for ether ${e}`);
        return [];
      }
    },
    getTransactionForUpdate: async ({from, txHash, decimals}) => {
      const foundTransactions = await safeGetTransactionStatus(txHash);
      if (foundTransactions) {
        throw new Error('Transaction is already succeed');
      }
      const tr = await safeGetTransactionData(txHash);
      if (!tr) {
        throw new Error('Transaction not found');
      }

      const pendingNonce = await EVMChain(chain_name).getSafelyLatestNonce({
        address: from,
      });
      if (pendingNonce !== tr?.nonce) {
        throw new Error(
          'Transaction is in queue, Please update first pending transactions.',
        );
      }
      const hash = tr.hash;
      const decodeTx = parseTransaction(tr.data);
      let contractDetails = null;
      if (decodeTx?.toAddress) {
        contractDetails = await EVMChain(chain_name).getContract({
          contractAddress: tr?.to,
        });
        if (contractDetails?.decimals) {
          contractDetails = {
            ...contractDetails,
            decimals: Number(contractDetails?.decimals),
          };
        }
      }

      const amount = decodeTx?.value || tr?.value?.toString();
      const toAddress = decodeTx?.toAddress || tr?.to;
      const localDecimals = contractDetails?.decimals || decimals;
      const formatAmount = parseBalance(amount, localDecimals);
      return {
        amount: formatAmount,
        link: hash.substring(0, 13) + '...',
        url: `${SCAN_URL[getScanUrlName()]}/tx/${hash}`,
        status: 'PENDING',
        from: tr?.from,
        to: toAddress,
        contractDetails,
        extraPendingTransactionData: {
          txHash: hash,
          nonce: tr?.nonce,
          data: tr?.data,
          value: tr?.value?.toString(),
          from: tr?.from,
          to: tr?.to,
        },
      };
    },

    getTokenTransactions: async ({
      address,
      contractAddress,
      decimal,
      pendingTransactions,
      key,
    }) => {
      try {
        const {
          pendingTransactionsData,
          pendingTransactionsHash,
          dispatch,
          setPendingTransactions,
        } = await getPendingTransactions({pendingTransactions, key});
        let tempPendingTransactions = pendingTransactionsData;
        const transactions = await EvmServices[chain_name]?.getTransactions({
          address,
          contractAddress,
          decimals: decimal,
          chain_name,
        });
        const removePendingTransactions = [];
        if (Array.isArray(transactions?.data)) {
          const transactionsData = transactions?.data.map(item => {
            const bnValue = BigInt(item?.value);
            const txHash = item?.hash;
            const nonce = item?.nonce;
            const foundIndex = tempPendingTransactions.findIndex(
              pendingTransaction =>
                pendingTransaction?.extraPendingTransactionData?.nonce?.toString() ===
                nonce?.toString(),
            );

            if (foundIndex !== -1) {
              const {deletedObject, updatedArray} = deleteItemAtIndex(
                tempPendingTransactions,
                foundIndex,
              );
              if (deletedObject && Array.isArray(updatedArray)) {
                removePendingTransactions.push(
                  deletedObject?.extraPendingTransactionData?.txHash,
                );
                tempPendingTransactions = updatedArray;
              }
            }
            return {
              amount: bnValue.toString(),
              link: txHash.substring(0, 13) + '...',
              url: `${SCAN_URL[getScanUrlName()]}/tx/${txHash}`,
              status: Number(item?.confirmations) > 14 ? 'SUCCESS' : 'FAIL',
              date: item?.timeStamp * 1000, //new Date(transaction.raw_data.timestamp),
              from: item?.from,
              to: item?.to,
              contractAddress: item?.contractAddress,
              totalCourse: '0$',
            };
          });
          if (removePendingTransactions.length) {
            const deletedPendingTransactions = pendingTransactionsHash.filter(
              item =>
                removePendingTransactions.findIndex(
                  subItem =>
                    subItem?.toLowerCase() === item.hash?.toLowerCase(),
                ) === -1,
            );
            dispatch(
              setPendingTransactions({key, value: deletedPendingTransactions}),
            );
          }
          const finalTransactions = [
            ...tempPendingTransactions,
            ...transactionsData,
          ];
          return finalTransactions.sort((a, b) => new Date(b) - new Date(a));
        }
        return [];
      } catch (e) {
        console.error(`error getting token transactions for ether ${e}`);
        return [];
      }
    },
    send: async ({
      to,
      from,
      amount,
      privateKey,
      estimateGas,
      gasFee,
      feesType,
      maxPriorityFeePerGas,
      isMax,
    }) => {
      try {
        const fetchRequest = new FetchRequest(allRpcUrls[0]);
        fetchRequest.timeout = TIMEOUT;
        const evmProvider = new JsonRpcProvider(fetchRequest, chainId, {
          staticNetwork: true,
        });
        const wallet = new ethers.Wallet(privateKey);
        let walletSigner = wallet.connect(evmProvider);
        let finalEstimateGas = estimateGas;

        if (typeof finalEstimateGas !== 'bigint') {
          finalEstimateGas = await evmProvider.estimateGas({
            from: from,
            to: to,
            value: ethers.parseEther(amount),
          });
        }
        let finalGasPrice = gasFee;
        let finalMaxPriorityFeePerGas = maxPriorityFeePerGas;
        if (typeof finalGasPrice !== 'bigint') {
          const gasFeeData = await getEtherGasPrice(feesType, evmProvider);
          finalGasPrice = gasFeeData?.gasPrice;
          finalMaxPriorityFeePerGas = gasFeeData?.maxPriorityFeePerGas;
        }

        const balanceWei = await evmProvider.getBalance(from);
        const balanceEther = ethers.formatEther(balanceWei);
        const transactionFee = finalEstimateGas * finalGasPrice;
        const estimateFee = ethers.formatUnits(transactionFee, 'ether');
        let finalAmount = amount;
        const feeBN = new BigNumber(estimateFee);
        const totalAmount = new BigNumber(finalAmount).plus(feeBN);
        const balanceBN = new BigNumber(balanceEther);
        if (balanceBN.lt(totalAmount)) {
          finalAmount = balanceBN.minus(feeBN).toString();
        }
        const nonce = await EVMChain(chain_name).getNonce({address: from});
        const tx = {
          type: 2,
          from: from,
          to: to,
          value: ethers.parseEther(finalAmount),
          gasLimit: finalEstimateGas,
          maxFeePerGas: finalGasPrice,
          maxPriorityFeePerGas: isMax
            ? finalGasPrice
            : finalMaxPriorityFeePerGas,
          nonce,
        };
        if (isEip1559NotSupported(chain_name)) {
          delete tx.type;
          delete tx.maxPriorityFeePerGas;
          delete tx.maxFeePerGas;
          tx.gasPrice = finalGasPrice;
        }
        return await createSendTransaction(walletSigner, tx);
      } catch (e) {
        console.error('Error in send ether transaction', e);
        const {reason} = await errorDecoder.decode(e);
        throw new Error(reason);
      }
    },
    cancelTransaction: async ({from, nonce, privateKey, feesType}) => {
      try {
        const fetchRequest = new FetchRequest(allRpcUrls[0]);
        fetchRequest.timeout = TIMEOUT;
        const evmProvider = new JsonRpcProvider(fetchRequest, chainId, {
          staticNetwork: true,
        });
        const wallet = new ethers.Wallet(privateKey);
        let walletSigner = wallet.connect(evmProvider);
        const finalEstimateGas = await evmProvider.estimateGas({
          from: from,
          to: from,
          data: '0x',
        });
        const {gasPrice} = await getEtherGasPrice(feesType, evmProvider);
        const twiceGasPrice = gasPrice * 2n;
        const tx = {
          type: 2,
          from: from,
          to: from,
          data: '0x',
          gasLimit: finalEstimateGas,
          maxFeePerGas: twiceGasPrice,
          maxPriorityFeePerGas: twiceGasPrice,
          nonce: nonce,
        };
        if (isEip1559NotSupported(chain_name)) {
          delete tx.type;
          delete tx.maxPriorityFeePerGas;
          delete tx.maxFeePerGas;
          tx.gasPrice = twiceGasPrice;
        }
        return await createSendTransaction(walletSigner, tx);
      } catch (e) {
        const {reason} = await errorDecoder.decode(e);
        console.error('Error in cancel ether transaction', reason);
        throw new Error(reason);
      }
    },
    accelerateTransaction: async ({
      from,
      to,
      nonce,
      value,
      privateKey,
      feesType,
      data,
    }) => {
      try {
        const fetchRequest = new FetchRequest(allRpcUrls[0]);
        fetchRequest.timeout = TIMEOUT;
        const evmProvider = new JsonRpcProvider(fetchRequest, chainId, {
          staticNetwork: true,
        });
        const wallet = new ethers.Wallet(privateKey);
        let walletSigner = wallet.connect(evmProvider);
        const finalEstimateGas = await evmProvider.estimateGas({
          from: from,
          to: to,
          data: data,
          value: value,
        });
        const {gasPrice} = await getEtherGasPrice(feesType, evmProvider);
        const twiceGasPrice = gasPrice * 2n;
        const tx = {
          type: 2,
          from: from,
          to: to,
          data: data,
          value: value,
          gasLimit: finalEstimateGas,
          maxFeePerGas: twiceGasPrice,
          maxPriorityFeePerGas: twiceGasPrice,
          nonce: nonce,
        };
        if (isEip1559NotSupported(chain_name)) {
          delete tx.type;
          delete tx.maxPriorityFeePerGas;
          delete tx.maxFeePerGas;
          tx.gasPrice = twiceGasPrice;
        }
        return await createSendTransaction(walletSigner, tx);
      } catch (e) {
        const {reason} = await errorDecoder.decode(e);
        console.error(
          'Error in accelerate ether Transaction  transaction',
          reason,
        );
        throw new Error(reason);
      }
    },
    sendBatchTransaction: async ({
      calls,
      privateKey,
      estimateGas,
      gasFee,
      feesType,
      maxPriorityFeePerGas,
    }) => {
      try {
        const fetchRequest = new FetchRequest(allRpcUrls[0]);
        fetchRequest.timeout = TIMEOUT;
        const evmProvider = new JsonRpcProvider(fetchRequest, chainId, {
          staticNetwork: true,
        });
        const wallet = new ethers.Wallet(privateKey);
        let walletSigner = wallet.connect(evmProvider);
        const delegatedContract = new ethers.Contract(
          walletSigner.address,
          contractABI,
          walletSigner,
        );
        const currentNonce = await EVMChain(chain_name).getNonce({
          address: wallet.address,
        });
        let finalEstimateGas = estimateGas;
        if (typeof finalEstimateGas !== 'bigint') {
          // Create authorization for gas estimation consistency
          const tempAuth = await createAuthorization(
            walletSigner,
            currentNonce + 1,
            BATCH_TRANSACTION_CONTRACT_ADDRESS[chain_name],
          );
          const tempOptions = {
            type: 4,
            authorizationList: [tempAuth],
          };
          finalEstimateGas = await delegatedContract[
            'execute((address,uint256,bytes)[])'
          ].estimateGas(calls, tempOptions);
        }
        let finalGasPrice = gasFee;
        let finalMaxPriorityFeePerGas = maxPriorityFeePerGas;
        if (typeof finalGasPrice !== 'bigint') {
          const gasFeeData = await getEtherGasPrice(feesType, evmProvider);
          finalGasPrice = gasFeeData?.gasPrice;
          finalMaxPriorityFeePerGas = gasFeeData?.maxPriorityFeePerGas;
        }

        // Create authorization with incremented nonce for same-wallet transactions
        const auth = await createAuthorization(
          walletSigner,
          currentNonce + 1,
          BATCH_TRANSACTION_CONTRACT_ADDRESS[chain_name],
        );
        const options = {
          type: 4,
          gasLimit: finalEstimateGas + extraEstimate,
          maxFeePerGas: finalGasPrice,
          maxPriorityFeePerGas: finalMaxPriorityFeePerGas,
          nonce: currentNonce,
          authorizationList: [auth],
        };

        if (isEip1559NotSupported(chain_name)) {
          delete options.maxPriorityFeePerGas;
          delete options.maxFeePerGas;
          delete options.type;
          options.gasPrice = finalGasPrice;
        }
        const tx = await delegatedContract[
          'execute((address,uint256,bytes)[])'
        ].populateTransaction(calls, options);
        return await createSendTransaction(walletSigner, tx);
      } catch (e) {
        console.error('Error in send ether batch transaction', e);
        const {reason} = await errorDecoder.decode(e);
        throw new Error(reason);
      }
    },
    sendToken: async ({
      to,
      amount,
      privateKey,
      estimateGas,
      gasFee,
      contractAddress,
      feesType,
      maxPriorityFeePerGas,
    }) => {
      try {
        const fetchRequest = new FetchRequest(allRpcUrls[0]);
        fetchRequest.timeout = TIMEOUT;
        const evmProvider = new JsonRpcProvider(fetchRequest, chainId, {
          staticNetwork: true,
        });
        const wallet = new ethers.Wallet(privateKey);
        let walletSigner = wallet.connect(evmProvider);
        const contract = new ethers.Contract(
          contractAddress,
          localErc20ABI,
          walletSigner,
        );
        const decimals = await contract.decimals();
        let finalEstimateGas = estimateGas;
        if (typeof finalEstimateGas !== 'bigint') {
          finalEstimateGas = await contract[
            'transfer(address,uint256)'
          ].estimateGas(to, ethers.parseUnits(amount, decimals));
        }
        let finalGasPrice = gasFee;
        let finalMaxPriorityFeePerGas = maxPriorityFeePerGas;
        if (typeof finalGasPrice !== 'bigint') {
          const gasFeeData = await getEtherGasPrice(feesType, evmProvider);
          finalGasPrice = gasFeeData?.gasPrice;
          finalMaxPriorityFeePerGas = gasFeeData?.maxPriorityFeePerGas;
        }
        const nonce = await EVMChain(chain_name).getNonce({
          address: wallet.address,
        });
        const options = {
          type: 2,
          gasLimit: finalEstimateGas, // 100000
          maxFeePerGas: finalGasPrice,
          maxPriorityFeePerGas: finalMaxPriorityFeePerGas,
          nonce,
        };
        if (isEip1559NotSupported(chain_name)) {
          delete options.type;
          delete options.maxPriorityFeePerGas;
          delete options.maxFeePerGas;
          options.gasPrice = finalGasPrice;
        }
        const tx = await contract.transfer.populateTransaction(
          to,
          ethers.parseUnits(amount.toString(), decimals),
          options,
        );
        return await createSendTransaction(walletSigner, tx);
      } catch (e) {
        console.error('Error in send ether token transaction', e);
        const {reason} = await errorDecoder.decode(e);
        throw new Error(reason);
      }
    },
    sendNFT: async ({
      to,
      from,
      privateKey,
      estimateGas,
      gasFee,
      contractAddress,
      contract_type,
      tokenAmount,
      tokenId,
      feesType,
      maxPriorityFeePerGas,
    }) => {
      try {
        const fetchRequest = new FetchRequest(allRpcUrls[0]);
        fetchRequest.timeout = TIMEOUT;
        const evmProvider = new JsonRpcProvider(fetchRequest, chainId, {
          staticNetwork: true,
        });
        const wallet = new ethers.Wallet(privateKey);
        let walletSigner = wallet.connect(evmProvider);
        const contract = new ethers.Contract(
          contractAddress,
          contract_type === 'ERC1155' ? erc1155Abi : erc721Abi,
          walletSigner,
        );
        let finalEstimateGas = estimateGas;
        if (typeof finalEstimateGas !== 'bigint') {
          finalEstimateGas =
            contract_type === 'ERC1155'
              ? await contract[
                  'safeTransferFrom(address,address,uint256,uint256,bytes)'
                ].estimateGas(
                  from,
                  to,
                  Number(tokenId),
                  Number(tokenAmount),
                  '0x',
                )
              : await contract[
                  'safeTransferFrom(address,address,uint256)'
                ].estimateGas(from, to, Number(tokenId));
        }
        let finalGasPrice = gasFee;
        let finalMaxPriorityFeePerGas = maxPriorityFeePerGas;
        if (typeof finalGasPrice !== 'bigint') {
          const gasFeeData = await getEtherGasPrice(feesType, evmProvider);
          finalGasPrice = gasFeeData?.gasPrice;
          finalMaxPriorityFeePerGas = gasFeeData?.maxPriorityFeePerGas;
        }
        const nonce = await EVMChain(chain_name).getNonce({
          address: wallet.address,
        });
        const options = {
          type: 2,
          gasLimit: finalEstimateGas, // 100000
          maxFeePerGas: finalGasPrice,
          maxPriorityFeePerGas: finalMaxPriorityFeePerGas,
          nonce,
        };
        if (isEip1559NotSupported(chain_name)) {
          delete options.type;
          delete options.maxPriorityFeePerGas;
          delete options.maxFeePerGas;
          options.gasPrice = finalGasPrice;
        }
        const tx =
          contract_type === 'ERC1155'
            ? await contract[
                'safeTransferFrom(address,address,uint256,uint256,bytes)'
              ].populateTransaction(
                from,
                to,
                Number(tokenId),
                Number(tokenAmount),
                '0x',
                options,
              )
            : await contract[
                'safeTransferFrom(address,address,uint256)'
              ].populateTransaction(from, to, Number(tokenId), options);
        return await createSendTransaction(walletSigner, tx);
      } catch (e) {
        console.error('Error in send ether nft token transaction', e);
        const {reason} = await errorDecoder.decode(e);
        throw new Error(reason);
      }
    },
    getNonce: async ({address}) => {
      let nonce = await EVMChain(chain_name).getSafelyPendingNonce({
        address,
      });
      if (nonce === 'not_found_pending_nonce') {
        nonce = await EVMChain(chain_name).getSafelyLatestNonce({
          address,
        });
        if (nonce === 'not_found_latest_nonce') {
          throw new Error('Not found node');
        }
      }
      return nonce;
    },

    getSafelyPendingNonce: ({address}) =>
      retryFunc(async evmProvider => {
        try {
          return await evmProvider.getTransactionCount(address, 'pending');
        } catch (e) {
          console.error(`error getSafelyPendingNonce ${e}`);
          throw e;
        }
      }, 'not_found_pending_nonce'),
    getSafelyLatestNonce: ({address}) =>
      retryFunc(async evmProvider => {
        try {
          return await evmProvider.getTransactionCount(address);
        } catch (e) {
          console.error(`error getSafelyPendingNonce ${e}`);
          throw e;
        }
      }, 'not_found_latest_nonce'),
    waitForConfirmation: async ({transaction}) => {
      if (transaction?.wait) {
        try {
          return await transaction?.wait(null, 60000);
        } catch (e) {
          const {reason} = await errorDecoder.decode(e);
          if (reason === 'wait for transaction timeout') {
            return 'pending';
          }
          throw new Error(reason);
        }
      }
    },
  };
};
