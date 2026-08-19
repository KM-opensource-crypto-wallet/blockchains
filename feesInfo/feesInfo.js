import {fetchFeesInfo} from 'dok-wallet-blockchain-networks/service/dokApi';
import {isValidObject} from 'dok-wallet-blockchain-networks/helper';
import dayjs from 'dayjs';
import {
  CHAIN_CONFIG,
  IS_SANDBOX,
} from 'dok-wallet-blockchain-networks/config/config';

let lastCallTimeStamp;

const feesInfoFromChainConfig = category =>
  Object.fromEntries(
    Object.entries(CHAIN_CONFIG)
      .filter(([, chainConfig]) => chainConfig.fees_info?.[category])
      .map(([chain_name, chainConfig]) => [
        chain_name,
        chainConfig.fees_info[category],
      ]),
  );

let feesInfo = {
  maxPriorityFee: {...feesInfoFromChainConfig('max_priority_fee')},
  multiplier: {...feesInfoFromChainConfig('multiplier')},
};

function extractFeesInfo(feesObj, isSandbox) {
  const finalFeesInfoObj = {};
  const text = isSandbox ? 'testnet' : 'mainnet';
  for (let key of Object.keys(feesObj)) {
    finalFeesInfoObj[key] = feesObj[key]?.[text];
  }
  return finalFeesInfoObj;
}

export const getFeesInfo = async () => {
  try {
    if (
      lastCallTimeStamp &&
      dayjs().diff(dayjs(lastCallTimeStamp), 'hours') < 8
    ) {
      throw new Error('fees info not called due to time-limit');
    }
    lastCallTimeStamp = dayjs();
    const resp = await fetchFeesInfo();
    const data = isValidObject(resp?.data) ? resp?.data : {};
    const tempMaxPriorityFee = isValidObject(data?.maxPriorityFee)
      ? data?.maxPriorityFee
      : {};
    const tempMultiplier = isValidObject(data?.multiplier)
      ? data?.multiplier
      : {};
    const localFeesInfoMultiplier = extractFeesInfo(
      feesInfo.multiplier,
      IS_SANDBOX,
    );
    const localFeesInfoMaxPriorityFee = extractFeesInfo(
      feesInfo.maxPriorityFee,
      IS_SANDBOX,
    );
    feesInfo = {
      multiplier: {
        ...localFeesInfoMultiplier,
        ...tempMultiplier,
      },
      maxPriorityFee: {
        ...localFeesInfoMaxPriorityFee,
        ...tempMaxPriorityFee,
      },
    };
  } catch (e) {
    const localFeesInfoMultiplier = extractFeesInfo(
      feesInfo.multiplier,
      IS_SANDBOX,
    );
    const localFeesInfoMaxPriorityFee = extractFeesInfo(
      feesInfo.maxPriorityFee,
      IS_SANDBOX,
    );
    feesInfo = {
      multiplier: localFeesInfoMultiplier,
      maxPriorityFee: localFeesInfoMaxPriorityFee,
    };
    console.error('Error in fetchFeesInfo', e);
  }
};

export const getFeesMultiplier = chain_name => {
  const multiplier = feesInfo?.multiplier;
  return multiplier[chain_name] || 1;
};

export const getMaxPriorityFee = chain_name => {
  const maxPriorityFee = feesInfo?.maxPriorityFee;
  return maxPriorityFee[chain_name] || null;
};
