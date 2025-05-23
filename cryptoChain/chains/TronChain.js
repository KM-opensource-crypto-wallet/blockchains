import {TronWeb} from 'tronweb';
import {getRPCUrl} from 'dok-wallet-blockchain-networks/rpcUrls/rpcUrls';
import {convertToSmallAmount} from 'dok-wallet-blockchain-networks/helper';
import {config, isWeb} from 'dok-wallet-blockchain-networks/config/config';
import BigNumber from 'bignumber.js';
import {TronScan} from 'dok-wallet-blockchain-networks/service/tronScan';
import dayjs from 'dayjs';

let accountInfo = {};
let lastCallTimeStamp;

const removeSubstringFromPrivateKey = privateKey => {
  return privateKey?.toLowerCase()?.startsWith('0x')
    ? privateKey?.substring(2)
    : privateKey;
};

export const TronChain = () => {
  const TRON_API_KEYS = [null];
  if (getRPCUrl('tron_api_key')) {
    TRON_API_KEYS.push(getRPCUrl('tron_api_key'));
  }
  if (getRPCUrl('tron_api_key_2')) {
    TRON_API_KEYS.push(getRPCUrl('tron_api_key_2'));
  }
  let defaultTronWeb = null;

  try {
    const options = {
      fullHost: getRPCUrl('tron_full_host'),
      solidityNode: getRPCUrl('tron_solidity_node'),
      eventServer: getRPCUrl('tron_event_server'),
    };
    defaultTronWeb = new TronWeb(options);
  } catch (e) {
    console.error(`error creating tronWeb ${e}`);
    throw e;
  }

  const retryFunc = async (cb, defaultResponse) => {
    for (let i = 0; i < TRON_API_KEYS.length; i++) {
      try {
        const options = {
          fullHost: getRPCUrl('tron_full_host'),
          solidityNode: getRPCUrl('tron_solidity_node'),
          eventServer: getRPCUrl('tron_event_server'),
        };
        const apiKey = TRON_API_KEYS[i];
        if (apiKey) {
          options['TRON-PRO-API-KEY'] = apiKey;
        }
        const tronWeb = new TronWeb(options);
        return await cb(tronWeb);
      } catch (e) {
        console.error('Error for tron ', i, 'Errors:', e);
        if (i === TRON_API_KEYS.length - 1) {
          if (defaultResponse) {
            return defaultResponse;
          } else {
            throw e;
          }
        }
      }
    }
  };

  const getAccount = async ({tronWeb, address}) => {
    if (
      accountInfo?.address !== tronWeb?.address.toHex(address) ||
      !lastCallTimeStamp ||
      dayjs().diff(dayjs(lastCallTimeStamp), 'seconds') > 10
    ) {
      lastCallTimeStamp = dayjs();
      accountInfo = await tronWeb.trx.getAccount(address);
    }
    return accountInfo;
  };
  const checkNewAccount = async ({tronWeb, address}) => {
    try {
      const resp = await getAccount({tronWeb, address});
      return !(resp?.create_time || resp?.latest_opration_time);
    } catch (e) {
      return true;
    }
  };

  const getAccountResourcesData = async (tronWeb, address) => {
    const resp = await tronWeb.trx.getAccountResources(address);
    const {
      freeNetUsed = 0,
      freeNetLimit = 0,
      NetUsed = 0,
      NetLimit = 0,
      EnergyLimit = 0,
      EnergyUsed = 0,
      tronPowerUsed: totalVotes = 0,
      tronPowerLimit: totalVotesUsed = 0,
    } = resp || {};
    const availableVotes = totalVotes - totalVotesUsed;
    const freeBandwidth = freeNetLimit - freeNetUsed;
    const stakeBandwidth = NetLimit - NetUsed;
    const energy = EnergyLimit - EnergyUsed;
    return {
      energy,
      bandwidth: Math.max(freeBandwidth, stakeBandwidth),
      totalVotes,
      availableVotes,
    };
  };

  const calculateBandwidth = (
    txData,
    availableBandwidth,
    transactionFee,
    isExtraFees,
  ) => {
    const DATA_HEX_PROTOBUF_EXTRA = 3;
    const MAX_RESULT_SIZE_IN_TX = 64;
    const A_SIGNATURE = 67;
    const EXTRA_FEES = isExtraFees ? 20 : 0;
    let len =
      txData.raw_data_hex.length / 2 +
      DATA_HEX_PROTOBUF_EXTRA +
      MAX_RESULT_SIZE_IN_TX +
      EXTRA_FEES;
    const signatureListSize = txData.signature.length;
    for (let i = 0; i < signatureListSize; i++) {
      len += A_SIGNATURE;
    }
    const neededBandwidth = len;
    const additionalBandwidth = availableBandwidth - neededBandwidth;
    if (additionalBandwidth < 0) {
      return Math.abs(neededBandwidth * transactionFee);
    }
    return 0;
  };

  const convertStringToHex = str => {
    if (!str) {
      return '';
    }
    const hex = Array.from(str)
      .map(char => char.charCodeAt(0).toString(16).padStart(2, '0'))
      .join('');
    return hex;
  };

  const addUpdateData = (tronWeb, txn, memo) => {
    if (!memo) {
      return txn;
    }
    return tronWeb.transactionBuilder.addUpdateData(
      txn,
      convertStringToHex(memo),
      'hex',
    );
  };

  const createTransactionForFees = async (
    tronWeb,
    fromAddress,
    toAddress,
    amount,
    privateKey,
    memo,
  ) => {
    const updatePrivateKey = removeSubstringFromPrivateKey(privateKey);
    const transaction = await tronWeb.transactionBuilder.sendTrx(
      toAddress,
      amount,
      fromAddress,
    );
    const nexTxn = await addUpdateData(tronWeb, transaction, memo);
    return tronWeb.trx.sign(nexTxn, updatePrivateKey);
  };

  const createStakingTransactionFreezeBalance = async (
    tronWeb,
    fromAddress,
    amount,
    privateKey,
    resourceType,
  ) => {
    const updatePrivateKey = removeSubstringFromPrivateKey(privateKey);
    const transaction = await tronWeb.transactionBuilder.freezeBalanceV2(
      amount,
      resourceType,
      fromAddress,
    );
    return tronWeb.trx.sign(transaction, updatePrivateKey);
  };

  const createStakingTransactionUnFreezeBalance = async (
    tronWeb,
    fromAddress,
    amount,
    privateKey,
    resourceType,
  ) => {
    const updatePrivateKey = removeSubstringFromPrivateKey(privateKey);
    const transaction = await tronWeb.transactionBuilder.unfreezeBalanceV2(
      amount,
      resourceType,
      fromAddress,
    );
    return tronWeb.trx.sign(transaction, updatePrivateKey);
  };

  const createStakingTransactionForVote = async (
    tronWeb,
    fromAddress,
    privateKey,
    selectedVotes,
  ) => {
    const updatePrivateKey = removeSubstringFromPrivateKey(privateKey);
    const transaction = await tronWeb.transactionBuilder.vote(
      {...selectedVotes},
      fromAddress,
    );
    return tronWeb.trx.sign(transaction, updatePrivateKey);
  };

  const createStakingTransactionForWithdraw = async (
    tronWeb,
    fromAddress,
    privateKey,
  ) => {
    const updatePrivateKey = removeSubstringFromPrivateKey(privateKey);
    const transaction = await tronWeb.transactionBuilder.withdrawExpireUnfreeze(
      fromAddress,
    );
    return tronWeb.trx.sign(transaction, updatePrivateKey);
  };
  const createStakingTransactionForRewards = async (
    tronWeb,
    fromAddress,
    privateKey,
  ) => {
    const updatePrivateKey = removeSubstringFromPrivateKey(privateKey);
    const transaction = await tronWeb.transactionBuilder.withdrawBlockRewards(
      fromAddress,
    );
    return tronWeb.trx.sign(transaction, updatePrivateKey);
  };

  const getChainData = async tronWeb => {
    const chainParams = await tronWeb.trx.getChainParameters();
    const accountCreationFee =
      chainParams.find(item => item?.key === 'getCreateAccountFee')?.value ||
      100000;
    const newAccountFee =
      chainParams.find(
        item => item?.key === 'getCreateNewAccountFeeInSystemContract',
      )?.value || 100000;
    const transactionFee =
      chainParams.find(item => item?.key === 'getTransactionFee').value || 1000;
    const energyFee =
      chainParams.find(item => item?.key === 'getEnergyFee').value || 420;
    const memoFee =
      chainParams.find(item => item?.key === 'getMemoFee').value || 1000000;
    return {
      accountCreationFee,
      newAccountFee,
      transactionFee,
      energyFee,
      memoFee,
    };
  };

  return {
    getIconName: async () => {
      return 'TRX';
    },
    isValidAddress: ({address}) => {
      return defaultTronWeb?.isAddress(address);
    },
    isValidPrivateKey: ({privateKey}) => {
      try {
        const updatePrivateKey = removeSubstringFromPrivateKey(privateKey);
        const address = defaultTronWeb.address.toHex(
          defaultTronWeb.address.fromPrivateKey(updatePrivateKey),
        );
        return !!address;
      } catch (e) {
        return false;
      }
    },

    createWalletByPrivateKey: ({privateKey}) => {
      const updatePrivateKey = removeSubstringFromPrivateKey(privateKey);
      const address = defaultTronWeb.address.toHex(
        defaultTronWeb.address.fromPrivateKey(updatePrivateKey),
      );
      return {
        privateKey: updatePrivateKey,
        address: defaultTronWeb.address.fromHex(address),
      };
    },
    getContract: async ({contractAddress}) =>
      retryFunc(async tronWeb => {
        try {
          tronWeb.setAddress(contractAddress);
          const contract = await tronWeb.contract().at(contractAddress);
          let name = '';
          let decimals = '';
          let symbol = '';
          if (contract?.name) {
            name = await contract.name().call();
            decimals = await contract.decimals().call();
            symbol = await contract.symbol().call();
          }
          return {
            name,
            symbol,
            decimals,
          };
        } catch (e) {
          console.error(`error getting contract ${e}`);
          throw e;
        }
      }, {}),
    getBalance: async ({address}) =>
      retryFunc(async tronWeb => {
        try {
          const json = await getAccount({tronWeb, address});
          const bal = json?.balance || 0;

          return bal?.toString() || '0';
        } catch (e) {
          console.error('error in get balance from tron', e);
          throw e;
        }
      }, '0'),
    getStakingBalance: async ({address}) =>
      retryFunc(
        async tronWeb => {
          try {
            const json = await getAccount({tronWeb, address});
            const stakeAmounts = Array.isArray(json?.frozenV2)
              ? json?.frozenV2
              : [];
            const totals = stakeAmounts.reduce(
              (acc, {amount, type}) => {
                const amountBN = new BigNumber(amount || 0);
                acc.totalStakeBalance = acc.totalStakeBalance.plus(amountBN);
                if (type === 'ENERGY') {
                  acc.totalEnergyBalance =
                    acc.totalEnergyBalance.plus(amountBN);
                } else {
                  acc.totalBandwidthBalance =
                    acc.totalBandwidthBalance.plus(amountBN);
                }
                return acc;
              },
              {
                totalStakeBalance: new BigNumber(0),
                totalBandwidthBalance: new BigNumber(0),
                totalEnergyBalance: new BigNumber(0),
              },
            );
            return {
              stakingBalance: totals?.totalStakeBalance?.toString() || '0',
              energyBalance: totals?.totalEnergyBalance?.toString() || '0',
              bandwidthBalance:
                totals?.totalBandwidthBalance?.toString() || '0',
            };
          } catch (e) {
            console.error('error in get balance from tron', e);
            throw e;
          }
        },
        {
          stakingBalance: '0',
          energyBalance: '0',
          bandwidthBalance: '0',
        },
      ),
    getStaking: async ({address}) =>
      retryFunc(async tronWeb => {
        try {
          const resp = await TronScan.getAllValidators();
          const data = resp?.data;
          if (Array.isArray(data)) {
            const json = await getAccount({tronWeb, address});
            const availableValidators = Array.isArray(json?.votes)
              ? json?.votes.map(item => {
                  return {
                    ...item,
                    vote_address: TronWeb.address.fromHex(item?.vote_address),
                  };
                })
              : [];
            return availableValidators.map(validator => {
              const foundValidator = data.find(
                item => item.address === validator.vote_address,
              );
              return {
                staking_address: address,
                amount:
                  convertToSmallAmount(validator?.vote_count?.toString(), 6) ||
                  '0',
                validator_address: validator?.vote_address,
                owner_address: address,
                validatorInfo: {
                  name: foundValidator?.name,
                  website: foundValidator?.url,
                  image: null,
                },
              };
            });
          }
          return [];
        } catch (e) {
          console.error('Error in get staking in tron', e);
          throw e;
        }
      }, []),
    getEstimateFeeForToken: async ({
      fromAddress,
      toAddress,
      contractAddress,
      amount,
      decimals,
      privateKey,
      memo,
    }) =>
      retryFunc(async tronWeb => {
        try {
          const updatePrivateKey = removeSubstringFromPrivateKey(privateKey);

          const {transactionFee, energyFee, memoFee} = await getChainData(
            tronWeb,
          );
          const sunAmount = convertToSmallAmount(amount, decimals);
          const {bandwidth: availableBandwidth, energy: currentAccountEnergy} =
            await getAccountResourcesData(tronWeb, fromAddress);
          const toAddressHex = tronWeb.address.toHex(toAddress);
          let typesValues = [
            {type: 'address', value: toAddressHex},
            {type: 'uint256', value: sunAmount},
          ];
          const tx = await tronWeb.transactionBuilder.triggerConstantContract(
            tronWeb.address.toHex(contractAddress),
            'transfer(address,uint256)',
            {},
            typesValues,
            tronWeb.address.toHex(fromAddress),
          );
          const nexTxn = await addUpdateData(tronWeb, tx?.transaction, memo);
          const txData = await tronWeb.trx.sign(nexTxn, updatePrivateKey);

          let totalFee = calculateBandwidth(
            txData,
            availableBandwidth,
            transactionFee,
            true,
          );
          if (memo) {
            totalFee += memoFee;
          }
          const energyUsed = tx?.energy_used;
          const energyRequired = currentAccountEnergy - energyUsed;

          const energyRequireTrx =
            energyRequired < 0
              ? Number(Math.abs(energyRequired)) * energyFee
              : 0;
          totalFee += energyRequireTrx;
          return {
            fee: tronWeb.fromSun(totalFee?.toString()),
            gasFee: null,
            estimateGas: null,
          };
        } catch (e) {
          console.error('error in get token fees', e);
          throw e;
        }
      }, null),
    getEstimateFee: async ({
      fromAddress,
      toAddress,
      amount,
      privateKey,
      memo,
    }) =>
      retryFunc(async tronWeb => {
        try {
          const updatePrivateKey = removeSubstringFromPrivateKey(privateKey);
          const {accountCreationFee, newAccountFee, transactionFee, memoFee} =
            await getChainData(tronWeb);
          const sunAmount = tronWeb.toSun(amount);
          const isNewAccount = await checkNewAccount({
            tronWeb,
            address: toAddress,
          });
          let totalFee = 0;
          if (isNewAccount) {
            totalFee += newAccountFee;
            totalFee += accountCreationFee;
          } else {
            const {bandwidth: availableBandwidth} =
              await getAccountResourcesData(tronWeb, fromAddress);
            const txData = await createTransactionForFees(
              tronWeb,
              fromAddress,
              toAddress,
              Number(sunAmount),
              updatePrivateKey,
              memo,
            );
            totalFee = calculateBandwidth(
              txData,
              availableBandwidth,
              transactionFee,
            );
            if (memo) {
              totalFee += memoFee;
            }
          }
          return {
            fee: TronWeb.fromSun(totalFee?.toString()),
            gasFee: null,
            estimateGas: null,
          };
        } catch (e) {
          console.error('Error in get estimate fee for tron', e);
          throw e;
        }
      }, null),
    getEstimateFeeForStaking: async ({
      fromAddress,
      amount,
      privateKey,
      resourceType,
    }) =>
      retryFunc(async tronWeb => {
        try {
          const updatePrivateKey = removeSubstringFromPrivateKey(privateKey);
          const {transactionFee} = await getChainData(tronWeb);
          const {bandwidth: availableBandwidth} = await getAccountResourcesData(
            tronWeb,
            fromAddress,
          );
          const sunAmount = tronWeb.toSun(amount);
          const txData = await createStakingTransactionFreezeBalance(
            tronWeb,
            fromAddress,
            Number(sunAmount),
            updatePrivateKey,
            resourceType,
          );
          const totalFee = calculateBandwidth(
            txData,
            availableBandwidth,
            transactionFee,
          );
          return {
            fee: TronWeb.fromSun(totalFee?.toString()),
            gasFee: null,
            estimateGas: null,
          };
        } catch (e) {
          console.error('Error in tron getEstimateFeeForStaking', e);
          throw e;
        }
      }, null),
    getEstimateFeeForDeactivateStaking: async ({
      fromAddress,
      amount,
      privateKey,
      resourceType,
    }) =>
      retryFunc(async tronWeb => {
        try {
          const updatePrivateKey = removeSubstringFromPrivateKey(privateKey);
          const {transactionFee} = await getChainData(tronWeb);
          const {bandwidth: availableBandwidth} = await getAccountResourcesData(
            tronWeb,
            fromAddress,
          );
          const sunAmount = tronWeb.toSun(amount);
          const txData = await createStakingTransactionUnFreezeBalance(
            tronWeb,
            fromAddress,
            Number(sunAmount),
            updatePrivateKey,
            resourceType,
          );
          const totalFee = calculateBandwidth(
            txData,
            availableBandwidth,
            transactionFee,
          );
          return {
            fee: TronWeb.fromSun(totalFee?.toString()),
            gasFee: null,
            estimateGas: null,
          };
        } catch (e) {
          console.error('Error in tron getEstimateFeeForDeactivateStaking', e);
          throw e;
        }
      }, null),
    estimateFeesForStakeValidators: async ({
      fromAddress,
      privateKey,
      selectedVotes,
    }) =>
      retryFunc(async tronWeb => {
        try {
          const updatePrivateKey = removeSubstringFromPrivateKey(privateKey);
          const {transactionFee} = await getChainData(tronWeb);
          const {bandwidth: availableBandwidth} = await getAccountResourcesData(
            tronWeb,
            fromAddress,
          );
          const txData = await createStakingTransactionForVote(
            tronWeb,
            fromAddress,
            updatePrivateKey,
            selectedVotes,
          );
          const totalFee = calculateBandwidth(
            txData,
            availableBandwidth,
            transactionFee,
          );
          return {
            fee: TronWeb.fromSun(totalFee?.toString()),
            gasFee: null,
            estimateGas: null,
          };
        } catch (e) {
          console.error('Error in tron estimateFeesForStakeValidators', e);
          throw e;
        }
      }, null),
    getEstimateFeeForWithdrawStaking: async ({fromAddress, privateKey}) =>
      retryFunc(async tronWeb => {
        try {
          const updatePrivateKey = removeSubstringFromPrivateKey(privateKey);
          const {transactionFee} = await getChainData(tronWeb);
          const {bandwidth: availableBandwidth} = await getAccountResourcesData(
            tronWeb,
            fromAddress,
          );
          const txData = await createStakingTransactionForWithdraw(
            tronWeb,
            fromAddress,
            updatePrivateKey,
          );
          const totalFee = calculateBandwidth(
            txData,
            availableBandwidth,
            transactionFee,
          );
          return {
            fee: TronWeb.fromSun(totalFee?.toString()),
            gasFee: null,
            estimateGas: null,
          };
        } catch (e) {
          console.error('Error in tron estimateFeesForWithdrawStaking', e);
          throw e;
        }
      }, null),
    getEstimateFeeForStakingRewards: async ({fromAddress, privateKey}) =>
      retryFunc(async tronWeb => {
        try {
          const updatePrivateKey = removeSubstringFromPrivateKey(privateKey);
          const {transactionFee} = await getChainData(tronWeb);
          const {bandwidth: availableBandwidth} = await getAccountResourcesData(
            tronWeb,
            fromAddress,
          );
          const txData = await createStakingTransactionForRewards(
            tronWeb,
            fromAddress,
            updatePrivateKey,
          );
          const totalFee = calculateBandwidth(
            txData,
            availableBandwidth,
            transactionFee,
          );
          return {
            fee: TronWeb.fromSun(totalFee?.toString()),
            gasFee: null,
            estimateGas: null,
          };
        } catch (e) {
          console.error('Error in tron getEstimateFeeForStakingRewards', e);
          throw e;
        }
      }, null),
    getTokenBalance: async ({address, contractAddress}) =>
      retryFunc(async tronWeb => {
        try {
          tronWeb.setAddress(contractAddress);
          const contract = await tronWeb.contract().at(contractAddress);
          return await contract.balanceOf(address).call();
        } catch (e) {
          console.error(`error getting token balance tron ${e}`);
          throw e;
        }
      }, '0'),
    getTransactions: async ({address}) =>
      retryFunc(async tronWeb => {
        try {
          const resp = await tronWeb.fullNode.request(
            `v1/accounts/${address}/transactions`,
            {limit: 20},
            'get',
          );
          return resp?.data?.map(transaction => {
            const raw = transaction.raw_data.contract[0].parameter.value;
            const fromAddress = tronWeb.address.fromHex(raw.owner_address);
            return {
              amount: raw?.amount?.toString(),
              link: transaction.txID.substring(0, 13) + '...',
              url: `${config.TRON_SCAN_URL}/transaction/${transaction.txID}`,
              date: transaction.raw_data.timestamp, //new Date(transaction.raw_data.timestamp),
              status: transaction.ret?.[0]?.contractRet,
              fee: transaction.ret?.[0]?.fee, // total fee
              net_fee: transaction.net_fee,
              from: fromAddress,
              to: tronWeb.address.fromHex(raw.to_address),
              blockNumber: transaction.blockNumber,
              totalCourse: '0$',
            };
          });
        } catch (e) {
          console.error(`error getting transactions ${e}`);
          throw e;
        }
      }, []),
    getStakingInfo: async ({staking, stakingBalance, address}) =>
      retryFunc(async tronWeb => {
        try {
          let totalValue = new BigNumber(0);
          let stakeBalanceBN = stakingBalance
            ? new BigNumber(stakingBalance)
            : new BigNumber(0);
          const tempStaking = Array.isArray(staking) ? staking : [];
          tempStaking.forEach(item => {
            totalValue = totalValue.plus(new BigNumber(item.amount));
          });
          const json = await getAccount({tronWeb, address});
          let rewards = 0;
          const lastWithdrawTime = json?.latest_withdraw_time;
          if (
            !lastWithdrawTime ||
            dayjs().isAfter(dayjs(lastWithdrawTime).add(24, 'hours'))
          ) {
            rewards = await tronWeb.trx.getUnconfirmedReward(address);
          }
          const {count: availableUnfreezeCount} =
            await tronWeb.trx.getAvailableUnfreezeCount(address);
          const unfrozenV2 = Array.isArray(json?.unfrozenV2)
            ? json?.unfrozenV2
            : [];
          const totalWithdrawAmount = unfrozenV2.reduce(
            (totalBalance, {unfreeze_amount, unfreeze_expire_time}) => {
              if (dayjs(unfreeze_expire_time).isBefore(dayjs())) {
                const amountBN = unfreeze_amount
                  ? new BigNumber(unfreeze_amount)
                  : new BigNumber(0);
                return totalBalance.plus(amountBN);
              }
              return totalBalance;
            },
            new BigNumber(0),
          );
          const stakingInfo = [
            {
              label: 'Stake',
              value: `${totalValue.toString()} TRX`,
            },
            {
              label: 'Available Vote',
              value: `${stakeBalanceBN
                .minus(totalValue)
                .integerValue(BigNumber.ROUND_FLOOR)} TRX`,
            },
          ];
          if (totalWithdrawAmount.gt(new BigNumber(0))) {
            const withdrawTrx = tronWeb.fromSun(
              totalWithdrawAmount?.toString(),
            );
            stakingInfo.push({
              label: 'Withdraw',
              value: `${withdrawTrx} TRX`,
              buttonLabel: 'Withdraw',
              buttonValue: withdrawTrx,
            });
          }
          if (rewards > 0) {
            const rewardTrx = tronWeb.fromSun(rewards?.toString());
            stakingInfo.push({
              label: 'Rewards',
              value: `${rewardTrx} TRX`,
              buttonLabel: 'Claim',
              buttonValue: rewardTrx,
            });
          }
          if (availableUnfreezeCount <= 0) {
            stakingInfo.push({
              type: 'hidden',
              label: 'disabled_unstaking',
              value:
                'Unstaking is currently unavailable because the maximum limit has been reached.',
            });
          }
          return stakingInfo;
        } catch (e) {
          console.error('Error in get tron getStakingInfo', e);
          throw e;
        }
      }, []),
    getStakingValidators: async ({address}) =>
      retryFunc(async tronWeb => {
        try {
          const resp = await TronScan.getAllValidators();
          const validators = Array.isArray(resp?.data) ? resp.data : [];

          const json = await getAccount({tronWeb, address});
          const availableValidators = Array.isArray(json?.votes)
            ? json?.votes.map(item => {
                return {
                  ...item,
                  vote_address: TronWeb.address.fromHex(item?.vote_address),
                };
              })
            : [];
          const votedValidators = [];
          const otherValidators = [];
          validators.forEach(validator => {
            const foundValidator = availableValidators.find(
              item => item.vote_address === validator.address,
            );
            const finalObj = {
              ...validator,
              validatorAddress: validator?.address,
              image: validator?.image,
              name: validator?.name,
              apy_estimate: validator?.annualizedRate,
              activated_stake: validator?.votes,
            };
            if (foundValidator) {
              votedValidators.push(finalObj);
            } else {
              otherValidators.push(finalObj);
            }
          });
          const selectedVotes = availableValidators.reduce(
            (obj, item) =>
              Object.assign(obj, {[item.vote_address]: item.vote_count}),
            {},
          );
          return {
            validators: [...votedValidators, ...otherValidators],
            selectedVotes,
          };
        } catch (e) {
          console.error('Error in get tron getStakingValidators', e);
          throw e;
        }
      }, []),

    getTokenTransactions: async ({address, contractAddress}) =>
      retryFunc(async tronWeb => {
        try {
          const res = await tronWeb.fullNode.request(
            `v1/accounts/${address}/transactions/trc20`,
            {limit: 20, contract_address: contractAddress},
            'get',
          );
          const data = res?.data;
          return data.map(transaction => {
            const raw = transaction.value;
            const fromAddress = transaction?.from;

            return {
              amount: raw?.toString(),
              link: transaction.transaction_id.substring(0, 13) + '...',
              url: `${config.TRON_SCAN_URL}/transaction/${transaction.transaction_id}`,
              status: 'SUCCESS',
              date: transaction?.block_timestamp, //new Date(transaction.raw_data.timestamp),
              from: fromAddress,
              to: transaction?.to,
              totalCourse: '0$',
            };
          });
        } catch (e) {
          console.error(`error getting getTokenTransactions ${e}`);
          throw e;
        }
      }, []),
    send: async ({to, from, amount, memo, privateKey}) =>
      retryFunc(async tronWeb => {
        const updatePrivateKey = removeSubstringFromPrivateKey(privateKey);
        let transaction = await tronWeb.transactionBuilder.sendTrx(
          to,
          tronWeb.toSun(amount), // 10 TRX, for example.
          from,
        );
        const nexTxn = await addUpdateData(tronWeb, transaction, memo);
        let signedTransaction = await tronWeb.trx.sign(
          nexTxn,
          updatePrivateKey,
        );

        const tr = await tronWeb.trx.sendRawTransaction(signedTransaction);
        if (!tr?.result) {
          console.error('tron transaction response', tr);
          throw new Error('Something went wrong');
        }
        return tr;
      }, null),
    sendToken: async ({
      contractAddress,
      to,
      from,
      amount,
      privateKey,
      decimal,
      memo,
    }) =>
      retryFunc(async tronWeb => {
        const updatePrivateKey = removeSubstringFromPrivateKey(privateKey);

        const options = {
          feeLimit: 1000000000,
          callValue: 0,
        };

        const tx = await tronWeb.transactionBuilder.triggerSmartContract(
          contractAddress,
          'transfer(address,uint256)',
          options,
          [
            {
              type: 'address',
              value: to,
            },
            {
              type: 'uint256',
              value: convertToSmallAmount(amount, decimal || 6),
            },
          ],
          tronWeb.address.toHex(from),
        );
        const nexTxn = await addUpdateData(tronWeb, tx.transaction, memo);
        const signedTx = await tronWeb.trx.sign(nexTxn, updatePrivateKey);
        return await tronWeb.trx.sendRawTransaction(signedTx);
      }, null),
    createStaking: async ({from, amount, privateKey, resourceType}) =>
      retryFunc(async tronWeb => {
        try {
          const updatePrivateKey = removeSubstringFromPrivateKey(privateKey);
          const sunAmount = tronWeb.toSun(amount);
          const txData = await createStakingTransactionFreezeBalance(
            tronWeb,
            from,
            Number(sunAmount),
            updatePrivateKey,
            resourceType,
          );
          const tx = await tronWeb.trx.sendRawTransaction(txData);
          if (!tx?.result) {
            console.error('voteTr tron transaction response', tx);
            throw new Error('Something went wrong');
          }
          return tx;
        } catch (e) {
          console.error('Error in tron createStaking', e);
          throw e;
        }
      }, null),
    createStakingWithValidator: async ({from, privateKey, selectedVotes}) =>
      retryFunc(async tronWeb => {
        try {
          const updatePrivateKey = removeSubstringFromPrivateKey(privateKey);
          const txData = await createStakingTransactionForVote(
            tronWeb,
            from,
            updatePrivateKey,
            selectedVotes,
          );
          const tx = await tronWeb.trx.sendRawTransaction(txData);
          if (!tx?.result) {
            console.error('voteTr tron transaction response', tx);
            throw new Error('Something went wrong');
          }
          return tx;
        } catch (e) {
          console.error('Error in tron createStakingWithValidator', e);
          throw e;
        }
      }, null),
    deactivateStaking: async ({from, amount, privateKey, resourceType}) =>
      retryFunc(async tronWeb => {
        try {
          const updatePrivateKey = removeSubstringFromPrivateKey(privateKey);
          const sunAmount = tronWeb.toSun(amount);
          const txData = await createStakingTransactionUnFreezeBalance(
            tronWeb,
            from,
            Number(sunAmount),
            updatePrivateKey,
            resourceType,
          );
          const tx = await tronWeb.trx.sendRawTransaction(txData);
          if (!tx?.result) {
            console.error('voteTr tron transaction response', tx);
            throw new Error('Something went wrong');
          }
          return tx;
        } catch (e) {
          console.error('Error in tron deactivateStaking', e);
          throw e;
        }
      }, null),
    withdrawStaking: async ({from, privateKey}) =>
      retryFunc(async tronWeb => {
        try {
          const updatePrivateKey = removeSubstringFromPrivateKey(privateKey);
          const txData = await createStakingTransactionForWithdraw(
            tronWeb,
            from,
            updatePrivateKey,
          );
          const tx = await tronWeb.trx.sendRawTransaction(txData);
          if (!tx?.result) {
            console.error('withdrawStaking tron transaction response', tx);
            throw new Error('Something went wrong');
          }
          return tx;
        } catch (e) {
          console.error('Error in tron withdrawStaking', e);
          throw e;
        }
      }, null),
    stakingRewards: async ({from, privateKey}) =>
      retryFunc(async tronWeb => {
        try {
          const updatePrivateKey = removeSubstringFromPrivateKey(privateKey);
          const txData = await createStakingTransactionForRewards(
            tronWeb,
            from,
            updatePrivateKey,
          );
          const tx = await tronWeb.trx.sendRawTransaction(txData);
          if (!tx?.result) {
            console.error('withdrawStaking tron transaction response', tx);
            throw new Error('Something went wrong');
          }
          return tx;
        } catch (e) {
          console.error('Error in tron stakingRewards', e);
          throw e;
        }
      }, null),
    signmessageV2: async ({payload, privateKey}) =>
      retryFunc(async tronWeb => {
        try {
          const signature = tronWeb.trx.signMessageV2(payload, privateKey);
          return {signature};
        } catch (e) {
          console.error('Error in sign tron message', e);
          return Promise.reject(e?.message);
        }
      }, null),
    signTransaction: async ({payload, privateKey}) =>
      retryFunc(async tronWeb => {
        try {
          const transactionData = await tronWeb.trx.sign(
            {...payload},
            privateKey,
          );
          return {result: transactionData};
        } catch (e) {
          console.error('Error in sign tron transaction', e);
          return Promise.reject(e?.message);
        }
      }, null),

    waitForConfirmation: async ({transaction, interval = 3000, retries = 5}) =>
      retryFunc(async tronWeb => {
        const transactionID = transaction?.txid;
        if (!transactionID) {
          console.error('No transaction id found for tron');
          return null;
        }
        return new Promise((resolve, reject) => {
          let numberOfRetries = 0;
          let timer = setInterval(async () => {
            try {
              numberOfRetries += 1;
              let response;
              if (isWeb) {
                response = await tronWeb.trx.getTransactionInfo(transactionID);
              } else {
                response = await TronScan.getTransactionByHash(transactionID);
              }
              if (
                (response?.data === 'SUCCESS' && !isWeb) ||
                (isWeb && response?.id)
              ) {
                clearInterval(timer);
                resolve(response);
              } else if (
                response?.data &&
                typeof response?.data === 'string' &&
                !isWeb
              ) {
                clearInterval(timer);
                reject(response?.data);
              } else if (numberOfRetries === retries) {
                clearInterval(timer);
                resolve('pending');
              }
            } catch (e) {
              clearInterval(timer);
              console.error('Error in get tranaction', e);
              reject(e);
            }
          }, interval);
        });
      }, null),
  };
};
