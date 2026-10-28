/**
 * EIP-5792 wallet_getCallsStatus answers. The batch id is the hash of the
 * single EIP-7702 execute() transaction wallet_sendCalls broadcast, so the
 * status is built straight from that transaction's receipt.
 *
 * Runner: repo jest.config.js (RN preset):
 *   npx jest dok-wallet-blockchain-networks/helper/walletConnectCallsStatus.test.js
 */
import {
  buildCallsStatus,
  isBatchCallsId,
  unknownBundleIdError,
} from 'dok-wallet-blockchain-networks/helper/walletConnectCallsStatus';

const HASH = '0x' + 'ab'.repeat(32);
const BLOCK_HASH = '0x' + 'cd'.repeat(32);
const TOPIC = '0x' + 'ef'.repeat(32);

// Shape of an ethers v6 TransactionReceipt: numbers and bigints, not hex.
const receipt = (overrides = {}) => ({
  hash: HASH,
  blockHash: BLOCK_HASH,
  blockNumber: 100,
  gasUsed: 21000n,
  status: 1,
  logs: [
    {
      address: '0x0000000000000000000000000000000000000001',
      data: '0x01',
      topics: [TOPIC],
      index: 0,
      transactionHash: HASH,
    },
  ],
  ...overrides,
});

describe('isBatchCallsId', () => {
  it('accepts a 32-byte hex transaction hash', () => {
    expect(isBatchCallsId(HASH)).toBe(true);
  });

  it('rejects anything wallet_sendCalls could not have returned', () => {
    expect(isBatchCallsId(undefined)).toBe(false);
    expect(isBatchCallsId('0x1234')).toBe(false);
    expect(isBatchCallsId('ab'.repeat(32))).toBe(false);
    expect(isBatchCallsId({id: HASH})).toBe(false);
  });
});

describe('buildCallsStatus', () => {
  it('reports a mined batch as 200 with its receipt in hex form', () => {
    expect(
      buildCallsStatus({id: HASH, caipChainId: 'eip155:1', receipt: receipt()}),
    ).toEqual({
      version: '2.0.0',
      id: HASH,
      chainId: '0x1',
      atomic: true,
      status: 200,
      receipts: [
        {
          logs: [
            {
              address: '0x0000000000000000000000000000000000000001',
              data: '0x01',
              topics: [TOPIC],
            },
          ],
          status: '0x1',
          blockHash: BLOCK_HASH,
          blockNumber: '0x64',
          gasUsed: '0x5208',
          transactionHash: HASH,
        },
      ],
    });
  });

  it('reports an on-chain revert as 500 with a 0x0 receipt', () => {
    const result = buildCallsStatus({
      id: HASH,
      caipChainId: 'eip155:295',
      receipt: receipt({status: 0, logs: []}),
    });

    expect(result.status).toBe(500);
    expect(result.chainId).toBe('0x127');
    expect(result.receipts).toEqual([
      expect.objectContaining({status: '0x0', logs: []}),
    ]);
  });

  it('reports a batch without a receipt as pending (100) and no receipts', () => {
    const result = buildCallsStatus({
      id: HASH,
      caipChainId: 'eip155:1',
      receipt: null,
    });

    expect(result).toEqual({
      version: '2.0.0',
      id: HASH,
      chainId: '0x1',
      atomic: true,
      status: 100,
    });
  });
});

describe('unknownBundleIdError', () => {
  it('uses the EIP-5792 unknown bundle id code', () => {
    expect(unknownBundleIdError()).toEqual({
      error: {code: 5730, message: 'Unknown bundle id'},
    });
  });
});
