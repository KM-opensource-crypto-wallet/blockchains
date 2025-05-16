import {
  generateUniqueKeyForChain,
  isBitcoinChain,
} from 'dok-wallet-blockchain-networks/helper';
import {getTransferData} from 'dok-wallet-blockchain-networks/redux/currentTransfer/currentTransferSelector';
import {createSelector} from '@reduxjs/toolkit';

export const selectAllWallets = state => {
  return state.wallets?.allWallets;
};

export const selectAllWalletName = state => {
  const allWallets = state.wallets?.allWallets;
  return allWallets.map(item => item?.walletName);
};

export const getSelectedNftChain = state => {
  const allWallets = state.wallets?.allWallets;
  const currentWalletIndex = state?.wallets?.currentWalletIndex;
  const selectedWallet = allWallets[currentWalletIndex];
  return selectedWallet?.selectedNftChain || 'Ethereum';
};

export const getSelectedNftData = state => {
  const allWallets = state.wallets?.allWallets;
  const currentWalletIndex = state?.wallets?.currentWalletIndex;
  const selectedWallet = allWallets[currentWalletIndex];
  const selectedNftChain = selectedWallet?.selectedNftChain || 'Ethereum';
  const nft = selectedWallet?.nft || {};
  return nft[`${selectedNftChain}_data`] || [];
};

export const getSelectedNftLoading = state => {
  const allWallets = state.wallets?.allWallets;
  const currentWalletIndex = state?.wallets?.currentWalletIndex;
  const selectedWallet = allWallets[currentWalletIndex];
  const selectedNftChain = selectedWallet?.selectedNftChain || 'Ethereum';
  const nft = selectedWallet?.nft || {};
  return nft[`${selectedNftChain}_loading`] || false;
};

export const getSelectedNftAvailable = state => {
  const allWallets = state.wallets?.allWallets;
  const currentWalletIndex = state?.wallets?.currentWalletIndex;
  const selectedWallet = allWallets[currentWalletIndex];
  const selectedNftChain = selectedWallet?.selectedNftChain || 'Ethereum';
  const nft = selectedWallet?.nft || {};
  return nft[`${selectedNftChain}_available`] || false;
};

export const getSelectedNft = state => {
  const allWallets = state.wallets?.allWallets;
  const currentWalletIndex = state?.wallets?.currentWalletIndex;
  const selectedWallet = allWallets[currentWalletIndex];
  return selectedWallet?.selectedNft || {};
};

export const selectCurrentWallet = state => {
  const allWallets = state.wallets?.allWallets;
  const currentWalletIndex = state.wallets?.currentWalletIndex;
  return allWallets[currentWalletIndex] || null;
};

export const isImportWalletWithPrivateKey = state => {
  const allWallets = state.wallets?.allWallets;
  const currentWalletIndex = state.wallets.currentWalletIndex;
  const currentWallet = allWallets[currentWalletIndex] || null;
  return !!currentWallet?.isImportWalletWithPrivateKey;
};

export const selectWalletChainName = state => {
  const allWallets = state.wallets?.allWallets;
  const currentWalletIndex = state.wallets.currentWalletIndex;
  const currentWallet = allWallets[currentWalletIndex] || null;
  return currentWallet?.chain_name;
};

export const selectCoinsForCurrentWallet = state => {
  const currentWallet = selectCurrentWallet(state);
  return currentWallet?.coins || [];
};

// Select coins in the wallet
export const selectUserCoins = state => {
  const coins = selectCoinsForCurrentWallet(state);
  return coins.filter(coin => coin?.isInWallet);
};

export const selectAllCoinSymbol = state => {
  const coins = selectCoinsForCurrentWallet(state);
  return coins.map(item => generateUniqueKeyForChain(item));
};

export const selectAllCoinWithIsInWalletSymbol = state => {
  const coins = selectCoinsForCurrentWallet(state);
  return coins.reduce(
    (obj, item) =>
      Object.assign(obj, {[generateUniqueKeyForChain(item)]: item?.isInWallet}),
    {},
  );
};

export const checkIsNativeCoinAvailable = state => {
  const currentCoin = selectCurrentCoin(state);
  const allCoins = selectUserCoins(state);
  if (currentCoin?.type === 'token') {
    return !!allCoins.find(
      item =>
        item.symbol === currentCoin?.chain_symbol &&
        item.chain_name === currentCoin?.chain_name,
    );
  } else {
    return true;
  }
};

export const countTotalAssets = state => {
  const coins = selectCoinsForCurrentWallet(state);
  let totalAsset = 0;
  coins.forEach(coin => {
    if (coin?.isInWallet) {
      const totalCourseNumber = isNaN(Number(coin.totalCourse))
        ? 0
        : Number(coin.totalCourse);
      totalAsset += totalCourseNumber;
    }
  });
  return totalAsset.toFixed(2);
};

export const getBalanceForNativeCoin = state => {
  const transferData = getTransferData(state);
  const currentCoin = transferData?.currentCoin;
  let amount;
  if (currentCoin?.type === 'token') {
    const allCoins = selectUserCoins(state);
    const foundNativeCoin = allCoins.find(
      item =>
        item.symbol === currentCoin?.chain_symbol &&
        item.chain_name === currentCoin?.chain_name,
    );
    amount = foundNativeCoin?.totalAmount || 0;
  } else {
    amount = currentCoin?.totalAmount;
  }
  return amount || 0;
};
// Select supported coins not in the wallet
export const selectOtherCoins = state => {
  const coins = selectCoinsForCurrentWallet(state);
  return coins.filter(coin => !coin?.isInWallet);
};

export const selectAllCoins = state => {
  return selectCoinsForCurrentWallet(state);
};

export const selectAllCoinsAcrossWallet = state => {
  const allWallets = state.wallets?.allWallets;
  let allCoins = [];
  allWallets.forEach(item => {
    if (Array.isArray(item.coins)) {
      allCoins = [...allCoins, ...item.coins];
    }
  });
  return allCoins;
};

export const selectAllCoinsWalletByMnemonic = state => {
  const allWallets = Array.isArray(state.wallets?.allWallets)
    ? state.wallets?.allWallets
    : [];
  for (let item of allWallets) {
    if (Array.isArray(item.coins) && item.phrase) {
      return item.coins;
    }
  }
  return [];
};

export const getCoinsOptions = createSelector(
  [selectAllWallets],
  allWallets => {
    const alreadyIncluded = [];
    const dropDownData = [];

    for (let i = 0; i < allWallets.length; i++) {
      const tempWallet = allWallets[i];
      const allCoins = tempWallet?.coins;
      for (let j = 0; j < allCoins?.length; j++) {
        const currentCoin = allCoins[j];
        const key = currentCoin?.chain_name + '_' + currentCoin.symbol;
        if (!currentCoin?.isInWallet || alreadyIncluded.includes(key)) {
          continue;
        }
        alreadyIncluded.push(key);
        dropDownData.push({
          value: `${currentCoin?.chain_name}_${currentCoin.symbol}`,
          options: {
            title: currentCoin.name,
            symbol: currentCoin.symbol,
            decimal: currentCoin.decimal,
            currencyRate: currentCoin.currencyRate,
            chain_symbol: currentCoin.chain_symbol,
            contract_address: currentCoin.contractAddress,
            icon: currentCoin.icon,
            chain_name: currentCoin?.chain_name,
            chain_display_name:
              currentCoin.type === 'token' ||
              isBitcoinChain(currentCoin?.chain_name)
                ? currentCoin?.chain_display_name
                : '',
          },
          label: currentCoin.name,
        });
      }
    }
    return dropDownData;
  },
);

export const getUserCoinsOptions = createSelector(
  [selectCurrentWallet],
  currentWallet => {
    const alreadyIncluded = [];
    const dropDownData = [];

    const allCoins = currentWallet?.coins;
    for (let j = 0; j < allCoins?.length; j++) {
      const currentCoin = allCoins[j];
      const key = currentCoin?.chain_name + '_' + currentCoin.symbol;
      if (alreadyIncluded.includes(key) || !currentCoin?.isInWallet) {
        continue;
      }
      alreadyIncluded.push(key);
      dropDownData.push({
        value: `${currentCoin?.chain_name}_${currentCoin.symbol}`,
        options: {
          title: currentCoin.name,
          decimal: currentCoin.decimal,
          currencyRate: currentCoin.currencyRate,
          symbol: currentCoin.symbol,
          icon: currentCoin?.icon,
          walletAddress: currentCoin?.address,
          type: currentCoin?.type,
          chain_name: currentCoin?.chain_name,
          chain_display_name:
            currentCoin.type === 'token' ||
            isBitcoinChain(currentCoin?.chain_name)
              ? currentCoin?.chain_display_name
              : '',
          displayTitle: `${currentCoin.symbol} (${currentCoin?.chain_display_name})`,
        },
        label: currentCoin.name,
      });
    }
    return dropDownData;
  },
);

export const selectCurrentCoin = state => {
  const currentWallet = selectCurrentWallet(state);
  const selectedCoinId = currentWallet?.selectedCoin;
  const selectedCoin = currentWallet?.coins?.find(
    item => item?._id === selectedCoinId,
  );
  if (!selectedCoin) {
    return null;
  }
  return selectedCoin;
};

export const selectAllWalletConnectSessions = state => {
  const allWallets = state.wallets.allWallets;
  let sessionObj = {};
  allWallets.forEach(item => {
    const session = item.session || {};
    sessionObj = {...sessionObj, ...session};
  });
  return sessionObj;
};

export const selectWalletConnectSessions = state => {
  const currentWallet = selectCurrentWallet(state);
  return currentWallet?.session || {};
};

export const selectWalletConnectData = state => {
  const allWallets = state.wallets.allWallets;
  let walletObj = {};
  allWallets.forEach(item => {
    const walletData = item.walletData || {};
    walletObj = {...walletObj, ...walletData};
  });
  return walletObj;
};

export const selectIsBackedUp = state => {
  const currentWallet = selectCurrentWallet(state);
  return !!currentWallet?.isBackedup;
};

export const _currentWalletIndexSelector = state => {
  return state.wallets.currentWalletIndex;
};

export const getCurrentWalletPhrase = state => {
  const allWallets = state.wallets?.allWallets;
  const currentWalletIndex = state.wallets.currentWalletIndex;
  return allWallets[currentWalletIndex]?.phrase;
};

export const getCurrentWalletIsAddMoreAddressPopupHidden = state => {
  const allWallets = state.wallets?.allWallets;
  const currentWalletIndex = state.wallets.currentWalletIndex;
  return allWallets[currentWalletIndex]?.isAddMoreAddressPopupHidden;
};

export const foundCoinInCurrentWallet = (currentWallet, page) => {
  const foundCoin = currentWallet?.coins?.find(item => item.page === page);
  return foundCoin || null;
};

export const getEthereumCoin = state => {
  const allCoins = selectUserCoins(state);
  return (
    allCoins?.find(
      item => item?.chain_name === 'ethereum' && item?.type === 'coin',
    ) || {}
  );
};

export const getCurrentWalletIndex = state => {
  return state?.wallets?.currentWalletIndex;
};

export const getPendingTransactions = state => {
  return state?.wallets?.pendingTransactions || {};
};

export const getPendingTransactionsWithKey = (pendingTransactions, key) => {
  return Array.isArray(pendingTransactions[key])
    ? pendingTransactions[key]
    : [];
};

export const isAdding50MoreAddresses = state => {
  const allWallets = state.wallets?.allWallets;
  const currentWalletIndex = state.wallets.currentWalletIndex;
  return allWallets?.[currentWalletIndex]?.isAdding50MoreAddresses;
};

export const getMasterClientId = state => {
  return state.wallets?.masterClientId;
};
