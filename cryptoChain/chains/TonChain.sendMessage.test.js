/**
 * TonChain.sendRawTransaction (WalletConnect ton_sendMessage): reads the TON
 * Connect sendTransaction request from signTypeData, rejects an expired
 * `valid_until`, and passes a future one as the wallet transfer timeout.
 *
 * Runner: node-env jest config without the uuid mapper (like the Solana
 * suites). Network is stubbed at TonClient.prototype.open.
 */
import {Buffer} from 'buffer';
import {Cell, TonClient, WalletContractV4} from '@ton/ton';
import {keyPairFromSeed} from '@ton/crypto';
import {TonChain} from 'dok-wallet-blockchain-networks/cryptoChain/chains/TonChain';

jest.mock('dok-wallet-blockchain-networks/helper', () => ({
  convertToSmallAmount: jest.fn(),
  getExplorerTxUrl: jest.fn(),
  isValidStringWithValue: jest.fn(v => typeof v === 'string' && v.length > 0),
  parseBalance: jest.fn(v => v),
}));
jest.mock('dok-wallet-blockchain-networks/rpcUrls/rpcUrls', () => ({
  getRPCUrl: jest.fn(() => 'http://localhost'),
}));
jest.mock('dok-wallet-blockchain-networks/rpcUrls/rpcSession', () => ({
  buildRpcProxyUrl: jest.fn(() => null),
  rpcSessionAdapter: jest.fn(),
}));
jest.mock('dok-wallet-blockchain-networks/service/tonScan', () => ({
  TonScan: {},
}));
jest.mock('utils/wlData', () => ({WL_APP_NAME: 'DOK Wallet'}), {
  virtual: true,
});

const seed = Buffer.alloc(32, 9);
const privateKey = seed.toString('hex');
const keyPair = keyPairFromSeed(seed);
const wallet = WalletContractV4.create({
  publicKey: keyPair.publicKey,
  workchain: 0,
});
const SEQNO = 7;
const RECIPIENT = 'EQD2NmD_lH5f5u1Kj3KfGyTvhZSX0Eg6qp2a5IQUKXxOG21n';

const nowSeconds = () => Math.floor(Date.now() / 1000);

// WalletV4 signing message: signature(512) · subwallet_id(32) · valid_until(32)
// · seqno(32). Reads valid_until straight out of the returned external boc.
const readValidUntil = boc => {
  const slice = Cell.fromBase64(boc).beginParse();
  slice.skip(512);
  slice.loadUint(32); // subwallet_id
  return slice.loadUint(32);
};

const request = overrides => ({
  valid_until: nowSeconds() + 300,
  network: '-239',
  from: wallet.address.toRawString(),
  messages: [{address: RECIPIENT, amount: '1000000'}],
  ...overrides,
});

describe('TonChain.sendRawTransaction (ton_sendMessage)', () => {
  let opened;
  beforeEach(() => {
    jest.spyOn(console, 'error').mockImplementation(() => {});
    opened = {
      getSeqno: jest.fn(async () => SEQNO),
      send: jest.fn(async () => {}),
      createTransfer: jest.fn(args => wallet.createTransfer(args)),
    };
    jest.spyOn(TonClient.prototype, 'open').mockReturnValue(opened);
  });
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('passes a future valid_until (seconds) as the transfer timeout', async () => {
    const validUntil = nowSeconds() + 300;
    const {boc} = await TonChain().sendRawTransaction({
      signTypeData: [request({valid_until: validUntil})],
      privateKey,
    });

    expect(opened.createTransfer).toHaveBeenCalledTimes(1);
    const args = opened.createTransfer.mock.calls[0][0];
    expect(args).toMatchObject({seqno: SEQNO, timeout: validUntil});
    expect(args.messages).toHaveLength(1);
    expect(args.secretKey).toEqual(keyPair.secretKey);
    expect(readValidUntil(boc)).toBe(validUntil);
    expect(opened.send).toHaveBeenCalledTimes(1);
  });

  it('rejects an expired valid_until before reading the seqno or sending', async () => {
    await expect(
      TonChain().sendRawTransaction({
        signTypeData: [request({valid_until: nowSeconds() - 1})],
        privateKey,
      }),
    ).rejects.toThrow(/expired/);
    expect(opened.getSeqno).not.toHaveBeenCalled();
    expect(opened.send).not.toHaveBeenCalled();
  });

  it('treats a millisecond valid_until as milliseconds', async () => {
    const validUntilMs = Date.now() + 300_000;
    const {boc} = await TonChain().sendRawTransaction({
      signTypeData: request({valid_until: validUntilMs}),
      privateKey,
    });
    const expected = Math.floor(validUntilMs / 1000);
    expect(opened.createTransfer.mock.calls[0][0].timeout).toBe(expected);
    expect(readValidUntil(boc)).toBe(expected);
  });

  it('keeps the SDK default timeout when valid_until is absent', async () => {
    const before = nowSeconds();
    const {boc} = await TonChain().sendRawTransaction({
      signTypeData: [request({valid_until: undefined})],
      privateKey,
    });
    expect(opened.createTransfer.mock.calls[0][0].timeout).toBeUndefined();
    const validUntil = readValidUntil(boc);
    expect(validUntil).toBeGreaterThanOrEqual(before + 55);
    expect(validUntil).toBeLessThanOrEqual(before + 65);
  });

  it('rejects a non-numeric valid_until', async () => {
    await expect(
      TonChain().sendRawTransaction({
        signTypeData: [request({valid_until: 'soon'})],
        privateKey,
      }),
    ).rejects.toThrow(/Invalid ton_sendMessage valid_until/);
    expect(opened.send).not.toHaveBeenCalled();
  });

  it('rejects a request without messages instead of sending an empty transfer', async () => {
    await expect(
      TonChain().sendRawTransaction({
        signTypeData: [request({messages: []})],
        privateKey,
      }),
    ).rejects.toThrow(/messages are required/);
    expect(opened.send).not.toHaveBeenCalled();
  });
});
