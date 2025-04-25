import axios from 'axios';

export const getSolanaContract = async contractAddress => {
  try {
    const resp = await axios.get(
      'https://token-list-api.solana.cloud/v1/search',
      {
        params: {
          query: contractAddress,
          start: 0,
          limit: 1,
        },
      },
    );
    return {status: resp?.status, data: resp?.data?.content};
  } catch (e) {
    console.error('Error in get the solana contract API', JSON.stringify(e));
    throw e;
  }
};
