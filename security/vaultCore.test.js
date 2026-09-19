import {
  AAD,
  KDF_ALG,
  KDF_ITERATIONS,
  decryptBlob,
  decryptString,
  deriveStateKey,
  encryptBlob,
  encryptString,
  generateDek,
  isKdfStale,
  unwrapDek,
  wrapDek,
} from 'dok-wallet-blockchain-networks/security/vaultCore';
import {VAULT_ERROR_CODES} from 'dok-wallet-blockchain-networks/security/errors';
import {
  base64Decode,
  base64Encode,
  bytesEqual,
} from 'dok-wallet-blockchain-networks/security/bytes';
import fixture from 'dok-wallet-blockchain-networks/security/__fixtures__/vault.v1.json';

// 600k PBKDF2 per wrap is the production cost, not a unit-test cost. The
// iteration count travels in the envelope, so the low value here exercises the
// exact same code path.
const FAST = {iterations: 1000};

describe('vaultCore', () => {
  describe('constants', () => {
    it('uses the approved KDF parameters by default', () => {
      expect(KDF_ALG).toBe('pbkdf2-sha256');
      expect(KDF_ITERATIONS).toBe(600000);
      expect(AAD).toEqual({
        dek: 'dok.dek.password.v1',
        vault: 'dok.vault.v1',
        state: 'dok.state.v1',
      });
    });
  });

  describe('wrapDek / unwrapDek', () => {
    it('round-trips the DEK under the password', async () => {
      const dek = generateDek();
      const envelope = await wrapDek(dek, 'correct horse', FAST);
      expect(envelope.v).toBe(1);
      expect(envelope.kdf).toEqual({
        alg: 'pbkdf2-sha256',
        iterations: 1000,
        salt: expect.any(String),
      });
      expect(base64Decode(envelope.kdf.salt)).toHaveLength(32);
      expect(base64Decode(envelope.iv)).toHaveLength(12);
      // 32-byte DEK + 16-byte tag, tag appended (WebCrypto shape).
      expect(base64Decode(envelope.ct)).toHaveLength(48);
      expect(envelope.aad).toBe(AAD.dek);
      expect(envelope.cipher).toBe('aes-256-gcm');
      expect(typeof envelope.createdAt).toBe('number');

      const unwrapped = await unwrapDek(envelope, 'correct horse');
      expect(bytesEqual(unwrapped, dek)).toBe(true);
    });

    it('rejects a wrong password via GCM authentication, not comparison', async () => {
      const envelope = await wrapDek(generateDek(), 'right', FAST);
      await expect(unwrapDek(envelope, 'wrong')).rejects.toMatchObject({
        name: 'VaultError',
        code: VAULT_ERROR_CODES.INVALID_PASSWORD,
      });
    });

    it('rejects a tampered ciphertext', async () => {
      const envelope = await wrapDek(generateDek(), 'pw', FAST);
      const ct = base64Decode(envelope.ct);
      ct[3] ^= 0xff;
      await expect(
        unwrapDek({...envelope, ct: base64Encode(ct)}, 'pw'),
      ).rejects.toMatchObject({code: VAULT_ERROR_CODES.INVALID_PASSWORD});
    });

    it('rejects a DEK envelope replayed with the wrong AAD', async () => {
      const envelope = await wrapDek(generateDek(), 'pw', FAST);
      await expect(
        unwrapDek({...envelope, aad: AAD.vault}, 'pw'),
      ).rejects.toMatchObject({code: VAULT_ERROR_CODES.UNSUPPORTED_ENVELOPE});
    });

    it('rejects unknown versions, ciphers and KDFs before touching crypto', async () => {
      const envelope = await wrapDek(generateDek(), 'pw', FAST);
      for (const bad of [
        {...envelope, v: 2},
        {...envelope, cipher: 'aes-256-cbc'},
        {...envelope, kdf: {...envelope.kdf, alg: 'argon2id'}},
      ]) {
        await expect(unwrapDek(bad, 'pw')).rejects.toMatchObject({
          code: VAULT_ERROR_CODES.UNSUPPORTED_ENVELOPE,
        });
      }
      await expect(unwrapDek(null, 'pw')).rejects.toMatchObject({
        code: VAULT_ERROR_CODES.CORRUPT_ENVELOPE,
      });
      await expect(
        unwrapDek({...envelope, ct: 'not base64 at all!!'}, 'pw'),
      ).rejects.toMatchObject({code: VAULT_ERROR_CODES.CORRUPT_ENVELOPE});
    });

    it('uses a fresh salt and IV for every wrap', async () => {
      const dek = generateDek();
      const a = await wrapDek(dek, 'pw', FAST);
      const b = await wrapDek(dek, 'pw', FAST);
      expect(a.kdf.salt).not.toBe(b.kdf.salt);
      expect(a.iv).not.toBe(b.iv);
      expect(a.ct).not.toBe(b.ct);
    });
  });

  describe('encryptBlob / decryptBlob', () => {
    const payload = {v: 1, wallets: {abc: {phrase: 'word '.repeat(12).trim()}}};

    it('round-trips a JSON payload under the DEK', async () => {
      const dek = generateDek();
      const blob = await encryptBlob(dek, payload);
      expect(blob).toEqual({
        v: 1,
        cipher: 'aes-256-gcm',
        iv: expect.any(String),
        ct: expect.any(String),
        aad: AAD.vault,
      });
      expect(JSON.stringify(blob)).not.toContain('word');
      expect(await decryptBlob(dek, blob)).toEqual(payload);
    });

    it('fails with the wrong DEK', async () => {
      const blob = await encryptBlob(generateDek(), payload);
      await expect(decryptBlob(generateDek(), blob)).rejects.toMatchObject({
        code: VAULT_ERROR_CODES.INVALID_PASSWORD,
      });
    });

    it('will not decrypt a blob whose AAD says it is a DEK envelope', async () => {
      const dek = generateDek();
      const blob = await encryptBlob(dek, payload);
      await expect(
        decryptBlob(dek, {...blob, aad: AAD.dek}),
      ).rejects.toMatchObject({code: VAULT_ERROR_CODES.UNSUPPORTED_ENVELOPE});
    });
  });

  describe('state sealing', () => {
    it('derives a stable 32-byte state key from the DEK', async () => {
      const dek = generateDek();
      const k1 = await deriveStateKey(dek);
      const k2 = await deriveStateKey(dek);
      expect(k1).toHaveLength(32);
      expect(bytesEqual(k1, k2)).toBe(true);
      expect(bytesEqual(k1, dek)).toBe(false);
      expect(bytesEqual(await deriveStateKey(generateDek()), k1)).toBe(false);
    });

    it('round-trips a redux-persist slice string under the state key', async () => {
      const key = await deriveStateKey(generateDek());
      const slice = JSON.stringify({allWallets: '[]', _persist: '{}'});
      const sealed = await encryptString(key, slice);
      expect(sealed.aad).toBe(AAD.state);
      expect(sealed.ct).not.toContain('allWallets');
      expect(await decryptString(key, sealed)).toBe(slice);
    });
  });

  describe('isKdfStale', () => {
    it('flags envelopes below the current iteration count or with another alg', async () => {
      const current = await wrapDek(generateDek(), 'pw', {
        iterations: KDF_ITERATIONS,
      });
      const old = await wrapDek(generateDek(), 'pw', FAST);
      expect(isKdfStale(current)).toBe(false);
      expect(isKdfStale(old)).toBe(true);
      expect(isKdfStale({...current, kdf: {...current.kdf, alg: 'x'}})).toBe(
        true,
      );
    }, 20000);
  });

  describe('cross-platform fixture', () => {
    // Generated once by a Node reference implementation (see
    // __fixtures__/README.md). The same file is asserted by the mobile adapter
    // (quick-crypto) and the web adapter (WebCrypto), which is what proves the
    // two platforms produce and read one envelope format.
    it('unwraps the fixture DEK and decrypts the fixture blob', async () => {
      const dek = await unwrapDek(fixture.dekEnvelope, fixture.password);
      expect(base64Encode(dek)).toBe(fixture.dekBase64);
      expect(await decryptBlob(dek, fixture.blobEnvelope)).toEqual(
        fixture.vaultPayload,
      );
      const stateKey = await deriveStateKey(dek);
      expect(base64Encode(stateKey)).toBe(fixture.stateKeyBase64);
      expect(await decryptString(stateKey, fixture.sealedState)).toBe(
        fixture.statePlaintext,
      );
    });

    it('rejects the fixture with the wrong password', async () => {
      await expect(
        unwrapDek(fixture.dekEnvelope, fixture.password + 'x'),
      ).rejects.toMatchObject({code: VAULT_ERROR_CODES.INVALID_PASSWORD});
    });
  });
});
