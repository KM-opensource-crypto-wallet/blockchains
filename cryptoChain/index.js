import {TronChain} from 'dok-wallet-blockchain-networks/cryptoChain/chains/TronChain';
import {EVMChain} from 'dok-wallet-blockchain-networks/cryptoChain/chains/EVMChain';
import {
  isAddressOrPrivateKeyExists,
  isBitcoinChain,
  mergeUniqueAccounts,
  validateSupportedChain,
} from 'dok-wallet-blockchain-networks/helper';
import {IS_SANDBOX} from 'dok-wallet-blockchain-networks/config/config';
import {BitcoinChain} from 'dok-wallet-blockchain-networks/cryptoChain/chains/BitcoinChain';
import {SolanaChain} from 'dok-wallet-blockchain-networks/cryptoChain/chains/SolanaChain';
import {StellarChain} from 'dok-wallet-blockchain-networks/cryptoChain/chains/StellarChain';
import {RippleChain} from 'dok-wallet-blockchain-networks/cryptoChain/chains/RippleChain';
import {ThorChain} from 'dok-wallet-blockchain-networks/cryptoChain/chains/ThorChain';
import {TezosChain} from 'dok-wallet-blockchain-networks/cryptoChain/chains/TezosChain';
import {CosmosChain} from 'dok-wallet-blockchain-networks/cryptoChain/chains/CosmosChain';
import {createWallet} from 'myWallet/wallet.service';
import {PolkadotChain} from './chains/PolkadotChain';
import {TonChain} from './chains/TonChain';
import {DogecoinOrLitecoinChain} from './chains/DogecoinOrLitecoinChain';
import {AptosChain} from './chains/AptosChain';
import {HederaChain} from './chains/HederaChain';
import {CardanoChain} from './chains/CardanoChain';
import {FilecoinChain} from './chains/FilecoinChain';
import {BitcoinLightningChain} from 'dok-wallet-blockchain-networks/cryptoChain/chains/BitcoinLightningChain';
import {APP_VERSION} from 'utils/common';

const chains = {
  tron: TronChain,
  ethereum: EVMChain,
  binance_smart_chain: EVMChain,
  bitcoin: BitcoinChain, // this is native segwit
  bitcoin_legacy: BitcoinChain,
  bitcoin_segwit: BitcoinChain,
  bitcoin_lightning: BitcoinLightningChain,
  // bitcoin_taproot: BitcoinChain,
  solana: SolanaChain,
  polygon: EVMChain,
  base: EVMChain,
  arbitrum: EVMChain,
  optimism: EVMChain,
  litecoin: DogecoinOrLitecoinChain,
  stellar: StellarChain,
  ripple: RippleChain,
  thorchain: ThorChain,
  tezos: TezosChain,
  optimism_binance_smart_chain: EVMChain,
  avalanche: EVMChain,
  cosmos: CosmosChain,
  fantom: EVMChain,
  gnosis: EVMChain,
  viction: EVMChain,
  polkadot: PolkadotChain,
  ton: TonChain,
  dogecoin: DogecoinOrLitecoinChain,
  aptos: AptosChain,
  linea: EVMChain,
  zksync: EVMChain,
  ethereum_classic: EVMChain,
  ethereum_pow: EVMChain,
  kava: EVMChain,
  bitcoin_cash: DogecoinOrLitecoinChain,
  hedera: HederaChain,
  ink: EVMChain,
  sei: EVMChain,
  cardano: CardanoChain,
  filecoin: FilecoinChain,
};

export const getChain = (chain, phrase, customRpcUrl) => {
  return chains[chain]?.(chain, phrase, customRpcUrl);
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
      publicKey: chain_existing_coin.publicKey,
      extendedPublicKey: chain_existing_coin.extendedPublicKey,
      extendedPrivateKey: chain_existing_coin.extendedPrivateKey,
    };
  } else if (phrase && chainName === 'bitcoin_lightning') {
    wallet = await BitcoinLightningChain(
      chainName,
      phrase,
    ).generateSparkAddress();
  } else if (phrase && chainName === 'stellar') {
    wallet = StellarChain().createStellarWallet({mnemonic: phrase});
  } else if (phrase && chainName === 'hedera') {
    wallet = await HederaChain().getOrCreateHederaWallet({mnemonic: phrase});
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
    return await getBaseCoin(chain, wallet, coin);
  }
};

const getBaseCoin = async (chain, wallet, coin) => {
  // Prefer coin's stored deriveAddresses (from Redux); fall back to native wallet result
  const effectiveDeriveAddresses = wallet?.isNew
    ? mergeUniqueAccounts(coin?.deriveAddresses, wallet?.deriveAddresses)
    : coin?.deriveAddresses;

  const coinWrapper = {
    type: 'coin',
    wallet,
    address: wallet.address,
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
  };

  return coinWrapper;
};

const getTokenCoin = async (chain, wallet, token, transactionFee) => {
  const coinWrapper = {
    type: 'token',
    wallet,
    address: wallet.address,
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
      }),

    getStaking: async () =>
      await chain?.getStaking({
        address: wallet.address,
      }),
    getStakingValidators: async payload =>
      await chain.getStakingValidators({address: wallet.address, ...payload}),
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
        ...payload,
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
  };

  return coinWrapper;
};

const hashObject = {
  tron: 'txid',
  ethereum: 'hash',
  binance_smart_chain: 'hash',
  bitcoin: '',
  bitcoin_legacy: '',
  bitcoin_segwit: '',
  solana: '',
  polygon: 'hash',
  base: 'hash',
  arbitrum: 'hash',
  optimism: 'hash',
  litecoin: '',
  stellar: '',
  ripple: 'result.hash',
  thorchain: '',
  tezos: 'opHash',
  optimism_binance_smart_chain: 'hash',
  avalanche: 'hash',
  cosmos: '',
  fantom: 'hash',
  gnosis: 'hash',
  viction: 'hash',
  // ! polkadot: 'hash',
  // ! ton: 'hash',
  dogecoin: '',
  aptos: '',
  linea: 'hash',
  zksync: 'hash',
  ethereum_classic: 'hash',
  ethereum_pow: 'hash',
  kava: 'hash',
  bitcoin_cash: '',
  hedera: 'transactionHash',
  ink: 'hash',
  sei: 'hash',
  cardano: '',
  filecoin: '',
};

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
