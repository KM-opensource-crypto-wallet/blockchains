import {createProviderClient} from 'dok-wallet-blockchain-networks/config/providerClient';
import {IS_SANDBOX} from 'dok-wallet-blockchain-networks/config/config';

// Blockchair has no Zcash testnet data at all, and its Zcash mainnet support
// is unverified -- Cipherscan is a Zcash-specific explorer with confirmed
// working testnet AND mainnet APIs on separate subdomains, no API key.
export const CipherscanAPI = createProviderClient({
  baseURL: IS_SANDBOX
    ? 'https://api.testnet.cipherscan.app/api'
    : 'https://api.mainnet.cipherscan.app/api',
});
