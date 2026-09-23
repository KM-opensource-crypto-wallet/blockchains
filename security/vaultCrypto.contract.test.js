// Contract test for whichever `security/vaultCrypto` adapter the host app
// resolves the alias to (mobile: react-native-quick-crypto, mocked to
// node:crypto under Jest; web: WebCrypto). Runs unchanged in both repos.
import * as vaultCrypto from 'security/vaultCrypto';
import {
  base64Decode,
  base64Encode,
  bytesEqual,
  utf8Decode,
  utf8Encode,
} from 'dok-wallet-blockchain-networks/security/bytes';
import {VAULT_CRYPTO_ERROR_CODES} from 'dok-wallet-blockchain-networks/security/errors';
import fixture from 'dok-wallet-blockchain-networks/security/__fixtures__/vault.v1.json';

const hex = s => new Uint8Array(s.match(/../g).map(b => parseInt(b, 16)));
const toHex = bytes =>
  Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');

describe('security/vaultCrypto adapter contract', () => {
  it('randomBytes returns fresh Uint8Arrays of the requested length', () => {
    const a = vaultCrypto.randomBytes(32);
    const b = vaultCrypto.randomBytes(32);
    expect(a).toBeInstanceOf(Uint8Array);
    expect(a).toHaveLength(32);
    expect(bytesEqual(a, b)).toBe(false);
    expect(vaultCrypto.randomBytes(12)).toHaveLength(12);
  });

  it('pbkdf2 matches the RFC 6070-style SHA-256 vectors', async () => {
    // password="password", salt="salt", c=1, dkLen=32
    expect(
      toHex(await vaultCrypto.pbkdf2('password', utf8Encode('salt'), 1, 32)),
    ).toBe('120fb6cffcf8b32c43e7225256c4f837a86548c92ccc35480805987cb70be17b');
    // c=4096
    expect(
      toHex(await vaultCrypto.pbkdf2('password', utf8Encode('salt'), 4096, 32)),
    ).toBe('c5e478d59288c841aa530db6845c4c8d962893a001ce4e11a4963873aa98134a');
  });

  it('hkdf matches RFC 5869 test case 1 (info as bytes) and accepts string info', async () => {
    const ikm = hex('0b'.repeat(22));
    const salt = hex('000102030405060708090a0b0c');
    const info = hex('f0f1f2f3f4f5f6f7f8f9');
    const okm = await vaultCrypto.hkdf(ikm, salt, info, 42);
    expect(toHex(okm)).toBe(
      '3cb25f25faacd57a90434f64d0362f2a2d2d0a90cf1a5a4c5db02d56ecc4c5bf34007208d5b887185865',
    );
    const asString = await vaultCrypto.hkdf(ikm, salt, 'dok.state.v1', 32);
    const asBytes = await vaultCrypto.hkdf(
      ikm,
      salt,
      utf8Encode('dok.state.v1'),
      32,
    );
    expect(toHex(asString)).toBe(toHex(asBytes));
  });

  it('aesGcm round-trips with the tag appended and fails on any change', async () => {
    const key = vaultCrypto.randomBytes(32);
    const iv = vaultCrypto.randomBytes(12);
    const plaintext = utf8Encode('hello vault');
    const ct = await vaultCrypto.aesGcmEncrypt(key, iv, plaintext, 'aad-1');
    expect(ct).toHaveLength(plaintext.length + 16);
    expect(
      utf8Decode(await vaultCrypto.aesGcmDecrypt(key, iv, ct, 'aad-1')),
    ).toBe('hello vault');

    const wrongKey = vaultCrypto.randomBytes(32);
    await expect(
      vaultCrypto.aesGcmDecrypt(wrongKey, iv, ct, 'aad-1'),
    ).rejects.toMatchObject({
      name: 'VaultCryptoError',
      code: VAULT_CRYPTO_ERROR_CODES.AUTH_FAILED,
    });
    await expect(
      vaultCrypto.aesGcmDecrypt(key, iv, ct, 'aad-2'),
    ).rejects.toMatchObject({
      code: VAULT_CRYPTO_ERROR_CODES.AUTH_FAILED,
    });
    const tampered = new Uint8Array(ct);
    tampered[0] ^= 1;
    await expect(
      vaultCrypto.aesGcmDecrypt(key, iv, tampered, 'aad-1'),
    ).rejects.toMatchObject({code: VAULT_CRYPTO_ERROR_CODES.AUTH_FAILED});
    const wrongIv = vaultCrypto.randomBytes(12);
    await expect(
      vaultCrypto.aesGcmDecrypt(key, wrongIv, ct, 'aad-1'),
    ).rejects.toMatchObject({code: VAULT_CRYPTO_ERROR_CODES.AUTH_FAILED});
  });

  it('decrypts the shared fixture produced by the Node reference implementation', async () => {
    const {dekEnvelope, blobEnvelope, password} = fixture;
    const kek = await vaultCrypto.pbkdf2(
      password,
      base64Decode(dekEnvelope.kdf.salt),
      dekEnvelope.kdf.iterations,
      32,
    );
    const dek = await vaultCrypto.aesGcmDecrypt(
      kek,
      base64Decode(dekEnvelope.iv),
      base64Decode(dekEnvelope.ct),
      dekEnvelope.aad,
    );
    expect(base64Encode(dek)).toBe(fixture.dekBase64);
    const blob = await vaultCrypto.aesGcmDecrypt(
      dek,
      base64Decode(blobEnvelope.iv),
      base64Decode(blobEnvelope.ct),
      blobEnvelope.aad,
    );
    expect(JSON.parse(utf8Decode(blob))).toEqual(fixture.vaultPayload);
  });
});
