// TON Connect sign-data hashing (spec: ton-blockchain/ton-connect spec/rpc.md,
// "Sign Data"). Pure functions so they can be unit-tested without the chain.
import {beginCell, Cell} from '@ton/core';
import {sha256_sync} from '@ton/crypto';
import {Buffer} from 'buffer';

// Standard CRC-32 (IEEE 802.3, identical to zlib). TON uses it for TL-B
// scheme hashes; @ton/core only ships crc32c, which is a different polynomial.
const CRC32_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

export const crc32 = bytes => {
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) {
    crc = CRC32_TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
};

// TEP-81 DNS internal representation: labels reversed, each terminated by
// 0x00 ("ton-connect.github.io" -> "io\0github\0ton-connect\0"). The cell
// variant of sign-data stores the app domain in this form.
export const encodeDnsName = domain => {
  if (typeof domain !== 'string' || !domain) {
    throw new Error('Domain must be a non-empty string');
  }
  let normalized = domain.toLowerCase();
  if (normalized.endsWith('.')) {
    normalized = normalized.slice(0, -1);
  }
  const labels = normalized.split('.');
  labels.forEach(label => {
    if (!label) {
      throw new Error('Domain contains an empty label');
    }
    // eslint-disable-next-line no-control-regex
    if (/[\x00-\x20]/.test(label) || label.length > 63) {
      throw new Error(`Invalid domain label "${label}"`);
    }
  });
  const encoded = labels
    .reverse()
    .map(label => `${label}\0`)
    .join('');
  if (Buffer.byteLength(encoded, 'utf8') > 126) {
    throw new Error('Encoded domain exceeds 126 bytes');
  }
  return encoded;
};

// message#75569022 schema_hash:uint32 timestamp:uint64 userAddress:MsgAddress
//   {n:#} appDomain:^(SnakeData ~n) payload:^Cell = Message;
// Signature is Ed25519 over the cell representation hash (not sha256).
export const createCellHash = ({schema, cell, address, domain, timestamp}) => {
  const payloadCell = Cell.fromBase64(cell);
  const schemaHash = crc32(Buffer.from(schema, 'utf8'));
  const message = beginCell()
    .storeUint(0x75569022, 32)
    .storeUint(schemaHash, 32)
    .storeUint(timestamp, 64)
    .storeAddress(address)
    .storeStringRefTail(encodeDnsName(domain))
    .storeRef(payloadCell)
    .endCell();
  return Buffer.from(message.hash());
};

// message = 0xffff || "ton-connect/sign-data/" || workchain || address_hash
//   || domain_len || domain || timestamp || type_prefix || payload_len || payload
export const createTextBinaryHash = ({
  type,
  content,
  workChain,
  addressHash,
  domain,
  timestamp,
}) => {
  const wcBuffer = Buffer.alloc(4);
  wcBuffer.writeInt32BE(workChain);

  const domainBuffer = Buffer.from(domain, 'utf8');
  const domainLenBuffer = Buffer.alloc(4);
  domainLenBuffer.writeUInt32BE(domainBuffer.length);

  const tsBuffer = Buffer.alloc(8);
  tsBuffer.writeBigUInt64BE(BigInt(timestamp));

  const typePrefix = Buffer.from(type === 'text' ? 'txt' : 'bin');
  const payloadBuffer = Buffer.from(
    content,
    type === 'text' ? 'utf8' : 'base64',
  );
  const payloadLenBuffer = Buffer.alloc(4);
  payloadLenBuffer.writeUInt32BE(payloadBuffer.length);

  const message = Buffer.concat([
    Buffer.from([0xff, 0xff]),
    Buffer.from('ton-connect/sign-data/'),
    wcBuffer,
    addressHash,
    domainLenBuffer,
    domainBuffer,
    tsBuffer,
    typePrefix,
    payloadLenBuffer,
    payloadBuffer,
  ]);

  return sha256_sync(message);
};
