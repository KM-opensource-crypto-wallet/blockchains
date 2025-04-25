import {selectCurrentCoin} from 'dok-wallet-blockchain-networks/redux/wallets/walletsSelector';
import {validateNumber} from 'dok-wallet-blockchain-networks/helper';

export const getStakingLoading = state => state.staking.loading;
export const getStakingError = state => state.staking.error;
export const getStakingValidatorsByChain = state => {
  const validators = state.staking.validators;
  const currentCoin = selectCurrentCoin(state);
  return validators[currentCoin?.chain_name] || [];
};

export const getSelectedVotes = state => {
  return state.staking.selectedVotes;
};

export const countSelectedVotes = state => {
  const selectedVotes = getSelectedVotes(state);
  const allVotes = selectedVotes ? Object.values(selectedVotes) : [];
  let totalNumber = 0;
  allVotes.forEach(item => {
    const number = validateNumber(item) || 0;
    totalNumber += number;
  });
  return totalNumber;
};
