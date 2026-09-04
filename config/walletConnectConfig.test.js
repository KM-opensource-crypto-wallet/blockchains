/**
 * Runner: pure config, but config.js requires image assets. Run with the
 * node-env jest config (moduleNameMapper for images) like HederaChain.test.js.
 */
import {
  CHAIN_CONFIG,
  CHAIN_ID,
  config,
  EVM_SIGN_REQUEST_HANDLERS,
  IS_SANDBOX,
  isNonEVMChain,
  isSupportedWalletConnectMethod,
  NON_EVM_METHOD_HANDLERS,
  WalletConnectMethods,
} from 'dok-wallet-blockchain-networks/config/config';

const HEDERA_NATIVE_KEY = IS_SANDBOX ? 'hedera:testnet' : 'hedera:mainnet';
const HEDERA_EVM_CHAIN_ID = IS_SANDBOX ? 296 : 295;

describe('Hedera WalletConnect method routing (HIP-820)', () => {
  it('routes the five signer-facing hedera_* methods to HederaChain functions', () => {
    expect(WalletConnectMethods).toMatchObject({
      hedera_signAndExecuteTransaction: 'sendRawTransaction',
      hedera_signTransaction: 'signRawTransaction',
      hedera_signMessage: 'signMessage',
      hedera_executeTransaction: 'executeTransaction',
      hedera_signAndExecuteQuery: 'signAndExecuteQuery',
    });
  });

  it('accepts all six HIP-820 methods as supported', () => {
    [
      'hedera_getNodeAddresses',
      'hedera_executeTransaction',
      'hedera_signMessage',
      'hedera_signAndExecuteQuery',
      'hedera_signAndExecuteTransaction',
      'hedera_signTransaction',
    ].forEach(method => {
      expect(isSupportedWalletConnectMethod(method)).toBe(true);
    });
  });

  it('answers hedera_getNodeAddresses outside the transaction modal', () => {
    expect(WalletConnectMethods.hedera_getNodeAddresses).toBeUndefined();
  });

  it('extracts the signer account id for every signer-bound hedera method', () => {
    const params = {signerAccountId: `${HEDERA_NATIVE_KEY}:0.0.5`, x: 'y'};
    [
      'hedera_signMessage',
      'hedera_signTransaction',
      'hedera_signAndExecuteTransaction',
      'hedera_signAndExecuteQuery',
    ].forEach(method => {
      const result = NON_EVM_METHOD_HANDLERS[method](params);
      expect(result.expectedSignerAddress).toBe('0.0.5');
      expect(result.signTypeData).toBe(params);
    });
  });

  it('passes hedera_executeTransaction params through with no signer check', () => {
    const params = {transactionList: 'AAAA'};
    expect(NON_EVM_METHOD_HANDLERS.hedera_executeTransaction(params)).toEqual({
      finaltransactionData: params,
      signTypeData: params,
    });
  });
});

describe('Hedera WalletConnect chains', () => {
  it('advertises the native hedera key for the Hedera coin', () => {
    expect(config.WALLET_CONNECT_SUPPORTED_CHAIN[HEDERA_NATIVE_KEY]).toEqual({
      chain_display_name: 'Hedera',
      chain_name: 'hedera',
      symbol: 'HBAR',
      namespace: 'hedera',
    });
  });

  it('advertises the eip155 relay key for the same Hedera coin', () => {
    expect(CHAIN_ID.hedera).toBe(HEDERA_EVM_CHAIN_ID);
    expect(
      config.WALLET_CONNECT_SUPPORTED_CHAIN[`eip155:${HEDERA_EVM_CHAIN_ID}`],
    ).toEqual({
      chain_display_name: 'Hedera EVM',
      chain_name: 'hedera',
      symbol: 'HBAR',
      namespace: 'eip155',
    });
  });

  it('tags every WalletConnect chain with its CAIP-2 namespace', () => {
    Object.entries(config.WALLET_CONNECT_SUPPORTED_CHAIN).forEach(
      ([key, entry]) => {
        expect(entry.namespace).toBe(key.split(':')[0]);
      },
    );
  });

  it('keeps Hedera a native (non-EVM) chain', () => {
    expect(CHAIN_CONFIG.hedera.is_evm).toBeUndefined();
    expect(CHAIN_CONFIG.hedera.chain_loader).toBe('hedera');
  });

  it('points the Hedera EVM relay at hashio for both networks', () => {
    expect(CHAIN_CONFIG.hedera.free_rpc_urls).toEqual({
      mainnet: ['https://mainnet.hashio.io/api'],
      testnet: ['https://testnet.hashio.io/api'],
    });
  });
});

describe('isNonEVMChain', () => {
  it('matches on the CAIP-2 namespace, not on a substring', () => {
    expect(isNonEVMChain('hedera:mainnet')).toBe(true);
    expect(isNonEVMChain('eip155:295')).toBe(false);
    expect(isNonEVMChain('eip155:1')).toBe(false);
    expect(isNonEVMChain('foo:hedera')).toBe(false);
    expect(isNonEVMChain(undefined)).toBe(false);
  });
});

describe('EVM typed-data signer guard', () => {
  it('reads the signer address from params[0] for every eth_signTypedData variant', () => {
    const params = ['0xabc', '{"types":{}}'];
    [
      'eth_signTypedData',
      'eth_signTypedData_v3',
      'eth_signTypedData_v4',
    ].forEach(method => {
      expect(WalletConnectMethods[method]).toBe('signTypedData');
      expect(EVM_SIGN_REQUEST_HANDLERS[method](params)).toEqual({
        signTypeData: '{"types":{}}',
        expectedSignerAddress: '0xabc',
      });
    });
  });
});
