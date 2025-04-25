import {STAKE_WIZ_API} from 'dok-wallet-blockchain-networks/config/stakeWiz';
import dayjs from 'dayjs';

let validatorsData;
let lastCallTimeStamp;
export const StakeWiz = {
  getListOfValidator: async () => {
    try {
      if (
        !validatorsData ||
        !lastCallTimeStamp ||
        dayjs().diff(dayjs(lastCallTimeStamp), 'minutes') > 5
      ) {
        lastCallTimeStamp = new Date();
        const resp = await STAKE_WIZ_API.get('/validators');
        validatorsData = resp?.data;
      }
      return {status: 200, data: validatorsData};
    } catch (e) {
      console.error('Error in get getListOfValidator in stakeWiz', e);
      throw e;
    }
  },
};
