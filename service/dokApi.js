import { DokApi } from 'dok-wallet-blockchain-networks/config/dokApi';
import { v4 } from 'uuid';
import { IS_SANDBOX, isWeb } from 'dok-wallet-blockchain-networks/config/config';
import { generateSHA256ForCoins } from '../../src/utils/common';
import { getAIDFromLocalStorage } from 'utils/localStorageData';
import { isEVMChain } from 'dok-wallet-blockchain-networks/helper';

export const addOTC = async payload => {
  try {
    const resp = await DokApi.post('/add-otc', payload);
    return { status: resp?.status, data: resp?.data };
  } catch (e) {
    console.error('Error in add OTP', JSON.stringify(e));
  }
};

export const registerUserAPI = async payload => {
  try {
    const sshData = await generateSHA256ForCoins(payload.coins, isEVMChain);
    const finalPayload = {
      walletIds: sshData,
      clientId: payload?.clientId || v4(),
    };
    if (payload?.masterClientId) {
      finalPayload.masterClientId = payload?.masterClientId;
    }
    const aid = getAIDFromLocalStorage();
    if (aid) {
      finalPayload.merchantId = aid;
    }
    if (payload?.is_create_wallet) {
      finalPayload.is_create_wallet = true;
    }
    if (payload?.is_imported) {
      finalPayload.is_imported = true;
    }
    if (!isWeb) {
      finalPayload.is_app = true;
    }
    const resp = await DokApi.post('/register', finalPayload);
    return { status: resp?.status, data: resp?.data };
  } catch (e) {
    console.error('Error in register user API', JSON.stringify(e));
  }
};

export const fetchCurrenciesAPI = async ({
  limit,
  page,
  order,
  orderBy,
  status,
  search,
}) => {
  try {
    const payload = {
      limit: limit || 20,
      orderBy: orderBy || 'order',
      order: order || 1,
      page: page || 1,
    };
    if (
      status !== undefined &&
      status !== null &&
      typeof status === 'boolean'
    ) {
      payload.status = status;
    }
    if (search) {
      payload.search = search;
    }
    const resp = await DokApi.post('/list-crypto', payload);
    return { status: resp?.status, data: resp?.data };
  } catch (e) {
    console.error('Error in listCurrencyAPI', JSON.stringify(e));
    throw e;
  }
};

export const fetchCoinGroupAPI = async ({
  limit,
  page,
  order,
  orderBy,
  status,
  search,
}) => {
  try {
    const payload = {
      limit: limit || 20,
      orderBy: orderBy || 'order',
      order: order || 1,
      page: page || 1,
    };
    if (search) {
      payload.search = search;
    }
    const resp = await DokApi.post('/list-crypto-group', payload);
    return { status: resp?.status, data: resp?.data };
  } catch (e) {
    console.error('Error in fetchCoinGroupAPI', JSON.stringify(e));
    throw e;
  }
};

export const fetchCoinByChainAPI = async ({
  limit,
  page,
  order,
  orderBy,
  chain_name,
}) => {
  try {
    const search = chain_name?.split('_')[0];
    const payload = {
      limit: limit || 20,
      orderBy: orderBy || 'order',
      order: order || 1,
      page: page || 1,
      type: 'coin',
    };
    if (search) {
      payload.search = search;
    }
    const resp = await DokApi.post('/list-crypto', payload);
    const data = Array.isArray(resp?.data?.data) ? resp?.data?.data : [];
    const foundCoin = data.find(
      item => item.chain_name === chain_name && item?.type === 'coin',
    );
    return foundCoin || null;
  } catch (e) {
    console.error('Error in fetchCoinByChainAPI', JSON.stringify(e));
    throw e;
  }
};

export const signMoonPayUrl = async ({ url }) => {
  try {
    const payload = {
      type: IS_SANDBOX ? 'SANDBOX' : 'LIVE',
      url,
    };
    const resp = await DokApi.post('/sign-url', payload);
    return { status: resp?.status, data: resp?.data?.data };
  } catch (e) {
    console.error('Error in signMoonpayUrl', JSON.stringify(e));
    throw e;
  }
};

export const getBitcoinAddresses = async ({ chain_name, extended_pub_key }) => {
  try {
    const payload = {
      extended_pub_key,
      chain_name,
      is_testnet: IS_SANDBOX,
    };
    const resp = await DokApi.post('/get-bitcoin-addresses', payload);
    return { status: resp?.status, data: resp?.data?.data };
  } catch (e) {
    console.error('Error in getBitcoinAddresses', JSON.stringify(e));
    throw e;
  }
};

export const getNewsAPI = async key => {
  try {
    const resp = await DokApi.post('/get-news-key', { key });
    return { status: resp?.status, data: resp?.data?.data };
  } catch (e) {
    console.error('Error in getNewsAPI', JSON.stringify(e));
    throw e;
  }
};

export const getStakingByChain = async payload => {
  try {
    const resp = await DokApi.post('/list-staking', { payload });
    return { status: resp?.status, data: resp?.data?.data };
  } catch (e) {
    console.error('Error in getStakingByChain', JSON.stringify(e));
    throw e;
  }
};

export const getiOSBuyCryptoCountries = async payload => {
  try {
    const resp = await DokApi.post('/get-ios-buy-crypto-country', {
      country_code: payload?.country,
      from_device: payload?.fromDevice,
      is_sandbox: IS_SANDBOX,
    });
    return { status: resp?.status, data: resp?.data?.data };
  } catch (e) {
    console.error('Error in getiOSBuyCryptoCountries', JSON.stringify(e));
    throw e;
  }
};

export const fetchRpcUrls = async countryCode => {
  try {
    const resp = await DokApi.post('/get-rpc-url', { is_sandbox: IS_SANDBOX });
    return { status: resp?.status, data: resp?.data?.data };
  } catch (e) {
    console.error('Error in fetchRpcUrls', JSON.stringify(e));
    throw e;
  }
};
export const fetchFeesInfo = async () => {
  try {
    const resp = await DokApi.get('/get-fees-info', {
      params: { is_sandbox: IS_SANDBOX },
    });
    return { status: resp?.status, data: resp?.data?.data };
  } catch (e) {
    console.error('Error in fetchFeesInfo', JSON.stringify(e));
    throw e;
  }
};

export const getBuyCryptoQuote = async payload => {
  try {
    const ipAddress = await getIPAddress();
    const resp = await DokApi.post('/get-buy-crypto-quote', {
      country_code: payload?.currentCountry,
      from_device: payload?.fromDevice,
      is_sandbox: IS_SANDBOX,
      crypto_payload: { ...payload, ipAddress },
    });
    return { status: resp?.status, data: resp?.data?.data };
  } catch (e) {
    console.error('Error in get Buy Crypto Quote', JSON.stringify(e));
    throw e;
  }
};

export const getSellCryptoQuote = async payload => {
  try {
    const ipAddress = await getIPAddress();
    const resp = await DokApi.post('/get-sell-crypto-quote', {
      country_code: payload?.currentCountry,
      from_device: payload?.fromDevice,
      is_sandbox: IS_SANDBOX,
      crypto_payload: { ...payload, ipAddress },
    });
    return { status: resp?.status, data: resp?.data?.data };
  } catch (e) {
    console.error('Error in get Sell Crypto Quote', JSON.stringify(e));
    throw e;
  }
};

export const getBuyCryptoUrl = async payload => {
  try {
    const resp = await DokApi.post('/get-buy-crypto-url', {
      is_sandbox: IS_SANDBOX,
      ...payload,
    });
    return { status: resp?.status, data: resp?.data?.data };
  } catch (e) {
    console.error('Error in get Buy Crypto Url', JSON.stringify(e));
    throw e;
  }
};

export const getSellCryptoUrl = async payload => {
  try {
    const resp = await DokApi.post('/get-sell-crypto-url', {
      is_sandbox: IS_SANDBOX,
      ...payload,
    });
    return { status: resp?.status, data: resp?.data?.data };
  } catch (e) {
    console.error('Error in get Sell Crypto Url', JSON.stringify(e));
    throw e;
  }
};

export const getSellCryptoPaymentDetails = async payload => {
  try {
    const resp = await DokApi.post('/get-sell-crypto-payment-details', {
      is_sandbox: IS_SANDBOX,
      ...payload,
    });
    return { status: resp?.status, data: resp?.data?.data };
  } catch (e) {
    console.error('Error in get Sell Crypto Url', JSON.stringify(e));
    throw e;
  }
};

export const fetchBitcoinBalances = async payload => {
  try {
    const resp = await DokApi.post('/get-blockchair-api', {
      is_sandbox: IS_SANDBOX,
      type: 'get_bitcoin_balances',
      ...payload,
    });
    return { status: resp?.status, data: resp?.data?.data };
  } catch (e) {
    console.error('Error in fetchBitcoinBalances', JSON.stringify(e));
    throw e;
  }
};

export const fetchBitcoinUTXO = async payload => {
  try {
    const resp = await DokApi.post('/get-blockchair-api', {
      is_sandbox: IS_SANDBOX,
      type: 'get_bitcoin_utxos',
      ...payload,
    });
    return { status: resp?.status, data: resp?.data?.data };
  } catch (e) {
    console.error('Error in fetchBitcoinUTXO', JSON.stringify(e));
    throw e;
  }
};

export const fetchBitcoinTransactionDetails = async payload => {
  try {
    const resp = await DokApi.post('/get-blockchair-api', {
      is_sandbox: IS_SANDBOX,
      type: 'get_transaction_details',
      ...payload,
    });
    return { status: resp?.status, data: resp?.data?.data };
  } catch (e) {
    console.error('Error in fetchBitcoinTransactionDetails', JSON.stringify(e));
    throw e;
  }
};

export const getWhiteLabelInfo = async domain => {
  try {
    const resp = await DokApi.post('/get-white-label', {
      domain,
    });
    return { status: resp?.status, data: resp?.data?.data };
  } catch (e) {
    console.error('Error in getWhiteLabelInfo', JSON.stringify(e));
    throw e;
  }
};
export const getCurrencyRate = async payload => {
  try {
    const resp = await DokApi.post('/get-currency-rate', payload);
    return { status: resp?.status, data: resp?.data?.data };
  } catch (e) {
    console.error('Error in get getCurrencyRate', JSON.stringify(e));
    throw e;
  }
};

export const getExchangeQuote = async payload => {
  try {
    const resp = await DokApi.post('/exchange-quote', payload);
    return { status: resp?.status, data: resp?.data?.data };
  } catch (e) {
    console.error('Error in get getExchangeQuote', JSON.stringify(e));
    throw e;
  }
};
export const createExchange = async payload => {
  try {
    const resp = await DokApi.post('/create-exchange', payload);
    return { status: resp?.status, data: resp?.data?.data };
  } catch (e) {
    console.error('Error in createExchange', JSON.stringify(e));
    throw e;
  }
};

export const getIPAddress = async () => {
  try {
    const resp = await DokApi.get('/get-ip-address', {
      timeout: 30000,
    });
    return resp?.data?.ipAddress;
  } catch (e) {
    return '192.168.1.1';
  }
};

export const getAllBlockchairAPI = async payload => {
  try {
    const resp = await DokApi.post('/get-all-blockchair-api', payload, {
      timeout: 30000,
    });
    if (resp?.data?.data === undefined) {
      throw new Error('Inacaccureate response from getAllBlockchairAPI');
    }
    return resp?.data?.data;
  } catch (e) {
    console.error('Error in premium blockchair API', JSON.stringify(e));
    throw e;
  }
};
