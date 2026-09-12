import {
  getWalletConnectExecutor,
  resolveWalletConnectCoin,
  toWalletConnectError,
} from 'dok-wallet-blockchain-networks/helper/walletConnectCoin';

const coins = [
  {chain_name: 'ethereum', symbol: 'ETH', type: 'coin', address: '0xAbC'},
  {chain_name: 'ethereum', symbol: 'USDT', type: 'token', address: '0xAbC'},
  {
    chain_name: 'hedera',
    symbol: 'HBAR',
    type: 'coin',
    address: '0xabc',
    accountId: '0.0.77',
  },
];

describe('resolveWalletConnectCoin', () => {
  it('prefers the native coin whose address matches, case-insensitively', () => {
    expect(
      resolveWalletConnectCoin({
        walletCoins: coins,
        chain_name: 'ethereum',
        walletAddress: '0xABC',
      }),
    ).toBe(coins[0]);
  });

  it('falls back to the chain native coin when the session address is another form (Hedera 0.0.N)', () => {
    expect(
      resolveWalletConnectCoin({
        walletCoins: coins,
        chain_name: 'hedera',
        walletAddress: '0.0.77',
      }),
    ).toBe(coins[2]);
  });

  it('never picks a token or a coin of another chain', () => {
    expect(
      resolveWalletConnectCoin({
        walletCoins: coins,
        chain_name: 'solana',
        walletAddress: '0xabc',
      }),
    ).toBeNull();
    expect(
      resolveWalletConnectCoin({walletCoins: coins, chain_name: undefined}),
    ).toBeNull();
  });
});

describe('getWalletConnectExecutor', () => {
  const evm = {name: 'evm'};
  const chain = {name: 'native', evm};

  it('uses the chain EVM executor for eip155 requests when it has one', () => {
    expect(getWalletConnectExecutor(chain, 'eip155:296')).toBe(evm);
  });

  it('uses the chain itself for its native namespace', () => {
    expect(getWalletConnectExecutor(chain, 'hedera:testnet')).toBe(chain);
  });

  it('uses the chain itself when it has no EVM executor (plain EVM chains)', () => {
    const plain = {name: 'evm-chain'};
    expect(getWalletConnectExecutor(plain, 'eip155:1')).toBe(plain);
    expect(getWalletConnectExecutor(plain, undefined)).toBe(plain);
  });
});

describe('toWalletConnectError', () => {
  it('forwards a chain-provided JSON-RPC error (HIP-820 code 9000)', () => {
    const e = new Error('precheck failed');
    e.jsonRpcError = {code: 9000, message: 'precheck failed', data: '10'};
    expect(toWalletConnectError(e)).toEqual({
      code: 9000,
      message: 'precheck failed',
      data: '10',
    });
  });

  it('maps any other failure to the generic user-facing code', () => {
    expect(toWalletConnectError(new Error('boom'))).toEqual({
      code: 5000,
      message: 'boom',
    });
    expect(toWalletConnectError(undefined)).toEqual({
      code: 5000,
      message: 'Transaction error',
    });
  });
});
