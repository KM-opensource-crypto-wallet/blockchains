import {TronWeb} from 'tronweb';
import {
  getPremiumRPCUrl,
  getRPCUrl,
} from 'dok-wallet-blockchain-networks/rpcUrls/rpcUrls';
import {rpcSessionAdapter} from 'dok-wallet-blockchain-networks/rpcUrls/rpcSession';
import {
  convertToSmallAmount,
  fetchRequest,
  getExplorerTxUrl,
  isSwapBlockingError,
  SWAP_QUOTE_EXPIRED_ERROR,
} from 'dok-wallet-blockchain-networks/helper';
import bs58 from 'bs58';
import {isWeb} from 'dok-wallet-blockchain-networks/config/config';
import BigNumber from 'bignumber.js';
import {sha256} from 'ethers';
import {TronScan} from 'dok-wallet-blockchain-networks/service/tronScan';
import dayjs from 'dayjs';
import trc20Abi from 'dok-wallet-blockchain-networks/abis/trc20.json';

let accountInfo = {};
let lastCallTimeStamp;

const removeSubstringFromPrivateKey = privateKey => {
  return privateKey?.toLowerCase()?.startsWith('0x')
    ? privateKey?.substring(2)
    : privateKey;
};

const withRpcSession = tronWeb => {
  for (const node of [tronWeb.fullNode, tronWeb.solidityNode]) {
    node.instance.defaults.adapter = rpcSessionAdapter;
  }
  return tronWeb;
};

const tronAddressToEvmHex = address => {
  const decoded = bs58.decode(address);
  const payload = decoded.slice(1, decoded.length - 4);
  return Array.from(payload)
    .map(byte => byte.toString(16).padStart(2, '0'))
    .join('');
};

const tronAddressFromHex = hexAddress => {
  const bytes = hexAddress.match(/.{2}/g).map(byte => parseInt(byte, 16));
  const checksum = sha256(sha256('0x' + hexAddress))
    .slice(2, 10)
    .match(/.{2}/g)
    .map(byte => parseInt(byte, 16));
  return bs58.encode(Uint8Array.from([...bytes, ...checksum]));
};
const protoVarintHex = len => {
  let n = len;
  let hex = '';
  while (n >= 0x80) {
    hex += (0x80 + (n % 0x80)).toString(16).padStart(2, '0');
    n = Math.floor(n / 0x80);
  }
  return hex + n.toString(16).padStart(2, '0');
};

// Signed Transaction protobuf: field 1 (0x0a) = raw_data, field 2 (0x12) = signature
const encodeSignedTronTxHex = (rawDataHex, signatureHex) =>
  '0a' +
  protoVarintHex(rawDataHex.length / 2) +
  rawDataHex +
  '12' +
  protoVarintHex(signatureHex.length / 2) +
  signatureHex;

export const TronChain = () => {
  const buildTronProviders = () => {
    const premiumUrl = getPremiumRPCUrl('tron');
    return [
      ...(premiumUrl ? [{fullHost: premiumUrl}] : []),
      {
        fullHost: getRPCUrl('tron_full_host'),
        solidityNode: getRPCUrl('tron_solidity_node'),
        eventServer: getRPCUrl('tron_event_server'),
      },
    ];
  };

  // Created on first SDK use so balance-only sessions never load tronweb.
  let defaultTronWebInstance = null;
  const defaultTronWeb = () => {
    if (!defaultTronWebInstance) {
      try {
        defaultTronWebInstance = new TronWeb({
          fullHost: getRPCUrl('tron_full_host'),
          solidityNode: getRPCUrl('tron_solidity_node'),
          eventServer: getRPCUrl('tron_event_server'),
        });
      } catch (e) {
        console.error(`error creating tronWeb ${e}`);
        throw e;
      }
    }
    return defaultTronWebInstance;
  };

  const retryFunc = async (cb, defaultResponse) => {
    const providers = buildTronProviders();
    for (let i = 0; i < providers.length; i++) {
      try {
        return await cb(withRpcSession(new TronWeb(providers[i])));
      } catch (e) {
        console.error(
          'Error for tron provider',
          i,
          providers[i].fullHost,
          'Errors:',
          e,
        );
        if (i === providers.length - 1) {
          if (defaultResponse) {
            return defaultResponse;
          } else {
            throw e;
          }
        }
      }
    }
  };

  const rpcRequest = async (path, body, defaultResponse) => {
    const providers = buildTronProviders();
    for (let i = 0; i < providers.length; i++) {
      try {
        const json = await fetchRequest(`${providers[i].fullHost}/${path}`, {
          ...(body ? {method: 'post', data: body} : {}),
          adapter: rpcSessionAdapter,
        });
        if (json?.Error) {
          throw new Error(json.Error);
        }
        return json;
      } catch (e) {
        console.error(
          'Error for tron provider',
          i,
          providers[i].fullHost,
          'Errors:',
          e,
        );
        if (isSwapBlockingError(e?.message)) {
          // A swap simulation revert / expired raw_data is deterministic —
          // retrying on the next provider repeats it, and a later provider's
          // transport error would replace the message sendFunds keys on.
          throw e;
        }
        if (i === providers.length - 1) {
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

  // Simulates a swap's TriggerSmartContract before anything is signed. A
  // revert here means the broadcast tx would revert too and burn the fee —
  // on a provider-built swap that's almost always an expired quote (the
  // route's minOut/deadline died while the TRC20 approval was confirming).
  const simulateTronSwapOrThrow = async (
    tronWeb,
    {owner_address, contract_address, data, call_value},
  ) => {
    const resp = await tronWeb.fullNode.request(
      'wallet/triggerconstantcontract',
      {
        owner_address,
        contract_address,
        data,
        call_value: call_value || 0,
      },
      'post',
    );
    const reverted =
      resp?.result?.result !== true ||
      resp?.transaction?.ret?.[0]?.ret === 'FAILED' ||
      Boolean(resp?.result?.message);
    if (reverted) {
      const message = resp?.result?.message
        ? tronWeb.toUtf8(resp.result.message)
        : resp?.transaction?.ret?.[0]?.ret || 'simulation not successful';
      console.error('Tron swap simulation reverted', message);
      throw new Error(SWAP_QUOTE_EXPIRED_ERROR);
    }
    return resp;
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
      return defaultTronWeb().isAddress(address);
    },
    isValidPrivateKey: ({privateKey}) => {
      try {
        const updatePrivateKey = removeSubstringFromPrivateKey(privateKey);
        const address = defaultTronWeb().address.toHex(
          defaultTronWeb().address.fromPrivateKey(updatePrivateKey),
        );
        return !!address;
      } catch (e) {
        return false;
      }
    },

    createWalletByPrivateKey: ({privateKey}) => {
      const updatePrivateKey = removeSubstringFromPrivateKey(privateKey);
      const address = defaultTronWeb().address.toHex(
        defaultTronWeb().address.fromPrivateKey(updatePrivateKey),
      );
      return {
        privateKey: updatePrivateKey,
        address: defaultTronWeb().address.fromHex(address),
      };
    },
    getContract: async ({contractAddress}) =>
      retryFunc(async tronWeb => {
        try {
          tronWeb.setAddress(contractAddress);
          let contract = await tronWeb.contract().at(contractAddress);
          let name = '';
          let decimals = '';
          let symbol = '';
          if (!contract?.name) {
            contract = tronWeb.contract(trc20Abi, contractAddress);
          }
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
    getBalance: async ({address}) => {
      const json = await rpcRequest(
        'wallet/getaccount',
        {address, visible: true},
        {balance: 0}, // default response if all providers fail
      );
      return (json?.balance || 0).toString();
    },
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
    getTokenBalance: async ({address, contractAddress}) => {
      const json = await rpcRequest(
        'wallet/triggerconstantcontract',
        {
          owner_address: address,
          contract_address: contractAddress,
          function_selector: 'balanceOf(address)',
          parameter: tronAddressToEvmHex(address).padStart(64, '0'),
          visible: true,
        },
        {},
      );
      const balanceHex = json?.constant_result?.[0];
      return balanceHex ? BigInt(`0x${balanceHex}`).toString() : '0';
    },
    getTransactions: async ({address}) => {
      try {
        const resp = await rpcRequest(
          `v1/accounts/${address}/transactions?limit=20`,
          null,
          {data: []},
        );
        return await Promise.all(
          resp?.data?.map(async transaction => {
            const contract = transaction.raw_data.contract[0];
            const contractType = contract?.type;
            const raw = contract.parameter.value;
            const fromAddress = tronAddressFromHex(raw.owner_address);
            let amount, transactionType, to, contractAddress;

            if (contractType === 'FreezeBalanceV2Contract') {
              amount = raw?.frozen_balance?.toString();
              transactionType = 'stake';
              to = fromAddress;
            } else if (contractType === 'UnfreezeBalanceV2Contract') {
              amount = raw?.unfreeze_balance?.toString();
              transactionType = 'unstake';
              to = fromAddress;
            } else if (contractType === 'WithdrawExpireUnfreezeContract') {
              const txInfo = await rpcRequest(
                'wallet/gettransactioninfobyid',
                {value: transaction.txID},
                {},
              );
              amount = txInfo?.withdraw_expire_amount?.toString() ?? '0';
              transactionType = 'withdraw';
              to = fromAddress;
            } else if (contractType === 'WithdrawBalanceContract') {
              const txInfo = await rpcRequest(
                'wallet/gettransactioninfobyid',
                {value: transaction.txID},
                {},
              );
              amount = txInfo?.withdraw_amount?.toString() ?? '0';
              transactionType = 'withdraw';
              to = fromAddress;
            } else if (contractType === 'TriggerSmartContract') {
              const callData = raw?.data ?? '';
              contractAddress = raw?.contract_address
                ? tronAddressFromHex(raw.contract_address)
                : null;
              if (callData.startsWith('a9059cbb') && callData.length >= 136) {
                // TRC-20 transfer(address,uint256) — decode recipient only;
                // amount is blanked because token decimal/symbol is unknown here
                const recipientHex = '41' + callData.slice(32, 72);
                try {
                  to = tronAddressFromHex(recipientHex);
                } catch {
                  to = fromAddress;
                }
                amount = '';
              } else {
                amount = '';
                to = contractAddress ?? fromAddress;
              }
              transactionType = 'smartContract';
            } else if (contractType === 'VoteWitnessContract') {
              amount = '';
              transactionType = 'smartContract';
              to = fromAddress;
            } else {
              amount = raw?.amount?.toString();
              transactionType = 'regular';
              to = raw.to_address
                ? tronAddressFromHex(raw.to_address)
                : fromAddress;
            }

            return {
              amount,
              link: transaction.txID,
              url: getExplorerTxUrl('tron', transaction.txID),
              date: transaction.raw_data.timestamp,
              status: transaction.ret?.[0]?.contractRet,
              from: fromAddress,
              to,
              contractAddress,
              blockNumber: transaction.blockNumber,
              totalCourse: '0',
              transactionType,
            };
          }),
        );
      } catch (e) {
        console.error(`error getting transactions ${e}`);
        return [];
      }
    },
    getTransaction: async ({txHash}) => {
      try {
        if (!txHash) return {data: null};
        const [transaction, txInfo, nowBlock] = await Promise.all([
          rpcRequest('wallet/gettransactionbyid', {value: txHash}, {}),
          rpcRequest('wallet/gettransactioninfobyid', {value: txHash}, {}),
          rpcRequest('wallet/getnowblock', {visible: true}, {}),
        ]);
        if (!transaction?.raw_data?.contract?.[0]) return {data: null};
        const contract = transaction.raw_data.contract[0];
        const contractType = contract?.type;
        const raw = contract.parameter.value;
        const fromAddress = tronAddressFromHex(raw.owner_address);
        let amount, toAddress, contractAddress, transactionType;

        if (contractType === 'FreezeBalanceV2Contract') {
          amount = raw?.frozen_balance?.toString();
          toAddress = fromAddress;
          transactionType = 'stake';
        } else if (contractType === 'UnfreezeBalanceV2Contract') {
          amount = raw?.unfreeze_balance?.toString();
          toAddress = fromAddress;
          transactionType = 'unstake';
        } else if (contractType === 'WithdrawExpireUnfreezeContract') {
          amount = txInfo?.withdraw_expire_amount?.toString() ?? '0';
          toAddress = fromAddress;
          transactionType = 'withdraw';
        } else if (contractType === 'WithdrawBalanceContract') {
          amount = txInfo?.withdraw_amount?.toString() ?? '0';
          toAddress = fromAddress;
          transactionType = 'withdraw';
        } else if (contractType === 'TriggerSmartContract') {
          const callData = raw?.data ?? '';
          contractAddress = raw?.contract_address
            ? tronAddressFromHex(raw.contract_address)
            : null;
          if (callData.startsWith('a9059cbb') && callData.length >= 136) {
            // TRC-20 transfer(address,uint256)
            // Return raw amount — getSingleTransaction applies parseBalance
            // with the correct token decimal from coinDef
            const recipientHex = '41' + callData.slice(32, 72);
            try {
              toAddress = tronAddressFromHex(recipientHex);
            } catch {
              toAddress = null;
            }
            amount = BigInt('0x' + callData.slice(72, 136)).toString();
          } else {
            amount = '';
            toAddress = contractAddress ?? null;
          }
          transactionType = 'smartContract';
        } else if (contractType === 'VoteWitnessContract') {
          amount = '';
          toAddress = fromAddress;
          transactionType = 'smartContract';
        } else {
          amount = raw?.amount?.toString();
          toAddress = raw.to_address
            ? tronAddressFromHex(raw.to_address)
            : undefined;
          transactionType = 'regular';
        }

        const blockNumber = txInfo?.blockNumber ?? null;
        const latestBlockNumber =
          nowBlock?.block_header?.raw_data?.number ?? null;
        const confirmations =
          blockNumber !== null && latestBlockNumber !== null
            ? Math.max(0, latestBlockNumber - blockNumber)
            : null;
        return {
          data: {
            amount,
            link: txHash,
            url: getExplorerTxUrl('tron', txHash),
            date: transaction.raw_data.timestamp,
            status: transaction.ret?.[0]?.contractRet,
            fee: txInfo?.fee?.toString() ?? transaction.ret?.[0]?.fee,
            net_fee: txInfo?.receipt?.net_fee ?? transaction.net_fee,
            from: fromAddress,
            to: toAddress,
            contractAddress,
            transactionType,
            blockNumber,
            confirmations,
            totalCourse: '0',
          },
        };
      } catch (e) {
        console.error(`error getting transaction ${e}`);
        return {data: null};
      }
    },
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

    getTokenTransactions: async ({address, contractAddress}) => {
      try {
        const res = await rpcRequest(
          `v1/accounts/${address}/transactions/trc20?limit=20&contract_address=${contractAddress}`,
          null,
          {data: []},
        );
        const data = res?.data;
        return data.map(transaction => {
          const raw = transaction.value;
          const fromAddress = transaction?.from;
          return {
            amount: raw?.toString(),
            link: transaction.transaction_id,
            url: getExplorerTxUrl('tron', transaction.transaction_id),
            status: 'SUCCESS',
            date: transaction?.block_timestamp, //new Date(transaction.raw_data.timestamp),
            from: fromAddress,
            to: transaction?.to,
            totalCourse: '0$',
          };
        });
      } catch (e) {
        console.error(`error getting getTokenTransactions ${e}`);
        return [];
      }
    },
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
    // ── DEX swap support (LI.FI / Relay) ─────────────────────────────
    // TRC20 allowance read for the swap-approval flow. Return shape mirrors
    // EVMChain.readAllowance. Tron USDT has no Ethereum-USDT-style
    // "reset to zero first" guard, so needsReset is always false.
    readAllowance: async ({
      from,
      spenderAddress,
      contractAddress,
      amountInWei,
    }) =>
      retryFunc(async tronWeb => {
        const tx = await tronWeb.transactionBuilder.triggerConstantContract(
          tronWeb.address.toHex(contractAddress),
          'allowance(address,address)',
          {},
          [
            {type: 'address', value: tronWeb.address.toHex(from)},
            {type: 'address', value: tronWeb.address.toHex(spenderAddress)},
          ],
          tronWeb.address.toHex(from),
        );
        const rawResult = tx?.constant_result?.[0];
        const allowance = rawResult ? BigInt('0x' + rawResult) : 0n;
        const required = BigInt(amountInWei?.toString() || '0');
        return {
          allowance,
          required,
          isApproved: allowance >= required,
          needsReset: false,
        };
      }, null),
    // TRC20 approve for the swap spender. Waits for on-chain confirmation
    // like EVMChain.approve so the subsequent swap never races the approval.
    approve: async ({
      spenderAddress,
      contractAddress,
      amountInWei,
      allowance,
      from,
      privateKey,
    }) =>
      retryFunc(async tronWeb => {
        const updatePrivateKey = removeSubstringFromPrivateKey(privateKey);
        const required = BigInt(amountInWei?.toString() || '0');
        if (allowance != null && BigInt(allowance.toString()) >= required) {
          return {confirmTransaction: null, alreadyApproved: true};
        }
        const tx = await tronWeb.transactionBuilder.triggerSmartContract(
          tronWeb.address.toHex(contractAddress),
          'approve(address,uint256)',
          {feeLimit: 1000000000, callValue: 0},
          [
            {type: 'address', value: tronWeb.address.toHex(spenderAddress)},
            {type: 'uint256', value: required.toString()},
          ],
          tronWeb.address.toHex(from),
        );
        const signedTx = await tronWeb.trx.sign(
          tx.transaction,
          updatePrivateKey,
        );
        const broadcast = await tronWeb.trx.sendRawTransaction(signedTx);
        if (!broadcast?.result && !broadcast?.txid) {
          throw new Error(broadcast?.code || 'Tron approve broadcast failed');
        }
        const txid = broadcast?.txid || signedTx?.txID;
        // getTransactionInfo returns {} until the tx is confirmed.
        for (let i = 0; i < 15; i++) {
          await new Promise(resolve => setTimeout(resolve, 3000));
          const info = await tronWeb.trx.getTransactionInfo(txid);
          if (info?.receipt) {
            if (info.receipt.result && info.receipt.result !== 'SUCCESS') {
              throw new Error(`Tron approve failed: ${info.receipt.result}`);
            }
            break;
          }
        }
        return {confirmTransaction: broadcast, transaction1: broadcast};
      }, null),
    getEstimateFeForAllowanceApprove: async ({
      from,
      contractAddress,
      spenderAddress,
      amountInWei,
      privateKey,
      allowance,
    }) =>
      retryFunc(async tronWeb => {
        const updatePrivateKey = removeSubstringFromPrivateKey(privateKey);
        const {transactionFee, energyFee} = await getChainData(tronWeb);
        const {bandwidth: availableBandwidth, energy: currentAccountEnergy} =
          await getAccountResourcesData(tronWeb, from);
        const tx = await tronWeb.transactionBuilder.triggerConstantContract(
          tronWeb.address.toHex(contractAddress),
          'approve(address,uint256)',
          {},
          [
            {type: 'address', value: tronWeb.address.toHex(spenderAddress)},
            {
              type: 'uint256',
              value: BigInt(amountInWei?.toString() || '0').toString(),
            },
          ],
          tronWeb.address.toHex(from),
        );
        const txData = await tronWeb.trx.sign(tx.transaction, updatePrivateKey);
        let totalFee = calculateBandwidth(
          txData,
          availableBandwidth,
          transactionFee,
          true,
        );
        const energyUsed = tx?.energy_used || 0;
        const energyRequired = currentAccountEnergy - energyUsed;
        if (energyRequired < 0) {
          totalFee += Math.abs(energyRequired) * energyFee;
        }
        const feeTrx = tronWeb.fromSun(totalFee?.toString());
        // No fee knobs on Tron — null gas fields tell the approval sheet to
        // hide the advanced-fees controls.
        return {
          fee: feeTrx,
          transactionFee: feeTrx,
          allowance,
          gasFee: null,
          estimateGas: null,
          nonce: null,
          feesOptions: null,
        };
      }, null),
    // Executes a provider-built DEX swap. Two payload shapes (see backend
    // adapters): Relay sends the exact /wallet/triggersmartcontract body
    // ({parameter, type}); LI.FI sends a pre-built protobuf raw_data as
    // '0x' hex, whose txID is sha256(raw_data).
    swap: async ({swapData, from, privateKey}) =>
      retryFunc(async tronWeb => {
        const updatePrivateKey = removeSubstringFromPrivateKey(privateKey);
        let transaction;
        if (swapData?.type === 'TriggerSmartContract' && swapData?.parameter) {
          const parameter = swapData.parameter;
          await simulateTronSwapOrThrow(tronWeb, parameter);
          const resp = await tronWeb.fullNode.request(
            'wallet/triggersmartcontract',
            {
              owner_address: parameter.owner_address,
              contract_address: parameter.contract_address,
              data: parameter.data,
              call_value: parameter.call_value || 0,
              fee_limit: 1000000000,
            },
            'post',
          );
          if (!resp?.transaction) {
            const message = resp?.result?.message
              ? tronWeb.toUtf8(resp.result.message)
              : 'Tron swap transaction build failed';
            throw new Error(message);
          }
          transaction = resp.transaction;
        } else if (
          typeof swapData?.data === 'string' &&
          swapData.data.startsWith('0x')
        ) {
          // Pre-built protobuf raw_data (LI.FI). trx.sign() can't handle it —
          // its txCheck requires JSON raw_data.contract — so sign the txID
          // directly and broadcast the framed protobuf via wallet/broadcasthex.
          const rawDataHex = swapData.data.slice(2);
          let decodedExpiration = null;
          let decodedContractValue = null;
          try {
            const decoded = tronWeb.utils.deserializeTx.deserializeTransaction(
              'TriggerSmartContract',
              rawDataHex,
            );
            decodedExpiration = decoded?.expiration;
            decodedContractValue = decoded?.contract?.[0]?.parameter?.value;
          } catch (e) {
            // A decoder failure must not fake an "expired" quote — fall
            // through and let the node judge the raw transaction.
            console.error('Tron swap raw_data decode failed', e);
          }
          // The provider baked a hard expiration (~60s) into raw_data; the
          // node rejects anything past it, so fail with the shared error
          // before signing. 5s margin covers broadcast latency.
          if (
            decodedExpiration &&
            Date.now() >= Number(decodedExpiration) - 5000
          ) {
            throw new Error(SWAP_QUOTE_EXPIRED_ERROR);
          }
          if (
            decodedContractValue?.contract_address &&
            decodedContractValue?.data
          ) {
            await simulateTronSwapOrThrow(tronWeb, decodedContractValue);
          }
          const txID = sha256('0x' + rawDataHex).slice(2);
          const signature = tronWeb.utils.crypto.ECKeySign(
            tronWeb.utils.code.hexStr2byteArray(txID),
            tronWeb.utils.code.hexStr2byteArray(updatePrivateKey),
          );
          const signedHex = encodeSignedTronTxHex(rawDataHex, signature);
          const broadcast = await tronWeb.trx.sendHexTransaction(signedHex);
          if (!broadcast?.result && !broadcast?.txid) {
            const message = broadcast?.message
              ? tronWeb.toUtf8(broadcast.message)
              : broadcast?.code || 'Tron swap broadcast failed';
            throw new Error(message);
          }
          return {...broadcast, txid: broadcast?.txid || txID};
        } else {
          throw new Error('Unsupported Tron swap payload');
        }
        const signedTx = await tronWeb.trx.sign(transaction, updatePrivateKey);
        const broadcast = await tronWeb.trx.sendRawTransaction(signedTx);
        if (!broadcast?.result && !broadcast?.txid) {
          const message = broadcast?.message
            ? tronWeb.toUtf8(broadcast.message)
            : broadcast?.code || 'Tron swap broadcast failed';
          throw new Error(message);
        }
        return {...broadcast, txid: broadcast?.txid || signedTx?.txID};
      }, null),
    getEstimateSwapFee: async ({swapData, fromAddress}) =>
      retryFunc(async tronWeb => {
        const {transactionFee, energyFee} = await getChainData(tronWeb);
        const {bandwidth: availableBandwidth, energy: currentAccountEnergy} =
          await getAccountResourcesData(tronWeb, fromAddress);
        let totalFee = 0;
        if (swapData?.type === 'TriggerSmartContract' && swapData?.parameter) {
          const parameter = swapData.parameter;
          const resp = await tronWeb.fullNode.request(
            'wallet/triggerconstantcontract',
            {
              owner_address: parameter.owner_address,
              contract_address: parameter.contract_address,
              data: parameter.data,
              call_value: parameter.call_value || 0,
            },
            'post',
          );
          const energyUsed = resp?.energy_used || 0;
          const energyRequired = currentAccountEnergy - energyUsed;
          if (energyRequired < 0) {
            totalFee += Math.abs(energyRequired) * energyFee;
          }
          const rawHexLength = resp?.transaction?.raw_data_hex?.length || 1000;
          totalFee += calculateBandwidth(
            {raw_data_hex: ''.padEnd(rawHexLength, '0'), signature: ['']},
            availableBandwidth,
            transactionFee,
            true,
          );
        } else if (typeof swapData?.data === 'string') {
          // Pre-built raw_data (LI.FI): decode the inner TriggerSmartContract
          // and simulate it — the provider's estimatedFee doesn't reflect
          // actual energy consumption and caused on-chain OUT_OF_ENERGY.
          const rawHex = swapData.data.replace(/^0x/, '');
          let simulated = false;
          try {
            const decoded = tronWeb.utils.deserializeTx.deserializeTransaction(
              'TriggerSmartContract',
              rawHex,
            );
            const value = decoded?.contract?.[0]?.parameter?.value;
            if (value?.contract_address && value?.data) {
              const resp = await tronWeb.fullNode.request(
                'wallet/triggerconstantcontract',
                {
                  owner_address: value.owner_address,
                  contract_address: value.contract_address,
                  data: value.data,
                  call_value: value.call_value || 0,
                },
                'post',
              );
              const energyUsed = resp?.energy_used || 0;
              if (energyUsed > 0) {
                const energyRequired = currentAccountEnergy - energyUsed;
                if (energyRequired < 0) {
                  totalFee += Math.abs(energyRequired) * energyFee;
                }
                simulated = true;
              }
            }
          } catch (e) {
            console.error('Tron swap fee simulation failed', e);
          }
          if (!simulated) {
            // Fallback: provider's own estimate (sun)
            totalFee += Number(swapData.estimatedFee || 0);
          }
          totalFee += calculateBandwidth(
            {raw_data_hex: rawHex, signature: ['']},
            availableBandwidth,
            transactionFee,
            true,
          );
        } else {
          throw new Error('Unsupported Tron swap payload');
        }
        return {
          fee: tronWeb.fromSun(totalFee?.toString()),
          gasFee: null,
          estimateGas: null,
          nonce: null,
        };
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
