import Moralis from 'moralis';
import 'dok-wallet-blockchain-networks/config/moralis';

export const fetchEVMNftApi = async (address, chain, cursor) => {
  try {
    const response = await Moralis.EvmApi.nft.getWalletNFTs({
      address,
      chain,
      limit: 20,
      cursor,
    });
    const resp = JSON.parse(JSON.stringify(response));
    const result = resp?.result?.map(item => {
      try {
        if (typeof item.metadata === 'string') {
          const parseMetadata = JSON.parse(item.metadata);
          return {...item, metadata: parseMetadata};
        } else {
          return item;
        }
      } catch (e) {
        return item;
      }
    });
    return {...resp, result};
  } catch (e) {
    console.error('Error in fetch EVMNft api', e);
    throw e;
  }
};

export const fetchSolanaNftApi = async (address, network) => {
  try {
    const response = await Moralis.SolApi.account.getNFTs({
      address,
      network,
    });
    return JSON.parse(JSON.stringify(response));
  } catch (e) {
    console.error('Error in fetch SolanaNFt api', e);
    throw e;
  }
};
