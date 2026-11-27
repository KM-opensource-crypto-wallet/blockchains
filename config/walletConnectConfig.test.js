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
  isWalletConnectMethodForChain,
  NON_EVM_METHOD_HANDLERS,
  SUPPORTED_WALLET_CONNECT_METHODS,
  WalletConnectMethods,
} from 'dok-wallet-blockchain-networks/config/config';

const HEDERA_NATIVE_KEY = IS_SANDBOX ? 'hedera:testnet' : 'hedera:mainnet';
const HEDERA_EVM_CHAIN_ID = IS_SANDBOX ? 296 : 295;

describe('Hedera WalletConnect method routing (HIP-820)', () => {
  it('routes the four signer-facing hedera_* methods to HederaChain functions', () => {
    expect(WalletConnectMethods).toMatchObject({
      hedera_signAndExecuteTransaction: 'sendRawTransaction',
      hedera_signMessage: 'signMessage',
      hedera_executeTransaction: 'executeTransaction',
      hedera_signAndExecuteQuery: 'signAndExecuteQuery',
    });
  });

  it('accepts five HIP-820 methods as supported', () => {
    [
      'hedera_getNodeAddresses',
      'hedera_executeTransaction',
      'hedera_signMessage',
      'hedera_signAndExecuteQuery',
      'hedera_signAndExecuteTransaction',
    ].forEach(method => {
      expect(isSupportedWalletConnectMethod(method)).toBe(true);
    });
  });

  it('does not support hedera_signTransaction', () => {
    expect(isSupportedWalletConnectMethod('hedera_signTransaction')).toBe(
      false,
    );
    expect(WalletConnectMethods.hedera_signTransaction).toBeUndefined();
    expect(NON_EVM_METHOD_HANDLERS.hedera_signTransaction).toBeUndefined();
  });

  it('answers hedera_getNodeAddresses outside the transaction modal', () => {
    expect(WalletConnectMethods.hedera_getNodeAddresses).toBeUndefined();
  });

  it('extracts the signer account id for every signer-bound hedera method', () => {
    const params = {signerAccountId: `${HEDERA_NATIVE_KEY}:0.0.5`, x: 'y'};
    [
      'hedera_signMessage',
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

describe('Polkadot WalletConnect method routing', () => {
  it('routes polkadot_signMessage to PolkadotChain.signMessage', () => {
    expect(WalletConnectMethods.polkadot_signMessage).toBe('signMessage');
  });

  it('passes the spec `data` field plus `type` through as signTypeData', () => {
    const params = {
      address: '15UyNqZ7NB1QQVpY9xv7VGwkxtvXePKihFHx8kH4VgEcS1gU',
      data: '0x3c42797465733e68656c6c6f20776f726c643c2f42797465733e',
      type: 'bytes',
    };
    expect(NON_EVM_METHOD_HANDLERS.polkadot_signMessage(params)).toEqual({
      signTypeData: {message: params.data, type: 'bytes'},
    });
  });

  it('falls back to the legacy `message` field when `data` is absent', () => {
    expect(
      NON_EVM_METHOD_HANDLERS.polkadot_signMessage({
        address: 'addr',
        message: '0x68656c6c6f',
      }),
    ).toEqual({
      signTypeData: {message: '0x68656c6c6f', type: undefined},
    });
  });
});

// A method is only answered on its own namespace.
describe('isWalletConnectMethodForChain', () => {
  it.each([
    ['eth_sendTransaction', 'eip155:1'],
    ['eth_signTransaction', 'eip155:56'],
    ['personal_sign', 'eip155:1'],
    ['eth_signTypedData_v4', 'eip155:137'],
    ['wallet_sendCalls', 'eip155:11155111'],
    ['wallet_getCapabilities', 'eip155:1'],
    ['wallet_switchEthereumChain', 'eip155:1'],
    ['eth_sendTransaction', 'eip155:295'],
    ['solana_signMessage', 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp'],
    ['tron_sendTransaction', 'tron:0x2b6653dc'],
    ['ton_sendMessage', 'ton:-239'],
    ['polkadot_signMessage', 'polkadot:91b171bb158e2d3848fa23a9f1c25182'],
    ['stellar_signXDR', 'stellar:pubnet'],
    ['xrpl_signTransaction', 'xrpl:0'],
    ['hedera_signMessage', 'hedera:mainnet'],
    ['hedera_getNodeAddresses', 'hedera:testnet'],
    ['aptos_signMessage', 'aptos:1'],
    ['tezos_sign', 'tezos:NetXdQprcVkpaWU'],
    ['signPsbt', 'bip122:000000000019d6689c085ae165831e93'],
    ['signMessage', 'bip122:000000000019d6689c085ae165831e93'],
  ])('allows %s on %s', (method, chainId) => {
    expect(isWalletConnectMethodForChain(method, chainId)).toBe(true);
  });

  it.each([
    // another namespace's method on eip155,
    ['tron_sendTransaction', 'eip155:1'],
    ['solana_signAndSendTransaction', 'eip155:1'],
    ['hedera_signMessage', 'eip155:295'],
    ['signMessage', 'eip155:1'],
    ['sendTransfer', 'eip155:1'],
    // eth_* on a non-EVM namespace,
    ['eth_sendTransaction', 'tron:0x2b6653dc'],
    ['eth_sendTransaction', 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp'],
    ['personal_sign', 'hedera:mainnet'],
    ['wallet_getCapabilities', 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp'],
    ['tron_signMessage', 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp'],
    ['solana_signMessage', 'bip122:000000000019d6689c085ae165831e93'],
    // unsupported methods and malformed chain ids stay refused.
    ['hedera_signTransaction', 'hedera:mainnet'],
    ['stellar_signAuthEntry', 'stellar:pubnet'],
    ['eth_sendTransaction', undefined],
    ['eth_sendTransaction', 'eip155'],
    ['cosmos_signDirect', 'cosmos:cosmoshub-4'],
    [undefined, 'eip155:1'],
  ])('refuses %s on %s', (method, chainId) => {
    expect(isWalletConnectMethodForChain(method, chainId)).toBe(false);
  });

  it('allows every supported method on at least one namespace', () => {
    const namespaces = [
      'eip155:1',
      'solana:x',
      'tron:x',
      'ton:x',
      'polkadot:x',
      'stellar:x',
      'xrpl:x',
      'hedera:x',
      'aptos:x',
      'tezos:x',
      'bip122:x',
    ];
    SUPPORTED_WALLET_CONNECT_METHODS.forEach(method => {
      expect([
        method,
        namespaces.some(chainId =>
          isWalletConnectMethodForChain(method, chainId),
        ),
      ]).toEqual([method, true]);
    });
  });
});
