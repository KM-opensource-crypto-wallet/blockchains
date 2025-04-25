import {fetchFeesInfo} from 'dok-wallet-blockchain-networks/service/dokApi';
import {isValidObject} from 'dok-wallet-blockchain-networks/helper';
import dayjs from 'dayjs';

let lastCallTimeStamp;

let feesInfo = {
  maxPriorityFee: {
    optimism_binance_smart_chain: {
      testnet: 1001,
      mainnet: 1001,
    },
  },
  multiplier: {
    ethereum: {
      testnet: 1.3,
      mainnet: 1.3,
    },
    polygon: {
      testnet: 1.3,
      mainnet: 1.3,
    },
  },
};

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
    feesInfo = {
      multiplier: {
        ...feesInfo.multiplier,
        ...tempMultiplier,
      },
      maxPriorityFee: {
        ...feesInfo.maxPriorityFee,
        ...tempMaxPriorityFee,
      },
    };
  } catch (e) {
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
