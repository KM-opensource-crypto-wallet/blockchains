export const TRON_SIGN_TRANSACTION = 'tron_signTransaction';
export const TRON_SIGN_MESSAGE = 'tron_signMessage';

export const tronWalletConnectTransaction = async (
  method,
  payload,
  privateKey,
  signTypeData,
) => {
  const {
    TronChain,
  } = require('dok-wallet-blockchain-networks/cryptoChain/chains/TronChain');
  let tx = null;
  switch (method) {
    case TRON_SIGN_TRANSACTION:
      tx = await TronChain().signTransaction({payload, privateKey});
      break;
    case TRON_SIGN_MESSAGE:
      tx = await TronChain().signmessageV2({payload: signTypeData, privateKey});
      break;
    default:
      break;
  }
  return tx;
};
