import {
  config,
  IS_SANDBOX,
  isWeb,
} from 'dok-wallet-blockchain-networks/config/config';
import BigNumber from 'bignumber.js';
import {
  Authorized,
  ComputeBudgetProgram,
  Connection,
  Keypair,
  PublicKey,
  StakeProgram,
  SystemProgram,
  Transaction,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
} from '@solana/web3.js';
import {
  createTransferInstruction,
  getMint,
  getOrCreateAssociatedTokenAccount,
  TokenAccountNotFoundError,
} from '@solana/spl-token';

import {
  convertToSmallAmount,
  customFetchWithTimeout,
  differentInCurrentTime,
  isValidStringWithValue,
  parseBalance,
} from 'dok-wallet-blockchain-networks/helper';
import bs58 from 'bs58';
import {getSolanaContract} from 'dok-wallet-blockchain-networks/service/solflare';
import {nanoid} from 'nanoid';
import {getFreeRPCUrl} from 'dok-wallet-blockchain-networks/rpcUrls/rpcUrls';
import {getStakingByChain} from 'dok-wallet-blockchain-networks/service/dokApi';
import {StakeWiz} from 'dok-wallet-blockchain-networks/service/stakeWiz';
import {getStakeActivation} from '@anza-xyz/solana-rpc-get-stake-activation';

const defaultDeductionAmount = 20000n;

async function getSimulationUnits(
  connection,
  instructions,
  payer,
  lookupTables,
) {
  const gasFee = await getPriorityFee(connection, payer);
  const testInstructions = [
    ComputeBudgetProgram.setComputeUnitPrice({microLamports: gasFee}),
    ComputeBudgetProgram.setComputeUnitLimit({units: 1_400_000}),
    ...instructions,
  ];
  const transactionMessage = new TransactionMessage({
    instructions: testInstructions,
    payerKey: payer,
    recentBlockhash: PublicKey.default.toString(),
  });

  const testVersionedTxn = new VersionedTransaction(
    transactionMessage.compileToV0Message(lookupTables),
  );

  const simulation = await connection.simulateTransaction(testVersionedTxn, {
    replaceRecentBlockhash: true,
    sigVerify: false,
  });
  return {units: simulation?.value?.unitsConsumed || 0, gasFee};
}

// Example Usage

export const SolanaChain = () => {
  const retryFunc = async (cb, defaultResponse, isTransaction = false) => {
    const solanaRpc = getFreeRPCUrl('solana');
    const transactionSolanaRpc = getFreeRPCUrl(isWeb ? 'solana' : 'tx_solana');
    const rpcs = isTransaction ? transactionSolanaRpc : solanaRpc;
    for (let i = 0; i < rpcs.length; i++) {
      try {
        const solanaProvider = new Connection(rpcs[i], {
          fetch: customFetchWithTimeout,
        });
        return await cb(solanaProvider);
      } catch (e) {
        console.log('Error for solana rpc', rpcs[i], 'Errors:', e);
        if (i === rpcs.length - 1) {
          if (defaultResponse === undefined) {
            return defaultResponse;
          } else {
            throw e;
          }
        }
      }
    }
  };

  const getTotalEstimateFees = async (
    fromAddress,
    transactionMessage,
    solanaProvider,
  ) => {
    const fromAddressPubKey = new PublicKey(fromAddress);
    const {units, gasFee} = await getSimulationUnits(
      solanaProvider,
      transactionMessage.instructions,
      fromAddressPubKey,
    );
    const resp = await solanaProvider.getFeeForMessage(
      transactionMessage.compileToV0Message(),
    );
    const extraFees = Math.ceil((gasFee * units) / 1000000);
    const totalFee = extraFees + resp.value;
    const totalFeeStr = parseBalance(totalFee, 9);
    return {
      totalFee: totalFeeStr,
      unit: units,
      gasFee: gasFee,
    };
  };

  const sendTransaction = async ({
    transactionMessage,
    privateKey,
    solanaProvider,
  }) => {
    const secretKey = bs58.decode(privateKey);
    const fromKeypair = Keypair.fromSecretKey(secretKey, {
      skipValidation: true,
    });
    const transaction = new VersionedTransaction(
      transactionMessage.compileToV0Message(),
    );
    transaction.sign([fromKeypair]);
    return await solanaProvider.sendTransaction(transaction, {
      skipPreflight: true,
      preflightCommitment: 'processed',
    });
  };

  return {
    isValidAddress: ({address}) => {
      return PublicKey.isOnCurve(address);
    },
    isValidPrivateKey: ({privateKey}) => {
      try {
        const secretKey = bs58.decode(privateKey);
        const fromPair = Keypair.fromSecretKey(secretKey, {
          skipValidation: false,
        });
        return !!fromPair;
      } catch (e) {
        return false;
      }
    },
    createWalletByPrivateKey: ({privateKey}) => {
      const buffer = bs58.decode(privateKey);
      const keyPair = Keypair.fromSecretKey(buffer, {skipValidation: false});
      return {
        address: keyPair.publicKey.toBase58(),
        privateKey: bs58.encode(keyPair.secretKey),
      };
    },
    getStaking: async ({address}) =>
      retryFunc(async solanaProvider => {
        try {
          const allStakeAccounts =
            await solanaProvider.getParsedProgramAccounts(
              StakeProgram.programId,
              {
                filters: [
                  {
                    memcmp: {
                      offset: 12, // number of bytes
                      bytes: address, // base58 encoded string
                    },
                  },
                ],
              },
            );
          if (!allStakeAccounts?.length) {
            return [];
          }
          const validatorsResp = await StakeWiz.getListOfValidator();
          const allValidators = Array.isArray(validatorsResp?.data)
            ? validatorsResp?.data
            : [];

          if (Array.isArray(allStakeAccounts)) {
            const tempData = allStakeAccounts?.map(item => {
              const validatorAddress =
                item?.account?.data?.parsed?.info?.stake?.delegation?.voter?.toString();
              const foundValidators = allValidators.find(
                subItem => subItem.vote_identity === validatorAddress,
              );
              return {
                staking_address: item?.pubkey?.toString(),
                amount: item?.account?.lamports,
                validator_address: validatorAddress,
                owner_address: address,
                validatorInfo: {
                  name: foundValidators?.name,
                  website: foundValidators?.website,
                  image: foundValidators?.image,
                },
              };
            });
            const fetchStatusPromise = tempData.map(async item => {
              try {
                const stakePubKey = new PublicKey(item?.staking_address);
                const stakeActivation = await getStakeActivation(
                  solanaProvider,
                  stakePubKey,
                );
                return stakeActivation?.status || null;
              } catch (e) {
                console.error(
                  'Error in get solana staking status with pubkey: ',
                  item?.staking_address,
                  ' Error:',
                  e,
                );
                return null;
              }
            });
            const statusResp = await Promise.all(fetchStatusPromise);
            return tempData?.map((item, i) => ({
              ...item,
              status: statusResp[i],
            }));
          }
          return [];
        } catch (e) {
          console.error('Error in get staking in solana', e);
          throw e;
        }
      }, []),
    getStakingInfo: async ({staking}) => {
      try {
        const tempStaking = Array.isArray(staking) ? staking : [];
        const {totalValue, tempPendingAmount} = tempStaking.reduce(
          (acc, item) => {
            const amountBN = new BigNumber(item.amount || 0);
            if (item?.status !== 'activating') {
              acc.totalValue = acc.totalValue.plus(amountBN);
            } else {
              acc.tempPendingAmount = acc.tempPendingAmount.plus(amountBN);
            }
            return acc;
          },
          {totalValue: new BigNumber(0), tempPendingAmount: new BigNumber(0)},
        );
        const info = [
          {
            label: 'Stake',
            value: `${totalValue.toString()} SOL`,
          },
          {
            label: 'Pending',
            value: `${tempPendingAmount?.toString()} SOL`,
          },
        ];
        const epochInfo = await SolanaChain().getEpochTime();
        if (epochInfo) {
          info.push({
            label: 'Epoch ends in',
            value: differentInCurrentTime(epochInfo),
          });
        }
        return info;
      } catch (e) {
        console.error('Error in get solana getStakingInfo', e);
        return [];
      }
    },
    getStakingValidators: async ({chain_name}) => {
      try {
        const stakingResponse = await getStakingByChain({chain_name});
        const validatorsResp = await StakeWiz.getListOfValidator();
        const stakingValidators = stakingResponse?.data;
        const allValidators = validatorsResp?.data;
        let finalValidatorDetails = [];
        for (let item of stakingValidators) {
          const foundValidator = allValidators.find(subItem => {
            return item?.vote_pub_key === subItem?.vote_identity;
          });
          if (foundValidator) {
            finalValidatorDetails.push({
              ...foundValidator,
              validatorAddress: foundValidator?.vote_identity,
              image: foundValidator?.image,
              name: foundValidator?.name,
              apy_estimate: foundValidator?.apy_estimate,
              activated_stake: foundValidator?.activated_stake,
            });
          }
        }
        return {validators: finalValidatorDetails};
      } catch (e) {
        console.error('Error in get solana getStakingInfo', e);
        return [];
      }
    },
    getContract: async ({contractAddress}) => {
      try {
        const contractData = await getSolanaContract(contractAddress);
        const contract = Array.isArray(contractData?.data)
          ? contractData?.data[0]
          : null;
        if (
          contract &&
          contract?.chainId === config?.SOLANA_RPC_CONTRACT_CHAIN_ID
        ) {
          return {
            name: contract?.name,
            symbol: contract?.symbol,
            decimals: contract?.decimals,
            icon: contract?.logoURI,
          };
        }
        return {};
      } catch (e) {
        console.error(`error getting contract for solana ${e}`);
        return {};
      }
    },
    getBalance: async ({address}) =>
      retryFunc(async solanaProvider => {
        try {
          const publicKey = new PublicKey(address);
          const balance = await solanaProvider.getBalance(publicKey);
          return balance.toString();
        } catch (e) {
          console.error('error in get balance from solana', e);
          throw e;
        }
      }, '0'),
    getStakingBalance: async ({address}) =>
      retryFunc(
        async solanaProvider => {
          try {
            const publicKey = new PublicKey(address);
            const stakeAccounts = await solanaProvider.getParsedProgramAccounts(
              StakeProgram.programId,
              {
                filters: [
                  {
                    dataSize: 200,
                  },
                  {
                    memcmp: {
                      offset: 12,
                      bytes: publicKey.toBase58(),
                    },
                  },
                ],
              },
            );
            let totalStakedBalance = new BigNumber(0);
            for (let stakeAccount of stakeAccounts) {
              let accountInfo = stakeAccount.account.data.parsed.info;
              const lamports = new BigNumber(
                accountInfo?.stake?.delegation?.stake,
              ).plus(new BigNumber(accountInfo?.meta?.rentExemptReserve));
              totalStakedBalance = totalStakedBalance.plus(lamports);
            }
            return {stakingBalance: totalStakedBalance.toString() || '0'};
          } catch (e) {
            console.error('error in get getStakingBalance from solana', e);
            throw e;
          }
        },
        {
          stakingBalance: '0',
        },
      ),
    getEstimateFeeForToken: async ({
      fromAddress,
      toAddress,
      contractAddress,
      amount,
      decimals,
      tokenAmount,
      mint,
      privateKey,
      memo,
    }) =>
      retryFunc(async solanaProvider => {
        try {
          const transactionMessage = await prepareTokenTransferMessage({
            toAddress,
            contractAddress,
            amount,
            decimals,
            tokenAmount,
            mint,
            memo,
            privateKey,
            solanaProvider: solanaProvider,
          });
          const fromAddressPublicKey = new PublicKey(fromAddress);
          const {totalFee, gasFee, unit} = await getTotalEstimateFees(
            fromAddressPublicKey,
            transactionMessage,
            solanaProvider,
          );
          return {
            fee: totalFee,
            gasFee: gasFee,
            estimateGas: unit,
          };
        } catch (e) {
          console.error('error in get token fees for solana', e);
          throw e;
        }
      }, null),
    getEstimateFeeForNFT: async props => {
      return await SolanaChain().getEstimateFeeForToken(props);
    },
    getEstimateFee: async ({fromAddress, toAddress, amount, memo}) =>
      retryFunc(async solanaProvider => {
        try {
          const transactionMessage = await prepareTransferMessage({
            fromAddress,
            toAddress,
            amount,
            memo,
            solanaProvider,
          });
          const {totalFee, gasFee, unit} = await getTotalEstimateFees(
            fromAddress,
            transactionMessage,
            solanaProvider,
          );
          return {
            fee: totalFee,
            gasFee,
            estimateGas: unit,
          };
        } catch (e) {
          console.error('Error in solana gas fee', e);
          throw e;
        }
      }, null),
    getEstimateFeeForStaking: async ({fromAddress, amount, validatorPubKey}) =>
      retryFunc(async solanaProvider => {
        try {
          const fromAddressPublicKey = new PublicKey(fromAddress);
          const transactionMessage = await prepareCreateStaking({
            from: fromAddress,
            validatorPubKey,
            amount,
            solanaProvider,
          });
          const {totalFee, gasFee, unit} = await getTotalEstimateFees(
            fromAddressPublicKey,
            transactionMessage,
            solanaProvider,
          );
          return {
            fee: totalFee,
            gasFee: gasFee,
            estimateGas: unit,
          };
        } catch (e) {
          console.error('Error in solana getEstimateFeeForStaking', e);
          throw e;
        }
      }, null),
    getEstimateFeeForDeactivateStaking: async ({fromAddress, stakingAddress}) =>
      retryFunc(async solanaProvider => {
        try {
          const fromAddressPublicKey = new PublicKey(fromAddress);
          const tx = await buildStakingDeactivateTransaction(
            solanaProvider,
            stakingAddress,
            fromAddress,
          );
          const {totalFee, gasFee, unit} = await getTotalEstimateFees(
            fromAddressPublicKey,
            tx,
            solanaProvider,
          );
          return {
            fee: totalFee,
            gasFee: gasFee,
            estimateGas: unit,
          };
        } catch (e) {
          console.error(
            'Error in solana getEstimateFeeForDeactivateStaking',
            e,
          );
          throw e;
        }
      }, null),
    getEstimateFeeForWithdrawStaking: async ({
      fromAddress,
      amount,
      stakingAddress,
    }) =>
      retryFunc(async solanaProvider => {
        const fromAddressPublicKey = new PublicKey(fromAddress);
        try {
          const tx = await buildStakingWithdrawTransaction(
            solanaProvider,
            stakingAddress,
            fromAddress,
            amount,
          );
          const {totalFee, gasFee, unit} = await getTotalEstimateFees(
            fromAddressPublicKey,
            tx,
            solanaProvider,
          );
          return {
            fee: totalFee,
            gasFee: gasFee,
            estimateGas: unit,
          };
        } catch (e) {
          console.error('Error in solana getEstimateFeeForWithdrawStaking', e);
          throw e;
        }
      }, null),
    getTokenBalance: async ({address, contractAddress}) =>
      retryFunc(async solanaProvider => {
        try {
          const publicKey = new PublicKey(address);
          const contractAddressKey = new PublicKey(contractAddress);
          const data = await solanaProvider.getParsedTokenAccountsByOwner(
            publicKey,
            {
              mint: contractAddressKey,
            },
          );
          return data?.value[0]?.account?.data?.parsed?.info?.tokenAmount
            ?.amount;
        } catch (e) {
          console.error(`error getting token balance for solana ${e}`);
          throw e;
        }
      }, '0'),
    getTransactions: async ({address}) =>
      retryFunc(async solanaProvider => {
        try {
          const pubKey = new PublicKey(address);
          let transactionList = await solanaProvider.getSignaturesForAddress(
            pubKey,
            {limit: 20},
          );
          let signatureList = transactionList.map(
            transaction => transaction.signature,
          );
          let transactionData = await solanaProvider.getParsedTransactions(
            signatureList,
            {
              maxSupportedTransactionVersion: 0,
            },
          );
          if (Array.isArray(transactionData)) {
            let finalData = [];
            transactionData.forEach(item => {
              const transactionDetails =
                item?.transaction?.message?.instructions[0]?.parsed?.info;
              if (transactionDetails?.lamports?.toString()) {
                const bnValue = transactionDetails?.lamports?.toString() || 0;
                const txHash = item?.transaction?.signatures[0];
                finalData.push({
                  amount: bnValue?.toString(),
                  link: txHash.substring(0, 13) + '...',
                  url: `${config.SOLANA_SCAN_URL}/tx/${txHash}${
                    IS_SANDBOX ? '?cluster=devnet' : ''
                  }`,
                  status: 'SUCCESS',
                  date: item?.blockTime * 1000, //new Date(transaction.raw_data.timestamp),
                  from: transactionDetails?.source,
                  to: transactionDetails?.destination,
                  totalCourse: '0$',
                });
              }
            });
            return finalData;
          }
          return [];
        } catch (e) {
          console.error(`error getting transactions for solana ${e}`);
          throw e;
        }
      }, []),

    getTokenTransactions: ({address, contractAddress}) =>
      retryFunc(async solanaProvider => {
        try {
          const pubKey = new PublicKey(address);
          const tokenMintAddress = new PublicKey(contractAddress);
          const tokenAccounts = await solanaProvider.getTokenAccountsByOwner(
            pubKey,
            {
              mint: tokenMintAddress,
            },
          );
          const tokenAccount = tokenAccounts.value[0].pubkey;
          let transactionList = await solanaProvider.getSignaturesForAddress(
            tokenAccount,
            {limit: 20},
          );
          let signatureList = transactionList.map(
            transaction => transaction.signature,
          );
          let transactionData = await solanaProvider.getParsedTransactions(
            signatureList,
            {
              maxSupportedTransactionVersion: 0,
            },
          );
          if (Array.isArray(transactionData)) {
            let finalData = [];
            transactionData.forEach(item => {
              const instructions = item?.transaction?.message?.instructions;
              const transactionDetails = instructions?.find(subItem => {
                return (
                  subItem?.parsed?.type === 'transferChecked' ||
                  subItem?.parsed?.type === 'transfer'
                );
              })?.parsed?.info;
              const amount =
                transactionDetails?.amount?.toString() ||
                transactionDetails?.tokenAmount?.amount?.toString();
              if (amount) {
                const bnValue = amount;
                const txHash = item?.transaction?.signatures[0];
                const isSender = transactionDetails?.authority === address;
                const isReceiver =
                  transactionDetails?.destination === tokenAccount.toString();
                finalData.push({
                  amount: bnValue?.toString(),
                  link: txHash.substring(0, 13) + '...',
                  url: `${config.SOLANA_SCAN_URL}/tx/${txHash}${
                    IS_SANDBOX ? '?cluster=devnet' : ''
                  }`,
                  status: 'SUCCESS',
                  date: item?.blockTime * 1000, //new Date(transaction.raw_data.timestamp),
                  from: isSender ? address : transactionDetails?.source,
                  to: isReceiver ? address : transactionDetails?.destination,
                  totalCourse: '0$',
                });
              }
            });
            return finalData;
          }
          return [];
        } catch (e) {
          console.error(`error getting token transactions for solana ${e}`);
          throw e;
        }
      }, []),
    send: async ({to, from, amount, privateKey, memo, gasFee, estimateGas}) =>
      retryFunc(
        async solanaProvider => {
          try {
            const transactionMessage = await prepareTransferMessage({
              fromAddress: from,
              toAddress: to,
              amount,
              memo,
              solanaProvider,
              gasFee,
              estimateGas,
            });
            return await sendTransaction({
              transactionMessage,
              privateKey,
              solanaProvider,
            });
          } catch (e) {
            console.error('Error in send solana transaction', e);
            throw e;
          }
        },
        null,
        true,
      ),
    createStaking: async ({
      validatorPubKey,
      from,
      amount,
      privateKey,
      gasFee,
      estimateGas,
    }) =>
      retryFunc(
        async solanaProvider => {
          try {
            const transactionMessage = await prepareCreateStaking({
              from,
              validatorPubKey,
              amount,
              solanaProvider,
              gasFee,
              estimateGas,
            });
            return await sendTransaction({
              transactionMessage,
              privateKey,
              solanaProvider,
            });
          } catch (e) {
            console.error('Error in create solana staking', e);
            throw e;
          }
        },
        null,
        true,
      ),
    deactivateStaking: async ({
      from,
      stakingAddress,
      privateKey,
      gasFee,
      estimateGas,
    }) =>
      retryFunc(
        async solanaProvider => {
          try {
            const tx = await buildStakingDeactivateTransaction(
              solanaProvider,
              stakingAddress,
              from,
              gasFee,
              estimateGas,
            );
            return await sendTransaction({
              transactionMessage: tx,
              privateKey,
              solanaProvider,
            });
          } catch (e) {
            console.error('Error in solana deactivateStaking', e);
            throw e;
          }
        },
        null,
        true,
      ),
    withdrawStaking: async ({
      from,
      amount,
      stakingAddress,
      privateKey,
      gasFee,
      estimateGas,
    }) =>
      retryFunc(
        async solanaProvider => {
          try {
            const tx = await buildStakingWithdrawTransaction(
              solanaProvider,
              stakingAddress,
              from,
              amount,
              gasFee,
              estimateGas,
            );
            return await sendTransaction({
              transactionMessage: tx,
              privateKey,
              solanaProvider,
            });
          } catch (e) {
            console.error('Error in solana withdrawStaking', e);
            throw e;
          }
        },
        null,
        true,
      ),
    sendToken: async ({
      to,
      amount,
      tokenAmount,
      privateKey,
      contractAddress,
      decimal,
      mint,
      memo,
      gasFee,
      estimateGas,
    }) =>
      retryFunc(
        async solanaProvider => {
          try {
            const transactionMessage = await prepareTokenTransferMessage({
              toAddress: to,
              contractAddress,
              amount,
              decimals: decimal,
              tokenAmount,
              mint,
              memo,
              solanaProvider: solanaProvider,
              privateKey,
              estimateGas,
              gasFee,
            });
            return await sendTransaction({
              transactionMessage,
              privateKey,
              solanaProvider,
            });
          } catch (e) {
            console.error('Error in send solana token transaction', e);
            throw e;
          }
        },
        null,
        true,
      ),
    sendNFT: async props => {
      return await SolanaChain().sendToken(props);
    },

    waitForConfirmation: async ({transaction, interval = 3000, retries = 5}) =>
      retryFunc(async solanaProvider => {
        const transactionID = transaction;
        if (!transactionID) {
          console.error('No transaction id found for solana');
          return null;
        }
        return new Promise((resolve, reject) => {
          let numberOfRetries = 0;
          let timer = setInterval(async () => {
            try {
              numberOfRetries += 1;
              const response = await solanaProvider.getParsedTransaction(
                transactionID,
                {
                  maxSupportedTransactionVersion: 0,
                  commitment: 'finalized',
                },
              );
              if (response) {
                clearInterval(timer);
                if (
                  response?.meta?.status === 'Ok' ||
                  response?.meta?.err === null
                ) {
                  resolve(response);
                } else {
                  console.error(
                    'Error in get confirm tranaction',
                    response?.meta?.err,
                  );
                  reject(response?.meta?.err);
                }
              } else if (numberOfRetries === retries) {
                clearInterval(timer);
                resolve('pending');
              }
            } catch (e) {
              clearInterval(timer);
              console.error('Error in get confirm tranaction', e);
              reject(e);
            }
          }, interval);
        });
      }, null),
    getEpochTime: async () =>
      retryFunc(async solanaProvider => {
        try {
          // Get the current slot

          // Get the epoch schedule
          let epochInfo = await solanaProvider.getEpochInfo();
          const startSlot = epochInfo?.absoluteSlot - epochInfo?.slotIndex;
          const startTime = await solanaProvider.getBlockTime(startSlot);
          if (!startTime) {
            return null;
          }
          const percentage =
            (epochInfo.slotIndex / epochInfo?.slotsInEpoch) * 100;
          const currentTime = Math.round(Date.now() / 1000);
          const startFrom = currentTime - startTime;
          const endTime = (startFrom * 100) / percentage;
          return Math.round(startTime + endTime) * 1000;
        } catch (e) {
          console.error('Error in getEpochTime', e);
          throw e;
        }
      }, null),
  };
};

async function safelyCreateOrGetAccount(
  solanaProvider,
  to,
  mintAddress,
  recipient,
) {
  return new Promise((resolve, reject) => {
    getOrCreateAssociatedTokenAccount(
      solanaProvider,
      to,
      mintAddress,
      recipient,
    )
      .then(resp => {
        return resolve(resp);
      })
      .catch(e => {
        if (e instanceof TokenAccountNotFoundError) {
          setTimeout(() => {
            getOrCreateAssociatedTokenAccount(
              solanaProvider,
              to,
              mintAddress,
              recipient,
            )
              .then(resp2 => {
                return resolve(resp2);
              })
              .catch(err => {
                return reject(err);
              });
          }, 10000);
        } else {
          return reject(e);
        }
      });
  });
}

const buildStakingWithdrawTransaction = async (
  solanaProvider,
  stakeAccount,
  fromAccount,
  amount,
  gasFee,
  estimateGas,
) => {
  const stakeAccountPubKey = new PublicKey(stakeAccount);
  const fromAccountPubKey = new PublicKey(fromAccount);
  const finalAmount = getDeductedAmountForFees(amount, gasFee, estimateGas);
  const withdrawTx = StakeProgram.withdraw({
    stakePubkey: stakeAccountPubKey,
    authorizedPubkey: fromAccountPubKey,
    toPubkey: fromAccountPubKey,
    lamports: Number(finalAmount), // Withdraw the full balance at the time of the transaction
  });
  const instructions = [];
  if (estimateGas) {
    instructions.push(getComputeUnit(estimateGas));
  }
  if (gasFee) {
    instructions.push(getComputePrice(gasFee));
  }
  const recentBlockhash = (await solanaProvider.getLatestBlockhash('finalized'))
    .blockhash;
  return new TransactionMessage({
    payerKey: fromAccountPubKey,
    recentBlockhash: recentBlockhash,
    instructions: [...instructions, ...withdrawTx.instructions],
  });
};

const buildStakingDeactivateTransaction = async (
  solanaProvider,
  stakeAccount,
  fromAccount,
  gasFee,
  estimateGas,
) => {
  const stakeAccountPubKey = new PublicKey(stakeAccount);
  const fromAccountPubKey = new PublicKey(fromAccount);
  const deactivateTx = StakeProgram.deactivate({
    stakePubkey: stakeAccountPubKey,
    authorizedPubkey: fromAccountPubKey,
  });
  const instructions = [];
  if (estimateGas) {
    instructions.push(getComputeUnit(estimateGas));
  }
  if (gasFee) {
    instructions.push(getComputePrice(gasFee));
  }

  const recentBlockhash = (await solanaProvider.getLatestBlockhash('finalized'))
    .blockhash;
  return new TransactionMessage({
    payerKey: fromAccountPubKey,
    recentBlockhash: recentBlockhash,
    instructions: [...instructions, ...deactivateTx.instructions],
  });
};

const getMemo = (fromAddressPubKey, memo) => {
  return new TransactionInstruction({
    keys: [{pubkey: fromAddressPubKey, isSigner: true, isWritable: true}],
    // eslint-disable-next-line no-undef
    data: Buffer.from(memo, 'utf-8'),
    programId: new PublicKey('MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr'),
  });
};

const getComputeUnit = units => {
  return ComputeBudgetProgram.setComputeUnitLimit({
    units: units, // Adjust this value as needed
  });
};

const getComputePrice = price => {
  return ComputeBudgetProgram.setComputeUnitPrice({
    microLamports: price, // Adjust this value as needed
  });
};

const prepareTokenTransferMessage = async ({
  toAddress,
  mint,
  solanaProvider,
  contractAddress,
  tokenAmount,
  amount,
  memo,
  decimals,
  privateKey,
  estimateGas,
  gasFee,
}) => {
  const secretKey = bs58.decode(privateKey);
  const fromKeypair = Keypair.fromSecretKey(secretKey, {
    skipValidation: true,
  });
  const recipient = new PublicKey(toAddress);
  let finalMint;
  if (!mint) {
    finalMint = await getMint(solanaProvider, new PublicKey(contractAddress));
  } else {
    finalMint = {
      address: new PublicKey(mint),
    };
  }
  // Get the token account of the from address, and if it does not exist, create it
  const fromTokenAccount = await safelyCreateOrGetAccount(
    solanaProvider,
    fromKeypair,
    finalMint.address,
    fromKeypair.publicKey,
  );
  // Get the token account of the recipient address, and if it does not exist, create it
  const recipientTokenAccount = await safelyCreateOrGetAccount(
    solanaProvider,
    fromKeypair,
    finalMint.address,
    recipient,
  );
  const finalAmount = tokenAmount
    ? Number(tokenAmount)
    : convertToSmallAmount(amount, decimals);
  const instructions = [
    createTransferInstruction(
      fromTokenAccount.address,
      recipientTokenAccount.address,
      fromKeypair.publicKey,
      BigInt(finalAmount),
    ),
  ];
  if (isValidStringWithValue(memo)) {
    instructions.push(getMemo(fromKeypair.publicKey, memo));
  }
  if (estimateGas) {
    instructions.push(getComputeUnit(estimateGas));
  }
  if (gasFee) {
    instructions.push(getComputePrice(gasFee));
  }
  const recentBlockHash = await solanaProvider.getLatestBlockhash('finalized');
  return new TransactionMessage({
    payerKey: fromKeypair.publicKey,
    recentBlockhash: recentBlockHash.blockhash,
    instructions,
  });
};

const prepareTransferMessage = async ({
  toAddress,
  fromAddress,
  amount,
  solanaProvider,
  memo,
  gasFee,
  estimateGas,
}) => {
  const recipient = new PublicKey(toAddress);
  const fromAddressPubKey = new PublicKey(fromAddress);
  const instructions = [];
  if (gasFee) {
    instructions.push(getComputePrice(gasFee));
  }
  if (estimateGas) {
    instructions.push(getComputeUnit(estimateGas));
  }
  if (isValidStringWithValue(memo)) {
    instructions.push(getMemo(fromAddressPubKey, memo));
  }
  const finalAmount = getDeductedAmountForFees(amount, gasFee, estimateGas);
  instructions.push(
    SystemProgram.transfer({
      fromPubkey: fromAddressPubKey,
      toPubkey: recipient,
      lamports: finalAmount,
    }),
  );
  const recentBlockHash = await solanaProvider.getLatestBlockhash('finalized');
  return new TransactionMessage({
    payerKey: fromAddressPubKey,
    recentBlockhash: recentBlockHash.blockhash,
    instructions,
  });
};

const prepareCreateStaking = async ({
  from,
  validatorPubKey,
  amount,
  solanaProvider,
  gasFee,
  estimateGas,
}) => {
  const fromAddressPubKey = new PublicKey(from);
  const voterPublicKey = new PublicKey(validatorPubKey);
  const programPublicKey = new PublicKey(
    'Stake11111111111111111111111111111111111111',
  );
  const seed = nanoid();
  const stakeAccountPubKey = await PublicKey.createWithSeed(
    fromAddressPubKey,
    seed,
    programPublicKey,
  );
  const finalAmount = getDeductedAmountForFees(amount, gasFee, estimateGas);
  const transactions = new Transaction();
  const createStakeAccountTx = StakeProgram.createAccountWithSeed({
    authorized: new Authorized(fromAddressPubKey, fromAddressPubKey), // Here we set two authorities: Stake Authority and Withdrawal Authority. Both are set to our wallet.
    fromPubkey: fromAddressPubKey,
    lamports: Number(finalAmount),
    stakePubkey: stakeAccountPubKey,
    basePubkey: fromAddressPubKey,
    seed: seed,
  });
  createStakeAccountTx.feePayer = fromAddressPubKey;
  transactions.add(createStakeAccountTx);

  const delegateTx = StakeProgram.delegate({
    stakePubkey: stakeAccountPubKey,
    authorizedPubkey: fromAddressPubKey,
    votePubkey: voterPublicKey,
  });
  transactions.add(delegateTx);
  const instructions = [];
  if (gasFee) {
    instructions.push(getComputePrice(gasFee));
  }
  if (estimateGas) {
    instructions.push(getComputeUnit(estimateGas));
  }

  const recentBlockHash = (await solanaProvider.getLatestBlockhash('finalized'))
    .blockhash;
  return new TransactionMessage({
    payerKey: fromAddressPubKey,
    recentBlockhash: recentBlockHash,
    instructions: [...instructions, ...transactions.instructions],
  });
};

const getPriorityFee = async (solanaProvider, fromAddressPubKey) => {
  const priorityFees = await solanaProvider.getRecentPrioritizationFees({
    lockedWritableAccounts: [fromAddressPubKey],
  });
  const nonZeroFees = priorityFees
    .map(feeObject => feeObject.prioritizationFee)
    .filter(fee => fee !== 0);
  // Calculate the average of the non-zero fees
  return nonZeroFees.length > 0
    ? Math.floor(
        nonZeroFees.reduce((acc, fee) => acc + fee, 0) / nonZeroFees.length,
      )
    : 5000;
};

const getDeductedAmountForFees = (amount, gasFee, estimateGas) => {
  const bnAmount = BigInt(convertToSmallAmount(amount?.toString(), 9));
  let finalAmount = bnAmount;
  if (!gasFee && !estimateGas) {
    finalAmount = finalAmount - defaultDeductionAmount;
    if (finalAmount < 0) {
      finalAmount = bnAmount;
    }
  }
  return finalAmount;
};
