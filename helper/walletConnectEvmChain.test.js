/**
 * EIP-3326 (wallet_switchEthereumChain) / EIP-3085 (wallet_addEthereumChain)
 * answers. Runner: node-env jest config (config.js requires image assets).
 */
import {
  answerAddEthereumChain,
  answerSwitchEthereumChain,
  getSessionEvmChains,
  hexChainIdToCaip,
} from 'dok-wallet-blockchain-networks/helper/walletConnectEvmChain';
import {CHAIN_ID} from 'dok-wallet-blockchain-networks/config/config';

const HEDERA_EVM_KEY = `eip155:${CHAIN_ID.hedera}`;
const HEDERA_EVM_HEX = `0x${CHAIN_ID.hedera.toString(16)}`;

const session = {
  namespaces: {
    eip155: {
      chains: [HEDERA_EVM_KEY],
      accounts: [`${HEDERA_EVM_KEY}:0xabc`],
      methods: ['personal_sign'],
      events: [],
    },
  },
};

describe('hexChainIdToCaip', () => {
  it('converts EIP-155 hex chain ids to CAIP-2', () => {
    expect(hexChainIdToCaip('0x128')).toBe('eip155:296');
    expect(hexChainIdToCaip('0x1')).toBe('eip155:1');
    expect(hexChainIdToCaip('296')).toBe('eip155:296');
  });

  it('returns null for anything that is not a chain id', () => {
    expect(hexChainIdToCaip(undefined)).toBeNull();
    expect(hexChainIdToCaip('0xzz')).toBeNull();
    expect(hexChainIdToCaip('')).toBeNull();
  });
});

describe('getSessionEvmChains', () => {
  it('reads the approved chains', () => {
    expect(getSessionEvmChains(session)).toEqual([HEDERA_EVM_KEY]);
  });

  it('derives chains from accounts for sessions approved without a chains field', () => {
    const legacy = {
      namespaces: {
        eip155: {accounts: ['eip155:1:0xabc', 'eip155:137:0xabc']},
      },
    };
    expect(getSessionEvmChains(legacy)).toEqual(['eip155:1', 'eip155:137']);
    expect(getSessionEvmChains(undefined)).toEqual([]);
  });
});

describe('answerSwitchEthereumChain', () => {
  it('succeeds with null for a chain the session was approved for', () => {
    expect(
      answerSwitchEthereumChain(session, [{chainId: HEDERA_EVM_HEX}]),
    ).toEqual({result: null});
  });

  it('answers 4902 (unrecognized chain) for a chain outside the session', () => {
    const answer = answerSwitchEthereumChain(session, [{chainId: '0x1'}]);
    expect(answer.result).toBeUndefined();
    expect(answer.error).toMatchObject({code: 4902});
    expect(answer.error.message).toContain('0x1');
    expect(answer.error.message).toContain('wallet_addEthereumChain');
  });

  it('answers invalid params when no chain id is given', () => {
    expect(answerSwitchEthereumChain(session, [{}]).error).toMatchObject({
      code: -32602,
    });
  });
});

describe('answerAddEthereumChain', () => {
  it('succeeds with null for a chain this wallet can serve over WalletConnect', () => {
    expect(answerAddEthereumChain([{chainId: HEDERA_EVM_HEX}])).toEqual({
      result: null,
    });
  });

  it('refuses chains the wallet does not support instead of claiming success', () => {
    const answer = answerAddEthereumChain([{chainId: '0x539'}]);
    expect(answer.result).toBeUndefined();
    expect(answer.error).toMatchObject({code: -32602});
    expect(answer.error.message).toContain('0x539');
  });
});
