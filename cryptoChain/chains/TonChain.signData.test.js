import {Address, WalletContractV4} from '@ton/ton';
import {keyPairFromSeed, signVerify} from '@ton/crypto';
import {TonChain} from 'dok-wallet-blockchain-networks/cryptoChain/chains/TonChain';
import {
  createCellHash,
  createTextBinaryHash,
} from 'dok-wallet-blockchain-networks/helper/tonSignData';

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

// eslint-disable-next-line no-undef
const B = Buffer;
const seed = B.alloc(32, 9);
const privateKey = seed.toString('hex');
const keyPair = keyPairFromSeed(seed);
const wallet = WalletContractV4.create({
  publicKey: keyPair.publicKey,
  workchain: 0,
});
const otherWallet = WalletContractV4.create({
  publicKey: keyPairFromSeed(B.alloc(32, 10)).publicKey,
  workchain: 0,
});

const EMPTY_CELL = 'te6ccgEBAQEAAgAAAA==';
const DOMAIN_URL = 'https://lab.reown.com';

const signData = payload =>
  TonChain().signMessage({
    signTypeData: payload,
    privateKey,
    domain: DOMAIN_URL,
  });

describe('TonChain.signMessage (ton_signData)', () => {
  beforeEach(() => {
    jest.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => {
    console.error.mockRestore();
  });

  it('signs a "cell" payload per the TON Connect cell layout', async () => {
    const payload = {type: 'cell', schema: 'opaque', cell: EMPTY_CELL};

    const result = await signData(payload);

    expect(result.address).toBe(wallet.address.toString());
    expect(result.domain).toBe('lab.reown.com');
    expect(result.payload).toEqual(payload);
    expect(typeof result.timestamp).toBe('number');

    const signature = B.from(result.signature, 'base64');
    expect(signature).toHaveLength(64);
    const expectedHash = createCellHash({
      schema: 'opaque',
      cell: EMPTY_CELL,
      address: wallet.address,
      domain: 'lab.reown.com',
      timestamp: result.timestamp,
    });
    expect(signVerify(expectedHash, signature, keyPair.publicKey)).toBe(true);
  });

  it('rejects a "cell" payload whose cell is not a valid BoC', async () => {
    await expect(
      signData({type: 'cell', schema: 'opaque', cell: 'not-a-boc'}),
    ).rejects.toThrow('Invalid ton_signData cell payload');
  });

  it('rejects a "cell" payload with an empty schema', async () => {
    await expect(
      signData({type: 'cell', schema: '', cell: EMPTY_CELL}),
    ).rejects.toThrow('Invalid ton_signData cell payload');
  });

  it('refuses to sign when "from" is not the connected wallet address', async () => {
    await expect(
      signData({
        type: 'text',
        text: 'hello',
        from: otherWallet.address.toString(),
      }),
    ).rejects.toThrow(/Cannot sign from/);
  });

  it('accepts "from" in raw or friendly form when it is the wallet address', async () => {
    const raw = wallet.address.toRawString();
    const friendly = wallet.address.toString();
    await expect(
      signData({type: 'text', text: 'hello', from: raw}),
    ).resolves.toMatchObject({address: friendly});
    await expect(
      signData({type: 'text', text: 'hello', from: friendly}),
    ).resolves.toMatchObject({address: friendly});
  });

  it('still signs "text" payloads with the flat-bytes sha256 scheme', async () => {
    const result = await signData({type: 'text', text: 'Confirm action'});
    const expectedHash = createTextBinaryHash({
      type: 'text',
      content: 'Confirm action',
      workChain: wallet.address.workChain,
      addressHash: wallet.address.hash,
      domain: 'lab.reown.com',
      timestamp: result.timestamp,
    });
    expect(
      signVerify(
        B.from(expectedHash),
        B.from(result.signature, 'base64'),
        keyPair.publicKey,
      ),
    ).toBe(true);
    expect(Address.parse(result.address).equals(wallet.address)).toBe(true);
  });

  it('still rejects unknown payload types', async () => {
    await expect(signData({type: 'json', data: {}})).rejects.toThrow(
      'Unsupported ton_signData type',
    );
  });
});
