import zlib from 'zlib';
import {Address, beginCell, Cell} from '@ton/core';
import {keyPairFromSeed, sign, signVerify, sha256_sync} from '@ton/crypto';
import {
  crc32,
  encodeDnsName,
  createCellHash,
  createTextBinaryHash,
} from 'dok-wallet-blockchain-networks/helper/tonSignData';

// eslint-disable-next-line no-undef
const B = Buffer;

describe('crc32 (IEEE, as used for TON schema hashes)', () => {
  it('matches the standard check vector for "123456789"', () => {
    expect(crc32(B.from('123456789'))).toBe(0xcbf43926);
  });

  it('matches zlib.crc32 for arbitrary inputs and is unsigned', () => {
    const samples = [
      '',
      'opaque',
      'transfer query_id:uint64 amount:(VarUInteger 16) = InternalMsgBody',
      B.alloc(300, 0xff),
      B.from([0, 1, 2, 3, 254, 255]),
    ];
    samples.forEach(s => {
      const buf = B.isBuffer(s) ? s : B.from(s, 'utf8');
      expect(crc32(buf)).toBe(zlib.crc32(buf));
      expect(crc32(buf)).toBeGreaterThanOrEqual(0);
    });
  });
});

describe('encodeDnsName (TEP-81 wire format)', () => {
  it('reverses labels and terminates each with \\0 (doc example)', () => {
    expect(encodeDnsName('ton-connect.github.io')).toBe(
      'io\0github\0ton-connect\0',
    );
  });

  it('lower-cases and strips a trailing dot', () => {
    expect(encodeDnsName('Lab.Reown.com.')).toBe('com\0reown\0lab\0');
  });

  it('rejects empty labels and control/space characters', () => {
    expect(() => encodeDnsName('a..b')).toThrow();
    expect(() => encodeDnsName('a b.com')).toThrow();
    expect(() => encodeDnsName('')).toThrow();
  });
});

describe('createCellHash (TON Connect sign-data, type "cell")', () => {
  const keyPair = keyPairFromSeed(B.alloc(32, 3));
  const address = Address.parse(
    '0:0000000000000000000000000000000000000000000000000000000000000001',
  );
  const params = {
    schema: 'opaque',
    cell: 'te6ccgEBAQEAAgAAAA==', // AppKit Lab's empty-cell example
    address,
    domain: 'lab.reown.com',
    timestamp: 1700000000,
  };

  it('equals the spec layout built independently', () => {
    const expected = beginCell()
      .storeUint(0x75569022, 32)
      .storeUint(zlib.crc32(B.from('opaque', 'utf8')), 32)
      .storeUint(1700000000, 64)
      .storeAddress(address)
      .storeStringRefTail('com\0reown\0lab\0')
      .storeRef(Cell.fromBase64('te6ccgEBAQEAAgAAAA=='))
      .endCell()
      .hash();

    const actual = createCellHash(params);
    expect(B.isBuffer(actual)).toBe(true);
    expect(actual).toHaveLength(32);
    expect(actual.equals(expected)).toBe(true);
  });

  it('produces a hash whose Ed25519 signature verifies', () => {
    const hash = createCellHash(params);
    const signature = sign(hash, keyPair.secretKey);
    expect(signVerify(hash, signature, keyPair.publicKey)).toBe(true);
  });

  it('changes when schema, timestamp, domain, address or cell change', () => {
    const base = createCellHash(params).toString('hex');
    const variants = [
      {schema: 'other'},
      {timestamp: 1700000001},
      {domain: 'evil.example'},
      {address: Address.parse('0:' + '2'.repeat(64))},
      {cell: beginCell().storeUint(1, 8).endCell().toBoc().toString('base64')},
    ];
    variants.forEach(v => {
      expect(createCellHash({...params, ...v}).toString('hex')).not.toBe(base);
    });
  });
});

describe('createTextBinaryHash (moved, unchanged)', () => {
  it('still equals the flat-bytes sha256 formula', () => {
    const domain = 'lab.reown.com';
    const timestamp = 1700000000;
    const workChain = 0;
    const addressHash = B.alloc(32, 7);
    const text = 'Confirm action in AppKit';

    const wc = B.alloc(4);
    wc.writeInt32BE(workChain);
    const dom = B.from(domain, 'utf8');
    const domLen = B.alloc(4);
    domLen.writeUInt32BE(dom.length);
    const ts = B.alloc(8);
    ts.writeBigUInt64BE(BigInt(timestamp));
    const payload = B.from(text, 'utf8');
    const payloadLen = B.alloc(4);
    payloadLen.writeUInt32BE(payload.length);
    const expected = sha256_sync(
      B.concat([
        B.from([0xff, 0xff]),
        B.from('ton-connect/sign-data/'),
        wc,
        addressHash,
        domLen,
        dom,
        ts,
        B.from('txt'),
        payloadLen,
        payload,
      ]),
    );

    const actual = createTextBinaryHash({
      type: 'text',
      content: text,
      workChain,
      addressHash,
      domain,
      timestamp,
    });
    expect(B.from(actual).equals(B.from(expected))).toBe(true);
  });
});
