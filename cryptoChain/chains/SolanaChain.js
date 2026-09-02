import {config} from 'dok-wallet-blockchain-networks/config/config';
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
  createAssociatedTokenAccountInstruction,
  createTransferInstruction,
  getAssociatedTokenAddress,
  getMint,
  ACCOUNT_SIZE,
} from '@solana/spl-token';

import {
  convertToSmallAmount,
  customFetchWithTimeout,
  differentInCurrentTime,
  getExplorerTxUrl,
  isSwapBlockingError,
  isValidStringWithValue,
  parseBalance,
  SWAP_QUOTE_EXPIRED_ERROR,
} from 'dok-wallet-blockchain-networks/helper';
import bs58 from 'bs58';
import {Buffer} from 'buffer';
import nacl from 'tweetnacl';
import {getSolanaContract} from 'dok-wallet-blockchain-networks/service/solflare';
import {nanoid} from 'nanoid';
import {
  getFreeRPCUrl,
  getPremiumRPCUrl,
} from 'dok-wallet-blockchain-networks/rpcUrls/rpcUrls';
import {withRpcSessionFetch} from 'dok-wallet-blockchain-networks/rpcUrls/rpcSession';
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

// Normalizes the backend's SVM swapData into an ordered list of executable
// payloads: LI.FI sends one base64-serialized VersionedTransaction under
// `data`; Relay sends an instruction bundle ({instructions,
// addressLookupTableAddresses}), or several of them under `svmTransactions`.
const getSvmExecutables = swapData => {
  if (Array.isArray(swapData?.svmTransactions)) {
    return swapData.svmTransactions;
  }
  return [swapData];
};

const isHexString = value =>
  /^[0-9a-fA-F]+$/.test(value) && !(value.length % 2);

// Relay instruction data is plain hex (verified live); tolerate an 0x prefix
// and fall back to base64 for any future provider variant.
const decodeInstructionData = data => {
  const raw = String(data || '').replace(/^0x/, '');
  if (raw === '') {
    return Buffer.alloc(0);
  }
  if (isHexString(raw)) {
    return Buffer.from(raw, 'hex');
  }
  return Buffer.from(raw, 'base64');
};

// Builds a signable VersionedTransaction from one SVM executable.
// - base64 payloads already contain compute-budget instructions and a
//   blockhash from quote time; when no third-party signature is present the
//   blockhash is refreshed so the transaction can't expire in the sheet →
//   confirm → send window. A partially-signed transaction must be sent
//   byte-identical, so it is left untouched.
// - instruction bundles are compiled against the wallet as payer with a
//   fresh blockhash and the route's address-lookup tables.
// Returns {transaction, lastValidBlockHeight}. lastValidBlockHeight is the
// hard deadline after which the transaction can provably never land — the
// only condition under which a caller may safely rebuild after a broadcast
// attempt. It is null for co-signed payloads whose quote-time blockhash we
// cannot refresh (their deadline is unknown to us).
const buildSwapVersionedTransaction = async (
  executable,
  fromAddress,
  solanaProvider,
) => {
  if (executable?.data) {
    const transaction = VersionedTransaction.deserialize(
      Buffer.from(executable.data, 'base64'),
    );
    const hasForeignSignature = transaction.signatures?.some(signature =>
      signature?.some?.(byte => byte !== 0),
    );
    let lastValidBlockHeight = null;
    if (!hasForeignSignature) {
      const latest = await solanaProvider.getLatestBlockhash();
      transaction.message.recentBlockhash = latest.blockhash;
      lastValidBlockHeight = latest.lastValidBlockHeight;
    }
    return {transaction, lastValidBlockHeight};
  }
  if (Array.isArray(executable?.instructions)) {
    const instructions = executable.instructions.map(
      instruction =>
        new TransactionInstruction({
          programId: new PublicKey(instruction.programId),
          keys: (instruction.keys || []).map(key => ({
            pubkey: new PublicKey(key.pubkey),
            isSigner: !!key.isSigner,
            isWritable: !!key.isWritable,
          })),
          data: decodeInstructionData(instruction.data),
        }),
    );
    const lookupTables = [];
    for (const tableAddress of executable.addressLookupTableAddresses || []) {
      const table = await solanaProvider.getAddressLookupTable(
        new PublicKey(tableAddress),
      );
      if (table?.value) {
        lookupTables.push(table.value);
      }
    }
    const latest = await solanaProvider.getLatestBlockhash();
    const message = new TransactionMessage({
      payerKey: new PublicKey(fromAddress),
      recentBlockhash: latest.blockhash,
      instructions,
    }).compileToV0Message(lookupTables);
    return {
      transaction: new VersionedTransaction(message),
      lastValidBlockHeight: latest.lastValidBlockHeight,
    };
  }
  throw new Error('Unsupported Solana swap payload');
};

const COMPUTE_BUDGET_PROGRAM_ID = 'ComputeBudget111111111111111111111111111111';

// Reads the compute budget the provider baked into the transaction so the
// fee estimate covers the priority fee, not just the base signature fee.
// Instruction layout: [2, u32 units] = setComputeUnitLimit,
// [3, u64 microLamports] = setComputeUnitPrice.
const readComputeBudget = message => {
  let units = 0;
  let microLamports = 0;
  try {
    const staticKeys = message.staticAccountKeys || [];
    for (const instruction of message.compiledInstructions || []) {
      const programId = staticKeys[instruction.programIdIndex];
      if (programId?.toString() !== COMPUTE_BUDGET_PROGRAM_ID) {
        continue;
      }
      const data = Buffer.from(instruction.data);
      if (data[0] === 2 && data.length >= 5) {
        units = data.readUInt32LE(1);
      } else if (data[0] === 3 && data.length >= 9) {
        microLamports = Number(data.readBigUInt64LE(1));
      }
    }
  } catch (e) {
    console.log('Error reading Solana compute budget', e);
  }
  return {units, microLamports};
};

export const SolanaChain = () => {
  const retryFunc = async (cb, defaultResponse) => {
    const rpcs = [
      getPremiumRPCUrl('solana'),
      ...getFreeRPCUrl('solana'),
    ].filter(Boolean);
    for (let i = 0; i < rpcs.length; i++) {
      try {
        const solanaProvider = new Connection(rpcs[i], {
          fetch: withRpcSessionFetch(customFetchWithTimeout),
        });
        return await cb(solanaProvider);
      } catch (e) {
        console.log('Error for solana rpc', rpcs[i], 'Errors:', e);
        if (isSwapBlockingError(e?.message)) {
          // A leg-0 simulation failure is deterministic — retrying on the
          // next RPC repeats it, and a later RPC's transport error would
          // replace the message sendFunds keys on.
          throw e;
        }
        if (i === rpcs.length - 1) {
          if (defaultResponse === undefined) {
            throw e;
          } else {
            return defaultResponse;
          }
        }
      }
    }
  };

  const getTotalEstimateFees = async (
    fromAddress,
    transactionMessage,
    solanaProvider,
    needATA,
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
    let rentExemptAmount = 0;
    if (needATA) {
      rentExemptAmount = await solanaProvider.getMinimumBalanceForRentExemption(
        ACCOUNT_SIZE,
      );
    }
    const totalFee = extraFees + resp.value + rentExemptAmount;

    const totalFeeStr = parseBalance(totalFee, 9);
    return {
      totalFee: totalFeeStr,
      unit: units,
      gasFee: gasFee,
    };
  };

  // ---- Broadcast idempotency layer -----------------------------------
  // Solana's nonce-equivalent is the signature over fixed bytes: once a
  // transaction is signed, re-broadcasting the SAME serialized bytes can
  // never land twice (the cluster dedupes the signature while its blockhash
  // is valid, and after lastValidBlockHeight it can never land at all).
  // Everything state-changing below therefore signs exactly once and only
  // ever retries the broadcast of those bytes — never a rebuild, which
  // would refresh the blockhash, change the signature and double-spend.

  // Sends the SAME bytes to every transaction RPC in turn. "Already
  // processed" from a node that saw a previous attempt is success.
  const broadcastRawTransaction = async ({serializedTx, signature}) => {
    const rpcs = [
      getPremiumRPCUrl('solana'),
      ...getFreeRPCUrl('solana'),
    ].filter(Boolean);
    let lastError = null;
    for (let i = 0; i < rpcs.length; i++) {
      try {
        const solanaProvider = new Connection(rpcs[i], {
          fetch: withRpcSessionFetch(customFetchWithTimeout),
        });
        await solanaProvider.sendRawTransaction(serializedTx, {
          skipPreflight: true,
          preflightCommitment: 'processed',
        });
        return signature;
      } catch (e) {
        if (`${e?.message || ''}`.includes('already been processed')) {
          // A previous attempt landed (or reached the node via gossip).
          return signature;
        }
        console.log('Error broadcasting solana tx on rpc', rpcs[i], e);
        lastError = e;
      }
    }
    throw lastError ?? new Error('Failed to broadcast Solana transaction');
  };

  // Read-only status probe; a total RPC outage resolves to undefined so it
  // reads as "unknown" rather than throwing (the caller decides what to do).
  const getSignatureStatus = async signature => {
    try {
      return await retryFunc(async solanaProvider => {
        const resp = await solanaProvider.getSignatureStatuses([signature], {
          searchTransactionHistory: true,
        });
        return resp?.value?.[0] ?? null;
      });
    } catch (e) {
      // Every status RPC failed: unknown, which is not evidence of expiry.
      console.error('Error fetching solana signature status', e);
      return undefined;
    }
  };

  // Polls a signature until it reaches the commitment. Never rebuilds:
  // resolves 'confirmed' when landed, throws when the transaction failed
  // on-chain, resolves 'expired' when the blockhash provably died without
  // the signature landing (the only state in which a rebuild is safe), and
  // resolves 'pending' when the bounded poll ran out without a verdict.
  //
  // The 'expired' verdict authorizes a re-send, so it demands hard evidence:
  // an RPC must have POSITIVELY answered "signature unknown" (null — an
  // undefined status means every status RPC errored and proves nothing),
  // the cluster height must be past lastValidBlockHeight with a margin that
  // absorbs RPC lag, and both must hold on two consecutive polls.
  const EXPIRY_MARGIN_BLOCKS = 15;
  const confirmSignature = async ({
    signature,
    lastValidBlockHeight,
    commitment = 'confirmed',
    interval = 3000,
    maxAttempts = 20,
  }) => {
    const okStatuses =
      commitment === 'finalized' ? ['finalized'] : ['confirmed', 'finalized'];
    let expiredEvidence = 0;
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const status = await getSignatureStatus(signature);
      if (status?.err) {
        throw new Error(
          `Solana transaction failed on-chain: ${JSON.stringify(status.err)}`,
        );
      }
      if (status && okStatuses.includes(status.confirmationStatus)) {
        return 'confirmed';
      }
      if (status === null && lastValidBlockHeight) {
        let blockHeight;
        try {
          blockHeight = await retryFunc(async solanaProvider =>
            solanaProvider.getBlockHeight('confirmed'),
          );
        } catch (e) {
          // Unknown height proves nothing; the check below stays inconclusive.
          console.error('Error fetching solana block height', e);
        }
        if (
          typeof blockHeight === 'number' &&
          blockHeight > lastValidBlockHeight + EXPIRY_MARGIN_BLOCKS
        ) {
          expiredEvidence += 1;
          if (expiredEvidence >= 2) {
            return 'expired';
          }
        } else {
          expiredEvidence = 0;
        }
      } else {
        // Unknown status (all status RPCs failed) is not evidence of expiry.
        expiredEvidence = 0;
      }
      await new Promise(resolve => setTimeout(resolve, interval));
    }
    return 'pending';
  };

  // Sign once, then broadcast idempotently. Replaces the old pattern of
  // signing inside the per-RPC retry callback, where each retry re-signed
  // with a fresh blockhash and could double-send.
  const signAndBroadcastMessage = async ({transactionMessage, privateKey}) => {
    const secretKey = bs58.decode(privateKey);
    const fromKeypair = Keypair.fromSecretKey(secretKey, {
      skipValidation: true,
    });
    const transaction = new VersionedTransaction(
      transactionMessage.compileToV0Message(),
    );
    transaction.sign([fromKeypair]);
    const signature = bs58.encode(transaction.signatures[0]);
    return await broadcastRawTransaction({
      serializedTx: transaction.serialize(),
      signature,
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
    signRawTransaction: async ({payload, privateKey}) => {
      try {
        const finalPayload = payload?.signTypeData?.transaction;
        const secretKey = bs58.decode(privateKey);
        const keypair = Keypair.fromSecretKey(secretKey, {
          skipValidation: true,
        });

        const txBuffer = Buffer.from(finalPayload, 'base64');
        const versionedTransaction = VersionedTransaction.deserialize(txBuffer);
        versionedTransaction.sign([keypair]);
        const primarySigPubkeyPair = versionedTransaction.signatures[0];
        if (!primarySigPubkeyPair) {
          throw new Error('Missing signature');
        }
        const signature = bs58.encode(primarySigPubkeyPair);
        return {signature};
      } catch (e) {
        console.error('Error in solana signRawTransaction', e);
        throw e;
      }
    },
    // solana_signAllTransactions: sign each base64 VersionedTransaction and
    // return the signed transactions base64-encoded, in the order received.
    signAllTransactions: async ({payload, privateKey}) => {
      try {
        const transactions = payload?.signTypeData?.transactions;
        if (!Array.isArray(transactions) || !transactions.length) {
          throw new Error('No transactions to sign');
        }
        const secretKey = bs58.decode(privateKey);
        const keypair = Keypair.fromSecretKey(secretKey, {
          skipValidation: true,
        });
        const signed = transactions.map(tx => {
          const versionedTransaction = VersionedTransaction.deserialize(
            Buffer.from(tx, 'base64'),
          );
          versionedTransaction.sign([keypair]);
          return Buffer.from(versionedTransaction.serialize()).toString(
            'base64',
          );
        });
        return {transactions: signed};
      } catch (e) {
        console.error('Error in solana signAllTransactions', e);
        throw e;
      }
    },
    sendRawTransaction: async ({payload, privateKey}) =>
      retryFunc(async solanaProvider => {
        try {
          const finalPayload = payload?.signTypeData?.transaction;
          const secretKey = bs58.decode(privateKey);
          const keypair = Keypair.fromSecretKey(secretKey, {
            skipValidation: true,
          });

          const txBuffer = Buffer.from(finalPayload, 'base64');
          const versionedTransaction =
            VersionedTransaction.deserialize(txBuffer);
          const finalTransaction = new VersionedTransaction(
            versionedTransaction.message,
          );
          finalTransaction.sign([keypair]);
          const txHash = await solanaProvider.sendTransaction(
            finalTransaction,
            {
              skipPreflight: true,
              preflightCommitment: 'processed',
            },
          );
          return {signature: txHash};
        } catch (e) {
          console.error('Error in solana signAndSendTransaction', e);
          throw e;
        }
      }),
    signMessage: async ({signTypeData, privateKey}) => {
      try {
        const message = signTypeData;
        const secretKey = bs58.decode(privateKey);
        const from = Keypair.fromSecretKey(secretKey, {
          skipValidation: true,
        });
        const signature = nacl.sign.detached(
          bs58.decode(message),
          from.secretKey,
        );
        const bs58Signature = bs58.encode(signature);
        return {signature: bs58Signature};
      } catch (e) {
        console.error('Error in solana signMessage', e);
        throw e;
      }
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
        // Minimum amount the user must stake = network minimum delegation +
        // rent-exempt reserve (the entered amount funds the whole stake account
        // and the delegatable stake = amount - rentExemptReserve must be >=
        // minimum delegation). An RPC failure throws out of retryFunc and the
        // catch below falls back to a 1 SOL minimum.
        let minAmount = null;
        try {
          minAmount = await retryFunc(async solanaProvider => {
            const [minDelegationResp, rentExemptReserve] = await Promise.all([
              solanaProvider.getStakeMinimumDelegation(),
              solanaProvider.getMinimumBalanceForRentExemption(
                StakeProgram.space,
              ),
            ]);
            const minDelegation = minDelegationResp?.value;
            if (minDelegation == null) {
              return null;
            }
            const totalMinAmount = new BigNumber(minDelegation).plus(
              new BigNumber(rentExemptReserve),
            );
            return parseBalance(totalMinAmount.toString(), 9);
          });
        } catch (e) {
          minAmount = '1';
        }
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
              minAmount, // network-wide for Solana; per-validator-ready
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
          const {transactionMessage, needATA} =
            await prepareTokenTransferMessage({
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
            needATA,
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
      }),
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
      }),
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
      }),
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
      }),
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
      }),
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
              const instructions =
                item?.transaction?.message?.instructions || [];
              const txHash = item?.transaction?.signatures[0];

              const stakeInstruction = instructions.find(
                ix =>
                  ix?.program === 'stake' ||
                  ix?.programId?.toString() ===
                    'Stake11111111111111111111111111111111111111112',
              );

              if (stakeInstruction) {
                const stakeType = stakeInstruction?.parsed?.type;
                const info = stakeInstruction?.parsed?.info || {};
                let transactionType = 'stake';
                let amount = '0';
                let from = address;
                let to = address;

                if (stakeType === 'delegate' || stakeType === 'initialize') {
                  transactionType = 'stake';
                  from = info?.stakeAuthority || address;
                  to = info?.voteAccount || info?.stakeAccount || address;
                  const fundIx = instructions.find(
                    ix =>
                      ix?.parsed?.info?.lamports != null &&
                      ix?.program !== 'stake',
                  );
                  amount = fundIx?.parsed?.info?.lamports?.toString() || '0';
                } else if (stakeType === 'deactivate') {
                  transactionType = 'unstake';
                  from = info?.stakeAuthority || address;
                  to = info?.stakeAccount || address;
                  const accountKeys =
                    item?.transaction?.message?.accountKeys || [];
                  const stakeAccountIndex = accountKeys.findIndex(
                    key => key?.pubkey?.toString() === info?.stakeAccount,
                  );
                  if (stakeAccountIndex !== -1) {
                    amount =
                      item?.meta?.preBalances?.[
                        stakeAccountIndex
                      ]?.toString() || '0';
                  }
                } else if (stakeType === 'withdraw') {
                  transactionType = 'withdraw';
                  from = info?.stakeAccount || address;
                  to = info?.destination || address;
                  amount = info?.lamports?.toString() || '0';
                }

                finalData.push({
                  amount,
                  link: txHash,
                  url: getExplorerTxUrl('solana', txHash),
                  status: item?.meta?.err == null ? 'SUCCESS' : 'FAILED',
                  date: item?.blockTime * 1000,
                  from,
                  to,
                  totalCourse: '0$',
                  transactionType,
                  blockNumber: item?.slot,
                });
                return;
              }

              const transactionDetails = instructions.find(
                ix => ix?.parsed?.info?.lamports != null,
              )?.parsed?.info;
              if (transactionDetails?.lamports?.toString()) {
                const bnValue = transactionDetails?.lamports?.toString() || 0;
                finalData.push({
                  amount: bnValue?.toString(),
                  link: txHash,
                  url: getExplorerTxUrl('solana', txHash),
                  status: item?.meta?.err == null ? 'SUCCESS' : 'FAILED',
                  date: item?.blockTime * 1000,
                  from: transactionDetails?.source,
                  to: transactionDetails?.destination,
                  totalCourse: '0$',
                  transactionType: 'regular',
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
    getTransaction: async ({txHash, contractAddress}) =>
      retryFunc(
        async solanaProvider => {
          try {
            if (!txHash) return null;
            const item = await solanaProvider.getParsedTransaction(txHash, {
              maxSupportedTransactionVersion: 0,
            });
            if (!item) return {data: null};
            const instructions = item?.transaction?.message?.instructions || [];
            const blockNumber = item?.slot ?? null;

            const stakeInstruction = instructions.find(
              ix =>
                ix?.program === 'stake' ||
                ix?.programId?.toString() ===
                  'Stake11111111111111111111111111111111111111112',
            );

            if (stakeInstruction) {
              const stakeType = stakeInstruction?.parsed?.type;
              const info = stakeInstruction?.parsed?.info || {};
              let amount = '0';
              let from = null;
              let to = null;

              if (stakeType === 'delegate' || stakeType === 'initialize') {
                from = info?.stakeAuthority || null;
                to = info?.voteAccount || info?.stakeAccount || null;
                const fundIx = instructions.find(
                  ix =>
                    ix?.parsed?.info?.lamports != null &&
                    ix?.program !== 'stake',
                );
                amount = fundIx?.parsed?.info?.lamports?.toString() || '0';
              } else if (stakeType === 'deactivate') {
                from = info?.stakeAuthority || null;
                to = info?.stakeAccount || null;
                const accountKeys =
                  item?.transaction?.message?.accountKeys || [];
                const stakeAccountIndex = accountKeys.findIndex(
                  key => key?.pubkey?.toString() === info?.stakeAccount,
                );
                if (stakeAccountIndex !== -1) {
                  amount =
                    item?.meta?.preBalances?.[stakeAccountIndex]?.toString() ||
                    '0';
                }
              } else if (stakeType === 'withdraw') {
                from = info?.stakeAccount || null;
                to = info?.destination || null;
                amount = info?.lamports?.toString() || '0';
              }

              return {
                data: {
                  amount,
                  link: txHash,
                  url: getExplorerTxUrl('solana', txHash),
                  status: item?.meta?.err == null ? 'SUCCESS' : 'FAILED',
                  date: item?.blockTime * 1000,
                  from,
                  to,
                  totalCourse: '0',
                  blockNumber,
                },
              };
            }

            const transactionDetails = instructions.find(
              ix => ix?.parsed?.info?.lamports != null,
            )?.parsed?.info;
            // SPL token transfers carry no lamports — match the token
            // instruction the way getTokenTransactions does.
            const tokenDetails = instructions.find(
              ix =>
                (ix?.parsed?.type === 'transferChecked' ||
                  ix?.parsed?.type === 'transfer') &&
                (ix?.parsed?.info?.amount != null ||
                  ix?.parsed?.info?.tokenAmount?.amount != null),
            )?.parsed?.info;

            if (tokenDetails && (contractAddress || !transactionDetails)) {
              const tokenAmount =
                tokenDetails?.amount?.toString() ||
                tokenDetails?.tokenAmount?.amount?.toString();
              // source/destination are token accounts (ATAs); resolve the
              // recipient's wallet address from postTokenBalances.
              const accountKeys = item?.transaction?.message?.accountKeys || [];
              const destinationOwner = item?.meta?.postTokenBalances?.find(
                balance =>
                  accountKeys[balance?.accountIndex]?.pubkey?.toString() ===
                  tokenDetails?.destination,
              )?.owner;
              return {
                data: {
                  amount: tokenAmount,
                  link: txHash,
                  url: getExplorerTxUrl('solana', txHash),
                  status: item?.meta?.err == null ? 'SUCCESS' : 'FAILED',
                  date: item?.blockTime * 1000,
                  from:
                    tokenDetails?.authority ||
                    tokenDetails?.multisigAuthority ||
                    tokenDetails?.source,
                  to: destinationOwner || tokenDetails?.destination,
                  totalCourse: '0',
                  blockNumber,
                },
              };
            }

            if (!transactionDetails?.lamports?.toString()) return null;
            const bnValue = transactionDetails?.lamports?.toString() || 0;
            return {
              data: {
                amount: bnValue?.toString(),
                link: txHash,
                url: getExplorerTxUrl('solana', txHash),
                status: item?.meta?.err == null ? 'SUCCESS' : 'FAILED',
                date: item?.blockTime * 1000,
                from: transactionDetails?.source,
                to: transactionDetails?.destination,
                totalCourse: '0',
                blockNumber,
              },
            };
          } catch (e) {
            console.error(`error getting transaction for solana ${e}`);
            throw e;
          }
        },
        {data: null},
      ),

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
          const tokenAccount = tokenAccounts?.value?.[0]?.pubkey;
          if (!tokenAccount) {
            // no token account for this mint — no transaction history yet
            return [];
          }
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
                  link: txHash,
                  url: getExplorerTxUrl('solana', txHash),
                  status: item?.meta?.err == null ? 'SUCCESS' : 'FAILED',
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
    send: async ({to, from, amount, privateKey, memo, gasFee, estimateGas}) => {
      try {
        // Prepare (reads only) may retry across RPCs; sign+broadcast happens
        // exactly once outside the retry so no replay can re-sign.
        const transactionMessage = await retryFunc(async solanaProvider =>
          prepareTransferMessage({
            fromAddress: from,
            toAddress: to,
            amount,
            memo,
            solanaProvider,
            gasFee,
            estimateGas,
          }),
        );
        return await signAndBroadcastMessage({transactionMessage, privateKey});
      } catch (e) {
        console.error('Error in send solana transaction', e);
        throw e;
      }
    },
    createStaking: async ({
      validatorPubKey,
      from,
      amount,
      privateKey,
      gasFee,
      estimateGas,
    }) => {
      try {
        const transactionMessage = await retryFunc(async solanaProvider =>
          prepareCreateStaking({
            from,
            validatorPubKey,
            amount,
            solanaProvider,
            gasFee,
            estimateGas,
          }),
        );
        return await signAndBroadcastMessage({transactionMessage, privateKey});
      } catch (e) {
        console.error('Error in create solana staking', e);
        throw e;
      }
    },
    deactivateStaking: async ({
      from,
      stakingAddress,
      privateKey,
      gasFee,
      estimateGas,
    }) => {
      try {
        const transactionMessage = await retryFunc(async solanaProvider =>
          buildStakingDeactivateTransaction(
            solanaProvider,
            stakingAddress,
            from,
            gasFee,
            estimateGas,
          ),
        );
        return await signAndBroadcastMessage({transactionMessage, privateKey});
      } catch (e) {
        console.error('Error in solana deactivateStaking', e);
        throw e;
      }
    },
    withdrawStaking: async ({
      from,
      amount,
      stakingAddress,
      privateKey,
      gasFee,
      estimateGas,
    }) => {
      try {
        const transactionMessage = await retryFunc(async solanaProvider =>
          buildStakingWithdrawTransaction(
            solanaProvider,
            stakingAddress,
            from,
            amount,
            gasFee,
            estimateGas,
          ),
        );
        return await signAndBroadcastMessage({transactionMessage, privateKey});
      } catch (e) {
        console.error('Error in solana withdrawStaking', e);
        throw e;
      }
    },
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
    }) => {
      try {
        const {transactionMessage} = await retryFunc(async solanaProvider =>
          prepareTokenTransferMessage({
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
          }),
        );
        return await signAndBroadcastMessage({transactionMessage, privateKey});
      } catch (e) {
        console.error('Error in send solana token transaction', e);
        throw e;
      }
    },
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
                  resolve({
                    status: 'failed',
                    err: response?.meta?.err,
                  });
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
      }),
    // Executes a provider-built DEX swap (LI.FI / Relay). Solana needs no
    // allowance step — the whole route is instruction-bundled into the
    // transaction(s) signed here. Returns the last signature string (the
    // wrapper's getHashString expects the raw signature for solana).
    //
    // Idempotency contract: each leg is built and signed exactly once; only
    // the broadcast of those bytes retries across RPCs. A leg may be rebuilt
    // only when confirmSignature proves the original can never land
    // ('expired'), and then exactly once — the old shape (the whole loop
    // inside retryFunc) re-signed with a fresh blockhash on every transient
    // error and could execute a landed leg twice.
    swap: async ({swapData, from, privateKey}) => {
      const executables = getSvmExecutables(swapData);
      const secretKey = bs58.decode(privateKey);
      const keypair = Keypair.fromSecretKey(secretKey, {
        skipValidation: true,
      });

      const executeSwapLeg = async (legIndex, allowRebuild) => {
        // Prepare (reads only): build + simulate may retry across RPCs —
        // nothing has been broadcast yet, so replays here are harmless.
        const {transaction, lastValidBlockHeight} = await retryFunc(
          async solanaProvider => {
            const built = await buildSwapVersionedTransaction(
              executables[legIndex],
              from,
              solanaProvider,
            );
            // The send below skips preflight, so simulate here or an expired
            // route (stale minOut, or a co-signed transaction whose
            // quote-time blockhash can't be refreshed) burns the fee
            // on-chain. Only the first leg is a hard gate: once leg 0
            // landed, a later leg's simulation can fail spuriously against
            // RPC state that hasn't converged on the prior leg, and
            // throwing mid-route would strand the user's intermediate
            // tokens.
            const simulation = await solanaProvider.simulateTransaction(
              built.transaction,
              {commitment: 'confirmed'},
            );
            if (simulation?.value?.err) {
              console.error(
                'Solana swap simulation failed',
                JSON.stringify(simulation.value.err),
                simulation.value.logs?.slice(-5),
              );
              if (legIndex === 0) {
                throw new Error(SWAP_QUOTE_EXPIRED_ERROR);
              }
            }
            return built;
          },
        );
        // Sign ONCE. From here the signature is this leg's fixed identity —
        // no code below may rebuild or re-sign this transaction.
        transaction.sign([keypair]);
        const signature = bs58.encode(transaction.signatures[0]);
        await broadcastRawTransaction({
          serializedTx: transaction.serialize(),
          signature,
        });
        // Sequential routes must land in order — verify by signature status
        // before broadcasting the next transaction (never by rebuilding).
        if (legIndex < executables.length - 1) {
          const outcome = await confirmSignature({
            signature,
            lastValidBlockHeight,
          });
          if (outcome === 'expired' && allowRebuild) {
            // Provably never landed (blockhash died with no trace of the
            // signature) — the one case a rebuild cannot double-send.
            return await executeSwapLeg(legIndex, false);
          }
          if (outcome !== 'confirmed') {
            throw new Error(
              'Solana swap transaction was broadcast but its confirmation could not be verified. Check the transaction status before retrying.',
            );
          }
        }
        return signature;
      };

      let lastSignature = null;
      for (let i = 0; i < executables.length; i++) {
        lastSignature = await executeSwapLeg(i, true);
      }
      return lastSignature;
    },
    // Fee for a provider-built swap: base signature fee via getFeeForMessage
    // plus the priority fee the provider baked into its compute-budget
    // instructions. No user-adjustable knobs on Solana → null gas fields
    // (same contract as Tron transfers, which the transfer UI already
    // tolerates).
    getEstimateSwapFee: async ({swapData, fromAddress}) => {
      return await retryFunc(async solanaProvider => {
        const executables = getSvmExecutables(swapData);
        let totalLamports = 0;
        for (const executable of executables) {
          const {transaction} = await buildSwapVersionedTransaction(
            executable,
            fromAddress,
            solanaProvider,
          );
          const baseFee = await solanaProvider.getFeeForMessage(
            transaction.message,
          );
          const {units, microLamports} = readComputeBudget(transaction.message);
          totalLamports +=
            (baseFee?.value ?? 5000) +
            Math.ceil((units * microLamports) / 1000000);
        }
        return {
          fee: parseBalance(totalLamports, 9),
          gasFee: null,
          estimateGas: null,
          nonce: null,
        };
      });
    },
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
      }),
  };
};

async function getTokenAccount(
  solanaProvider,
  mintAddress,
  walletAddress,
  checkATA,
) {
  const tokenAddress = await getAssociatedTokenAddress(
    mintAddress,
    walletAddress,
  );
  if (checkATA) {
    const accountInfo = await solanaProvider.getAccountInfo(tokenAddress);
    return {tokenAddress, needATA: accountInfo === null};
  }
  return {tokenAddress, needATA: false};
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
  const {tokenAddress: fromTokenAccount} = await getTokenAccount(
    solanaProvider,
    finalMint.address,
    fromKeypair.publicKey,
  );
  // Get the token account of the recipient address, and if it does not exist, create it
  const {tokenAddress: recipientTokenAccount, needATA} = await getTokenAccount(
    solanaProvider,
    finalMint.address,
    recipient,
    true,
  );
  const finalAmount = tokenAmount
    ? Number(tokenAmount)
    : convertToSmallAmount(amount, decimals);
  const instructions = [
    createTransferInstruction(
      fromTokenAccount,
      recipientTokenAccount,
      fromKeypair.publicKey,
      BigInt(finalAmount),
    ),
  ];
  if (needATA) {
    instructions.unshift(
      createAssociatedTokenAccountInstruction(
        fromKeypair.publicKey, // payer
        recipientTokenAccount,
        recipient,
        finalMint.address,
      ),
    );
  }
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
  const transactionMessage = new TransactionMessage({
    payerKey: fromKeypair.publicKey,
    recentBlockhash: recentBlockHash.blockhash,
    instructions,
  });
  return {transactionMessage, needATA};
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
