import {
  isAddressOrPrivateKeyExists,
  isBitcoinChain,
  mergeUniqueAccounts,
  validateSupportedChain,
} from 'dok-wallet-blockchain-networks/helper';
import {
  CHAIN_CONFIG,
  IS_SANDBOX,
} from 'dok-wallet-blockchain-networks/config/config';
import {createWallet} from 'myWallet/wallet.service';
import {APP_VERSION} from 'utils/common';

const loadEVMChain = () => require('./chains/EVMChain').EVMChain;
const loadBitcoinChain = () => require('./chains/BitcoinChain').BitcoinChain;
const loadDogecoinOrLitecoinChain = () =>
  require('./chains/DogecoinOrLitecoinChain').DogecoinOrLitecoinChain;
const loadBitcoinLightningChain = () =>
  require('./chains/BitcoinLightningChain').BitcoinLightningChain;
const loadTronChain = () => require('./chains/TronChain').TronChain;
const loadSolanaChain = () => require('./chains/SolanaChain').SolanaChain;
const loadStellarChain = () => require('./chains/StellarChain').StellarChain;
const loadRippleChain = () => require('./chains/RippleChain').RippleChain;
const loadThorChain = () => require('./chains/ThorChain').ThorChain;
const loadTezosChain = () => require('./chains/TezosChain').TezosChain;
const loadCosmosChain = () => require('./chains/CosmosChain').CosmosChain;
const loadPolkadotChain = () => require('./chains/PolkadotChain').PolkadotChain;
const loadTonChain = () => require('./chains/TonChain').TonChain;
const loadAptosChain = () => require('./chains/AptosChain').AptosChain;
const loadHederaChain = () => require('./chains/HederaChain').HederaChain;
const loadCardanoChain = () => require('./chains/CardanoChain').CardanoChain;
const loadFilecoinChain = () => require('./chains/FilecoinChain').FilecoinChain;

const CHAIN_LOADERS = {
  evm: loadEVMChain,
  bitcoin: loadBitcoinChain,
  doge_ltc: loadDogecoinOrLitecoinChain,
  lightning: loadBitcoinLightningChain,
  tron: loadTronChain,
  solana: loadSolanaChain,
  stellar: loadStellarChain,
  ripple: loadRippleChain,
  thorchain: loadThorChain,
  tezos: loadTezosChain,
  cosmos: loadCosmosChain,
  polkadot: loadPolkadotChain,
  ton: loadTonChain,
  aptos: loadAptosChain,
  hedera: loadHederaChain,
  cardano: loadCardanoChain,
  filecoin: loadFilecoinChain,
};

const chainLoaders = Object.fromEntries(
  Object.entries(CHAIN_CONFIG)
    .filter(([, chainConfig]) => chainConfig.chain_loader)
    .map(([chain_name, chainConfig]) => [
      chain_name,
      CHAIN_LOADERS[chainConfig.chain_loader],
    ]),
);

export const getChain = (chain, phrase, customRpcUrl) => {
  const loadChain = chainLoaders[chain];
  return loadChain ? loadChain()(chain, phrase, customRpcUrl) : undefined;
};

const resolveWallet = async ({phrase, walletData, coin, customRpcUrl}) => {
  const chainName = coin?.chain_name;

  const chainNameForNative = validateSupportedChain(chainName);
  if (!chainNameForNative) {
    return {wallet: null, chain: null};
  }
  let wallet = null;
  const chain = getChain(chainName, phrase, customRpcUrl);
  const chain_existing_coin =
    walletData?.chain_existing_coin?.[chainNameForNative];
  if (isAddressOrPrivateKeyExists(coin)) {
    wallet = {
      privateKey: coin?.privateKey,
      address: coin?.address,
      accountId: coin?.accountId,
      publicKey: coin?.publicKey,
      extendedPublicKey: coin?.extendedPublicKey,
      extendedPrivateKey: coin?.extendedPrivateKey,
    };
  } else if (
    chain_existing_coin &&
    !(isBitcoinChain(chainName) && APP_VERSION !== coin.appVersion)
  ) {
    wallet = {
      privateKey: chain_existing_coin.privateKey,
      address: chain_existing_coin.address,
      accountId: chain_existing_coin.accountId,
      publicKey: chain_existing_coin.publicKey,
      extendedPublicKey: chain_existing_coin.extendedPublicKey,
      extendedPrivateKey: chain_existing_coin.extendedPrivateKey,
    };
  } else if (phrase && chainName === 'bitcoin_lightning') {
    const BitcoinLightningChain = loadBitcoinLightningChain();
    wallet = await BitcoinLightningChain(
      chainName,
      phrase,
    ).generateSparkAddress();
  } else if (phrase && chainName === 'stellar') {
    const StellarChain = loadStellarChain();
    wallet = StellarChain().createStellarWallet({mnemonic: phrase});
  } else if (phrase && chainName === 'hedera') {
    const HederaChain = loadHederaChain();
    wallet = await HederaChain().createHederaWallet({mnemonic: phrase});
  } else if (phrase) {
    wallet = await createWallet(chainNameForNative, phrase, IS_SANDBOX);
    wallet.isNew = true;
  } else if (walletData?.privateKey && !walletData?.address) {
    wallet = await chain.createWalletByPrivateKey({
      chain_name: chainName,
      privateKey: walletData?.privateKey,
    });
  } else if (walletData?.privateKey && walletData?.address) {
    wallet = {
      privateKey: walletData?.privateKey,
      address: walletData?.address,
    };
  }
  if (wallet && chainName === 'hedera' && chain?.attachAccountId) {
    // Adds `accountId` (0.0.N) once the ledger has created the account; the
    // stored address stays the EVM address.
    wallet = await chain.attachAccountId(wallet);
  }
  return {wallet, chain};
};

export const getCoin = async (
  phrase,
  coin,
  transactionFee,
  walletData,
  customRpcUrl,
) => {
  const {wallet, chain} = await resolveWallet({
    phrase,
    coin,
    walletData,
    customRpcUrl,
  });
  if (!chain) {
    throw new Error('chain not found');
  }
  if (!wallet) {
    throw new Error('getCoin condition not found');
  }

  if (coin?.type === 'token' && coin.contractAddress) {
    return await getTokenCoin(chain, wallet, coin, transactionFee);
  } else {
    return await getBaseCoin(chain, wallet, coin, walletData);
  }
};

const getBaseCoin = async (chain, wallet, coin, walletData) => {
  // Prefer coin's stored deriveAddresses (from Redux); fall back to native wallet result
  const effectiveDeriveAddresses = wallet?.isNew
    ? mergeUniqueAccounts(coin?.deriveAddresses, wallet?.deriveAddresses)
    : coin?.deriveAddresses;

  const coinWrapper = {
    type: 'coin',
    wallet,
    address: wallet.address,
    accountId: wallet.accountId,
    privateKey: wallet.privateKey,
    publicKey: wallet.publicKey,
    extendedPublicKey: wallet.extendedPublicKey,
    extendedPrivateKey: wallet.extendedPrivateKey,
    deriveAddresses: effectiveDeriveAddresses,
    chain,
    getBalance: async () =>
      chain?.getBalance({
        address: wallet.address,
        extendedPublicKey: wallet.extendedPublicKey,
        deriveAddresses: effectiveDeriveAddresses,
        chain_name: coin?.chain_name,
        isLegacyScanDone: !!(
          coin?.isLegacyScanDone || walletData?.isLegacyFree
        ),
      }),
    getStakingBalance: async () =>
      await chain.getStakingBalance({
        address: wallet.address,
      }),
    getStakingValidators: async payload =>
      await chain.getStakingValidators({address: wallet.address, ...payload}),
    getStaking: async () =>
      await chain?.getStaking({
        address: wallet.address,
      }),
    getStakingInfo: async payload =>
      await chain?.getStakingInfo({
        address: wallet.address,
        ...payload,
      }),
    getEstimateFeeForStaking: async payload =>
      await chain?.getEstimateFeeForStaking({
        fromAddress: wallet.address,
        ...payload,
        privateKey: wallet.privateKey,
      }),
    estimateFeesForStakeValidators: async payload =>
      await chain?.estimateFeesForStakeValidators({
        fromAddress: wallet.address,
        ...payload,
        privateKey: wallet.privateKey,
      }),
    getEstimateFeeForWithdrawStaking: async payload =>
      await chain?.getEstimateFeeForWithdrawStaking({
        fromAddress: wallet.address,
        privateKey: wallet.privateKey,
        ...payload,
      }),
    getEstimateFeeForStakingRewards: async payload =>
      await chain?.getEstimateFeeForStakingRewards({
        fromAddress: wallet.address,
        privateKey: wallet.privateKey,
        ...payload,
      }),
    getEstimateFeeForDeactivateStaking: async payload =>
      await chain?.getEstimateFeeForDeactivateStaking({
        fromAddress: wallet.address,
        privateKey: wallet.privateKey,
        ...payload,
      }),
    getEstimateFeeForPendingTransaction: async payload =>
      await chain?.getEstimateFeeForPendingTransaction({
        fromAddress: wallet.address,
        privateKey: wallet.privateKey,
        ...payload,
      }),
    getUTXOs: async () =>
      await chain.getUTXOs({
        deriveAddresses: effectiveDeriveAddresses,
      }),
    send: async payload =>
      await chain.send({
        from: wallet.address,
        privateKey: wallet.privateKey,
        chain_name: coin?.chain_name,
        publicKey: coin?.publicKey,
        deriveAddresses: effectiveDeriveAddresses,
        extendedPrivateKey:
          wallet.extendedPrivateKey || coin?.extendedPrivateKey,
        ...payload,
      }),
    cancelTransaction: async payload =>
      await chain.cancelTransaction({
        from: wallet.address,
        privateKey: wallet.privateKey,
        chain_name: coin?.chain_name,
        publicKey: coin?.publicKey,
        deriveAddresses: effectiveDeriveAddresses,
        extendedPrivateKey:
          wallet.extendedPrivateKey || coin?.extendedPrivateKey,
        ...payload,
      }),
    accelerateTransaction: async payload =>
      await chain.accelerateTransaction({
        from: wallet.address,
        privateKey: wallet.privateKey,
        chain_name: coin?.chain_name,
        publicKey: coin?.publicKey,
        deriveAddresses: effectiveDeriveAddresses,
        extendedPrivateKey:
          wallet.extendedPrivateKey || coin?.extendedPrivateKey,
        ...payload,
      }),

    getEstimateFee: async payload =>
      await chain.getEstimateFee({
        ...payload,
        minimumBalance: coin?.minimumBalance,
        privateKey: wallet.privateKey,
        chain_name: coin?.chain_name,
        deriveAddresses: effectiveDeriveAddresses,
        extendedPrivateKey:
          wallet.extendedPrivateKey || coin?.extendedPrivateKey,
      }),
    waitForConfirmation: chain?.waitForConfirmation,
    getTransactions: async payload =>
      await chain?.getTransactions({
        address: wallet.address,
        ...payload,
      }),
    getTransaction: async payload =>
      await chain?.getTransaction({
        address: wallet.address,
        deriveAddresses: effectiveDeriveAddresses,
        ...payload,
      }),
    getTransactionForUpdate: async payload =>
      await chain?.getTransactionForUpdate({
        from: wallet.address,
        decimals: coin.decimal,
        ...payload,
      }),
    isValidAddress: ({address}) => chain?.isValidAddress({address}),
    getNFTEstimateFee: async payload =>
      await chain.getEstimateFeeForNFT({
        ...payload,
        privateKey: wallet.privateKey,
      }),
    sendNFT: async payload =>
      await chain.sendNFT({
        ...payload,
        privateKey: wallet.privateKey,
      }),
    createCall: async payload =>
      await chain.createCall({
        ...payload,
        fromAddress: wallet.address,
      }),
    createStaking: async payload =>
      await chain.createStaking({
        ...payload,
        privateKey: wallet.privateKey,
      }),
    createStakingWithValidator: async payload =>
      await chain.createStakingWithValidator({
        ...payload,
        privateKey: wallet.privateKey,
      }),
    withdrawStaking: async payload =>
      await chain.withdrawStaking({
        ...payload,
        privateKey: wallet.privateKey,
      }),
    stakingRewards: async payload =>
      await chain.stakingRewards({
        ...payload,
        privateKey: wallet.privateKey,
      }),
    deactivateStaking: async payload =>
      await chain.deactivateStaking({
        ...payload,
        privateKey: wallet.privateKey,
        from: wallet.address,
      }),
    getEstimateFeeForBatchTransaction: async payload =>
      await chain.getEstimateFeeForBatchTransaction({
        ...payload,
        privateKey: wallet.privateKey,
        from: wallet.address,
      }),
    sendBatchTransaction: async payload =>
      await chain.sendBatchTransaction({
        ...payload,
        privateKey: wallet.privateKey,
        from: wallet.address,
      }),
    unClaimedOnChainDeposit: async () => await chain.unClaimedOnChainDeposit(),
    approveClaimDeposit: async payload =>
      await chain.approveClaimDeposit(payload),
    rejectClaimDeposit: async payload =>
      await chain.rejectClaimDeposit(payload),
    checkDelegation: async () =>
      await chain.checkDelegation?.({address: wallet.address}),
    revokeDelegation: async () =>
      await chain.revokeDelegation?.({privateKey: wallet.privateKey}),
    // A DEX quote must never fall through to a plain transfer — there is no
    // real deposit address behind swapData — so a chain without swap support
    // fails loudly instead of a bare "not a function" TypeError.
    swap: async payload => {
      if (typeof chain.swap !== 'function') {
        throw new Error(
          `Swaps are not supported on ${coin?.chain_name || 'this chain'} yet`,
        );
      }
      return await chain.swap({
        from: wallet.address,
        privateKey: wallet.privateKey,
        ...payload,
      });
    },
    getEstimateSwapFee: async payload => {
      if (typeof chain.getEstimateSwapFee !== 'function') {
        throw new Error(
          `Swaps are not supported on ${coin?.chain_name || 'this chain'} yet`,
        );
      }
      return await chain.getEstimateSwapFee({
        fromAddress: wallet.address,
        ...payload,
      });
    },
    checkAndApproveSwap: async payload =>
      await chain.checkAndApproveSwap({
        from: wallet.address,
        privateKey: wallet.privateKey,
        ...payload,
      }),
    approve: async payload =>
      await chain.approve({
        from: wallet.address,
        privateKey: wallet.privateKey,
        ...payload,
      }),
  };

  return coinWrapper;
};

const getTokenCoin = async (chain, wallet, token, transactionFee) => {
  const coinWrapper = {
    type: 'token',
    wallet,
    address: wallet.address,
    accountId: wallet.accountId,
    privateKey: wallet.privateKey,
    publicKey: wallet.publicKey,
    extendedPublicKey: wallet.extendedPublicKey,
    extendedPrivateKey: wallet.extendedPrivateKey,
    chain,
    getBalance: async () =>
      await chain.getTokenBalance({
        address: wallet.address,
        contractAddress: token?.contractAddress,
        decimal: token.decimal,
        symbol: token.symbol,
      }),
    getStakingBalance: async () =>
      await chain.getStakingBalance({
        address: wallet.address,
        contractAddress: token.contractAddress,
        symbol: token.symbol,
      }),

    getStaking: async () =>
      await chain?.getStaking({
        address: wallet.address,
        contractAddress: token?.contractAddress,
        tokenDecimals: token?.decimal,
      }),
    getStakingValidators: async payload =>
      await chain.getStakingValidators({address: wallet.address, ...payload}),
    getStakingInfo: async payload =>
      await chain?.getStakingInfo({
        address: wallet.address,
        symbol: token?.symbol,
        ...payload,
      }),
    getEstimateFeeForStaking: async payload =>
      await chain?.getEstimateFeeForStaking({
        fromAddress: wallet.address,
        contractAddress: token.contractAddress,
        decimals: token.decimal,
        ...payload,
        privateKey: wallet.privateKey,
      }),
    estimateFeesForStakeValidators: async payload =>
      await chain?.estimateFeesForStakeValidators({
        fromAddress: wallet.address,
        ...payload,
        privateKey: wallet.privateKey,
      }),
    getEstimateFeeForWithdrawStaking: async payload =>
      await chain?.getEstimateFeeForWithdrawStaking({
        fromAddress: wallet.address,
        privateKey: wallet.privateKey,
        ...payload,
      }),
    getEstimateFeeForStakingRewards: async payload =>
      await chain?.getEstimateFeeForStakingRewards({
        fromAddress: wallet.address,
        privateKey: wallet.privateKey,
        ...payload,
      }),
    getEstimateFeeForDeactivateStaking: async payload =>
      await chain?.getEstimateFeeForDeactivateStaking({
        fromAddress: wallet.address,
        contractAddress: token.contractAddress,
        ...payload,
        privateKey: wallet.privateKey,
      }),
    getEstimateFee: async payload =>
      await chain.getEstimateFeeForToken({
        decimals: token.decimal,
        privateKey: wallet?.privateKey,
        chain_name: token?.chain_name,
        symbol: token.symbol,
        ...payload,
      }),
    getEstimateFeeForPendingTransaction: async payload =>
      await chain?.getEstimateFeeForPendingTransaction({
        fromAddress: wallet.address,
        privateKey: wallet.privateKey,
        ...payload,
      }),
    send: async payload => {
      try {
        return await chain.sendToken({
          from: wallet.address,
          privateKey: wallet.privateKey,
          transactionFee,
          decimal: token.decimal,
          contractAddress: token.contractAddress,
          chain_name: token?.chain_name,
          symbol: token.symbol,
          ...payload,
        });
      } catch (e) {
        console.error('send token error: ', e);
        throw e;
      }
    },
    cancelTransaction: async payload =>
      await chain.cancelTransaction({
        from: wallet.address,
        privateKey: wallet.privateKey,
        chain_name: token?.chain_name,
        publicKey: token?.publicKey,
        deriveAddresses: token?.deriveAddresses,
        extendedPrivateKey:
          wallet.extendedPrivateKey || token?.extendedPrivateKey,
        ...payload,
      }),
    accelerateTransaction: async payload =>
      await chain.accelerateTransaction({
        from: wallet.address,
        privateKey: wallet.privateKey,
        chain_name: token?.chain_name,
        publicKey: token?.publicKey,
        deriveAddresses: token?.deriveAddresses,
        extendedPrivateKey:
          wallet.extendedPrivateKey || token?.extendedPrivateKey,
        ...payload,
      }),

    waitForConfirmation: chain?.waitForConfirmation,
    getTransactions: async payload =>
      await chain?.getTokenTransactions({
        address: wallet.address,
        contractAddress: token?.contractAddress,
        decimal: token?.decimal,
        ...payload,
      }),
    getTransaction: async payload =>
      await chain?.getTransaction({
        txHash: payload.txHash,
        contractAddress: token?.contractAddress,
      }),
    getTransactionForUpdate: async payload =>
      await chain?.getTransactionForUpdate({
        from: wallet.address,
        decimals: token.decimal,
        ...payload,
      }),
    isValidAddress: ({address}) => chain?.isValidAddress({address}),
    getNFTEstimateFee: async payload =>
      await chain.getEstimateFeeForNFT({
        ...payload,
        privateKey: wallet.privateKey,
      }),
    createTokenCall: async payload =>
      await chain.createTokenCall({
        ...payload,
        fromAddress: wallet.address,
      }),
    createNFTCall: async payload =>
      await chain.createNFTCall({
        ...payload,
        fromAddress: wallet.address,
      }),
    sendNFT: async payload =>
      await chain.sendNFT({
        ...payload,
        privateKey: wallet.privateKey,
      }),
    createStaking: async payload =>
      await chain.createStaking({
        ...payload,
        privateKey: wallet.privateKey,
        contractAddress: token.contractAddress,
        decimals: token.decimal,
      }),

    createStakingWithValidator: async payload =>
      await chain.createStakingWithValidator({
        ...payload,
        privateKey: wallet.privateKey,
      }),
    withdrawStaking: async payload =>
      await chain.withdrawStaking({
        ...payload,
        privateKey: wallet.privateKey,
      }),
    stakingRewards: async payload =>
      await chain.stakingRewards({
        ...payload,
        privateKey: wallet.privateKey,
      }),
    deactivateStaking: async payload =>
      await chain.deactivateStaking({
        ...payload,
        privateKey: wallet.privateKey,
        contractAddress: token.contractAddress,
      }),
    getEstimateFeeForBatchTransaction: async payload =>
      await chain.getEstimateFeeForBatchTransaction({
        ...payload,
        privateKey: wallet.privateKey,
        from: wallet.address,
      }),
    sendBatchTransaction: async payload =>
      await chain.sendBatchTransaction({
        ...payload,
        privateKey: wallet.privateKey,
        from: wallet.address,
      }),
    unClaimedOnChainDeposit: async () => await chain.unClaimedOnChainDeposit(),
    approveClaimDeposit: async payload =>
      await chain.approveClaimDeposit(payload),
    rejectClaimDeposit: async payload =>
      await chain.rejectClaimDeposit(payload),
    checkDelegation: async () =>
      await chain.checkDelegation?.({address: wallet.address}),
    revokeDelegation: async () =>
      await chain.revokeDelegation?.({privateKey: wallet.privateKey}),
    // Same guard as the base-coin wrapper: a DEX quote must never degrade
    // into a plain transfer on a chain without swap support.
    swap: async payload => {
      if (typeof chain.swap !== 'function') {
        throw new Error(
          `Swaps are not supported on ${token?.chain_name || 'this chain'} yet`,
        );
      }
      return await chain.swap({
        from: wallet.address,
        privateKey: wallet.privateKey,
        ...payload,
      });
    },
    getEstimateSwapFee: async payload => {
      if (typeof chain.getEstimateSwapFee !== 'function') {
        throw new Error(
          `Swaps are not supported on ${token?.chain_name || 'this chain'} yet`,
        );
      }
      return await chain.getEstimateSwapFee({
        fromAddress: wallet.address,
        contractAddress: token.contractAddress,
        decimal: token.decimal,
        privateKey: wallet.privateKey,
        ...payload,
      });
    },
    checkAndApproveSwap: async payload =>
      await chain.checkAndApproveSwap({
        from: wallet.address,
        privateKey: wallet.privateKey,
        ...payload,
      }),
    approve: async payload =>
      await chain.approve({
        from: wallet.address,
        privateKey: wallet.privateKey,
        ...payload,
      }),
    readAllowance: async payload =>
      await chain.readAllowance({
        from: wallet.address,
        privateKey: wallet.privateKey,
        ...payload,
      }),
    getEstimateFeForAllowanceApprove: async payload =>
      await chain.getEstimateFeForAllowanceApprove({
        from: wallet.address,
        contractAddress: token.contractAddress,
        privateKey: wallet.privateKey,
        ...payload,
      }),
    readPermitAllowance: async payload =>
      await chain.readPermitAllowance({
        from: wallet.address,
        privateKey: wallet.privateKey,
        ...payload,
      }),
    getEstimateFeeForPermitApprove: async payload =>
      await chain.getEstimateFeeForPermitApprove({
        from: wallet.address,
        privateKey: wallet.privateKey,
        ...payload,
      }),
    approvePermit2: async payload =>
      await chain.approvePermit2({
        from: wallet.address,
        privateKey: wallet.privateKey,
        ...payload,
      }),
  };

  return coinWrapper;
};

const hashObject = Object.fromEntries(
  Object.entries(CHAIN_CONFIG)
    .filter(([, chainConfig]) => chainConfig.tx_hash_path)
    .map(([chain_name, chainConfig]) => [chain_name, chainConfig.tx_hash_path]),
);

export const createWalletForChain = async (
  phrase,
  coin,
  walletData,
  customRpcUrl,
) => {
  const {wallet, chain} = await resolveWallet({
    phrase,
    coin,
    walletData,
    customRpcUrl,
  });
  if (!chain) {
    throw new Error('chain not found');
  }
  if (!wallet) {
    throw new Error('getCoin condition not found');
  }
  return {wallet, chain};
};

export const getHashString = (data, type) => {
  const hashType = hashObject?.[type];
  if (!hashType) {
    return data;
  }

  const keys = hashType.split('.');
  let result = data;

  for (const key of keys) {
    if (result[key] === undefined) {
      return data;
    }
    result = result[key];
  }

  return result;
};
