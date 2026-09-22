import * as vault from 'dok-wallet-blockchain-networks/security/vault';
import {VAULT_ERROR_CODES} from 'dok-wallet-blockchain-networks/security/errors';
import {
  base64Decode,
  base64Encode,
} from 'dok-wallet-blockchain-networks/security/bytes';
import * as secureStore from 'security/secureStore';
import * as vaultCore from 'dok-wallet-blockchain-networks/security/vaultCore';

// In-memory secure store with the knobs the vault needs to be tested against:
// a biometric capability flag, a prompt counter, and a way to simulate the
// platform invalidating the biometric key after an enrollment change.
// NB: `import * as secureStore` receives a *copy* of this object (babel's
// interopRequireWildcard, since the mock has no __esModule flag), so every
// knob must exist up front and be mutated in place, never reassigned.
jest.mock('security/secureStore', () => {
  const items = new Map();
  const options = {};
  const state = {
    invalidated: false,
    cancelNext: false,
    lockoutNext: false,
    prompts: 0,
    sensor: true,
    removes: [],
    failNextSetKey: null,
  };
  const mock = {
    capabilities: {biometric: true},
    __items: items,
    __options: options,
    __state: state,
    __reset() {
      items.clear();
      for (const key of Object.keys(options)) {
        delete options[key];
      }
      state.invalidated = false;
      state.cancelNext = false;
      state.lockoutNext = false;
      state.prompts = 0;
      state.sensor = true;
      state.removes.length = 0;
      state.failNextSetKey = null;
      mock.capabilities.biometric = true;
    },
    isBiometricAvailable: async () => state.sensor,
    async get(key, opts) {
      if (opts?.accessControl) {
        state.prompts += 1;
        const {SecureStoreError, SECURE_STORE_ERROR_CODES} = jest.requireActual(
          'dok-wallet-blockchain-networks/security/errors',
        );
        if (state.invalidated) {
          throw new SecureStoreError(SECURE_STORE_ERROR_CODES.KEY_INVALIDATED);
        }
        if (state.cancelNext) {
          state.cancelNext = false;
          throw new SecureStoreError(SECURE_STORE_ERROR_CODES.USER_CANCELLED);
        }
        if (state.lockoutNext) {
          state.lockoutNext = false;
          throw new SecureStoreError(SECURE_STORE_ERROR_CODES.LOCKED_OUT);
        }
      }
      return items.has(key) ? items.get(key) : null;
    },
    async set(key, value, opts) {
      if (opts?.accessControl) {
        state.prompts += 1;
      }
      if (state.failNextSetKey === key) {
        state.failNextSetKey = null;
        const {SecureStoreError, SECURE_STORE_ERROR_CODES} = jest.requireActual(
          'dok-wallet-blockchain-networks/security/errors',
        );
        throw new SecureStoreError(SECURE_STORE_ERROR_CODES.UNKNOWN);
      }
      items.set(key, value);
      options[key] = opts;
    },
    async remove(key) {
      state.removes.push(key);
      items.delete(key);
    },
    async has(key) {
      return items.has(key);
    },
  };
  return mock;
});

// Speed: the vault core's iteration count is a module constant; lowering it
// via the wrap options is not exposed by the vault API on purpose, so mock the
// core's constant instead. The core's own tests cover the real 600k value.
jest.mock('dok-wallet-blockchain-networks/security/vaultCore', () => {
  const actual = jest.requireActual(
    'dok-wallet-blockchain-networks/security/vaultCore',
  );
  // `gate`: a promise the state-key derivation waits on, so a test can
  // interleave lock()/unlock while HKDF is "in flight". `failNext`: reject once.
  const state = {gate: null, failNext: false};
  return {
    ...actual,
    __state: state,
    wrapDek: (dek, password, options = {}) =>
      actual.wrapDek(dek, password, {iterations: 1000, ...options}),
    deriveStateKey: async dek => {
      if (state.gate) {
        await state.gate;
      }
      if (state.failNext) {
        state.failNext = false;
        throw new Error('hkdf unavailable');
      }
      return actual.deriveStateKey(dek);
    },
  };
});

const payload = {
  v: 1,
  wallets: {w1: {phrase: 'twelve words here', coins: {}, deriveKeys: {}}},
};

describe('vault', () => {
  beforeEach(() => {
    vault.__resetForTests();
    secureStore.__reset();
  });

  it('starts locked with no vault', async () => {
    expect(vault.isUnlocked()).toBe(false);
    expect(await vault.hasVault()).toBe(false);
    await expect(vault.unlockWithPassword('x')).rejects.toMatchObject({
      code: VAULT_ERROR_CODES.NO_VAULT,
    });
    expect(() => vault.getStateKey()).toThrow(
      expect.objectContaining({code: VAULT_ERROR_CODES.LOCKED}),
    );
    await expect(vault.saveSecrets(payload)).rejects.toMatchObject({
      code: VAULT_ERROR_CODES.LOCKED,
    });
  });

  it('createVault writes the wrap and an empty blob and unlocks', async () => {
    await vault.createVault('pw');
    expect(vault.isUnlocked()).toBe(true);
    expect(await vault.hasVault()).toBe(true);
    expect(secureStore.__items.has('vault.dek.password')).toBe(true);
    expect(secureStore.__items.has('vault.blob')).toBe(true);
    expect(secureStore.__items.has('vault.dek.biometric')).toBe(false);
    expect(await vault.readSecrets()).toEqual({v: 1, wallets: {}});
    await expect(vault.createVault('pw')).rejects.toMatchObject({
      code: VAULT_ERROR_CODES.VAULT_EXISTS,
    });
  });

  it('saveSecrets → lock → unlockWithPassword returns the payload', async () => {
    await vault.createVault('pw');
    await vault.saveSecrets(payload);
    vault.lock();
    expect(vault.isUnlocked()).toBe(false);

    const unlocked = await vault.unlockWithPassword('pw');
    expect(unlocked).toEqual(payload);
    expect(vault.isUnlocked()).toBe(true);
    // The blob at rest never contains the plaintext.
    expect(secureStore.__items.get('vault.blob')).not.toContain('twelve');
  });

  it('wrong password fails and leaves the vault locked', async () => {
    await vault.createVault('pw');
    vault.lock();
    await expect(vault.unlockWithPassword('nope')).rejects.toMatchObject({
      code: VAULT_ERROR_CODES.INVALID_PASSWORD,
    });
    expect(vault.isUnlocked()).toBe(false);
  });

  it('verifyPassword answers true/false without changing lock state', async () => {
    await vault.createVault('pw');
    vault.lock();
    expect(await vault.verifyPassword('pw')).toBe(true);
    expect(await vault.verifyPassword('wrong')).toBe(false);
    expect(vault.isUnlocked()).toBe(false);
  });

  it('changePassword re-wraps the DEK and leaves the blob byte-identical', async () => {
    await vault.createVault('old');
    await vault.saveSecrets(payload);
    const blobBefore = secureStore.__items.get('vault.blob');
    const wrapBefore = JSON.parse(
      secureStore.__items.get('vault.dek.password'),
    );

    await vault.changePassword('old', 'new');

    expect(secureStore.__items.get('vault.blob')).toBe(blobBefore);
    const wrapAfter = JSON.parse(secureStore.__items.get('vault.dek.password'));
    expect(wrapAfter.ct).not.toBe(wrapBefore.ct);
    expect(wrapAfter.createdAt).toBe(wrapBefore.createdAt);
    vault.lock();
    await expect(vault.unlockWithPassword('old')).rejects.toMatchObject({
      code: VAULT_ERROR_CODES.INVALID_PASSWORD,
    });
    expect(await vault.unlockWithPassword('new')).toEqual(payload);
  });

  it('changePassword never changes the lock state', async () => {
    await vault.createVault('old');
    await vault.saveSecrets(payload);

    // Unlocked stays unlocked, with the same working DEK.
    await vault.changePassword('old', 'mid');
    expect(vault.isUnlocked()).toBe(true);
    expect(await vault.readSecrets()).toEqual(payload);

    // Locked stays locked: re-keying is not an unlock.
    vault.lock();
    await vault.changePassword('mid', 'new');
    expect(vault.isUnlocked()).toBe(false);
    expect(() => vault.getStateKey()).toThrow();
    expect(await vault.unlockWithPassword('new')).toEqual(payload);
  });

  it('changePassword leaves the old wrap and the lock state alone when the write fails', async () => {
    await vault.createVault('old');
    await vault.saveSecrets(payload);
    const wrapBefore = secureStore.__items.get('vault.dek.password');

    secureStore.__state.failNextSetKey = 'vault.dek.password';
    await expect(vault.changePassword('old', 'new')).rejects.toBeTruthy();

    expect(secureStore.__items.get('vault.dek.password')).toBe(wrapBefore);
    expect(vault.isUnlocked()).toBe(true);
    expect(await vault.readSecrets()).toEqual(payload);
    vault.lock();
    expect(await vault.verifyPassword('old')).toBe(true);
    expect(await vault.verifyPassword('new')).toBe(false);
  });

  it('changePassword rejects a wrong current password (fixes D1)', async () => {
    await vault.createVault('old');
    await expect(vault.changePassword('bad', 'new')).rejects.toMatchObject({
      code: VAULT_ERROR_CODES.INVALID_PASSWORD,
    });
    vault.lock();
    expect(await vault.verifyPassword('old')).toBe(true);
  });

  it('getStateKey is stable within an unlock, handed out as a copy, cleared on lock', async () => {
    await vault.createVault('pw');
    const a = await vault.getStateKey();
    const b = await vault.getStateKey();
    expect(a).not.toBe(b);
    expect(base64Encode(a)).toBe(base64Encode(b));
    expect(a).toHaveLength(32);
    const aBase64 = base64Encode(a);
    vault.lock();
    // lock() zeroises the vault's own buffer, not the copies it handed out.
    expect(base64Encode(a)).toBe(aBase64);
    await vault.unlockWithPassword('pw');
    const c = await vault.getStateKey();
    expect(base64Encode(c)).toBe(aBase64);
  });

  describe('biometric', () => {
    it('enableBiometric stores the raw DEK under the biometric policy', async () => {
      await vault.createVault('pw');
      await vault.saveSecrets(payload);
      expect(await vault.hasBiometric()).toBe(false);

      await vault.enableBiometric({title: 'Unlock'});

      expect(await vault.hasBiometric()).toBe(true);
      expect(secureStore.__options['vault.dek.biometric']).toEqual({
        accessControl: 'biometryCurrentSet',
        authenticationPrompt: {title: 'Unlock'},
      });
      vault.lock();
      const prompts = secureStore.__state.prompts;
      expect(await vault.unlockWithBiometric({title: 'Unlock'})).toEqual(
        payload,
      );
      expect(secureStore.__state.prompts).toBe(prompts + 1);
      expect(vault.isUnlocked()).toBe(true);
    });

    it('enableBiometric requires an unlocked vault', async () => {
      await vault.createVault('pw');
      vault.lock();
      await expect(vault.enableBiometric({title: 'x'})).rejects.toMatchObject({
        code: VAULT_ERROR_CODES.LOCKED,
      });
    });

    it('disableBiometric removes only that item', async () => {
      await vault.createVault('pw');
      await vault.enableBiometric({title: 'x'});
      await vault.disableBiometric();
      expect(secureStore.__items.has('vault.dek.biometric')).toBe(false);
      expect(secureStore.__items.has('vault.dek.password')).toBe(true);
      expect(secureStore.__items.has('vault.blob')).toBe(true);
    });

    it('not enrolled → BIOMETRIC_NOT_ENROLLED', async () => {
      await vault.createVault('pw');
      vault.lock();
      await expect(
        vault.unlockWithBiometric({title: 'x'}),
      ).rejects.toMatchObject({code: VAULT_ERROR_CODES.BIOMETRIC_NOT_ENROLLED});
    });

    it('invalidated key → item removed, BIOMETRIC_INVALIDATED, password still works', async () => {
      await vault.createVault('pw');
      await vault.enableBiometric({title: 'x'});
      vault.lock();
      secureStore.__state.invalidated = true;

      await expect(
        vault.unlockWithBiometric({title: 'x'}),
      ).rejects.toMatchObject({code: VAULT_ERROR_CODES.BIOMETRIC_INVALIDATED});
      expect(secureStore.__items.has('vault.dek.biometric')).toBe(false);
      expect(await vault.hasBiometric()).toBe(false);
      expect(vault.isUnlocked()).toBe(false);
      await vault.unlockWithPassword('pw');
      expect(vault.isUnlocked()).toBe(true);
    });

    it('user cancel → BIOMETRIC_CANCELLED, item kept', async () => {
      await vault.createVault('pw');
      await vault.enableBiometric({title: 'x'});
      vault.lock();
      secureStore.__state.cancelNext = true;
      await expect(
        vault.unlockWithBiometric({title: 'x'}),
      ).rejects.toMatchObject({code: VAULT_ERROR_CODES.BIOMETRIC_CANCELLED});
      expect(secureStore.__items.has('vault.dek.biometric')).toBe(true);
      expect(vault.isUnlocked()).toBe(false);
    });

    it('OS lockout after too many attempts → BIOMETRIC_LOCKED_OUT, item kept, password still works', async () => {
      await vault.createVault('pw');
      await vault.enableBiometric({title: 'x'});
      await vault.saveSecrets(payload);
      vault.lock();
      secureStore.__state.lockoutNext = true;
      await expect(
        vault.unlockWithBiometric({title: 'x'}),
      ).rejects.toMatchObject({code: VAULT_ERROR_CODES.BIOMETRIC_LOCKED_OUT});
      expect(secureStore.__items.has('vault.dek.biometric')).toBe(true);
      expect(vault.isUnlocked()).toBe(false);
      expect(await vault.unlockWithPassword('pw')).toEqual(payload);
    });

    it('no enrolled sensor (simulator, nothing enrolled): enable and unlock refuse, nothing prompts', async () => {
      await vault.createVault('pw');
      await vault.enableBiometric({title: 'x'});
      secureStore.__state.sensor = false;
      expect(await vault.isBiometricAvailable()).toBe(false);
      const prompts = secureStore.__state.prompts;
      await expect(vault.enableBiometric({title: 'x'})).rejects.toMatchObject({
        code: VAULT_ERROR_CODES.BIOMETRIC_UNSUPPORTED,
      });
      vault.lock();
      await expect(
        vault.unlockWithBiometric({title: 'x'}),
      ).rejects.toMatchObject({code: VAULT_ERROR_CODES.BIOMETRIC_UNSUPPORTED});
      expect(secureStore.__state.prompts).toBe(prompts);
      expect(vault.isUnlocked()).toBe(false);
    });

    it('enableBiometric deletes the old item before writing (policy is immutable on update)', async () => {
      await vault.createVault('pw');
      await vault.enableBiometric({title: 'x'});
      secureStore.__state.removes.length = 0;
      await vault.enableBiometric({title: 'y'});
      expect(secureStore.__state.removes).toEqual(['vault.dek.biometric']);
      expect(
        secureStore.__options['vault.dek.biometric'].authenticationPrompt,
      ).toEqual({
        title: 'y',
      });
    });

    it('platform without biometric storage (web) reports unsupported', async () => {
      secureStore.capabilities.biometric = false;
      await vault.createVault('pw');
      expect(vault.supportsBiometric()).toBe(false);
      expect(await vault.hasBiometric()).toBe(false);
      await expect(vault.enableBiometric({title: 'x'})).rejects.toMatchObject({
        code: VAULT_ERROR_CODES.BIOMETRIC_UNSUPPORTED,
      });
      await expect(
        vault.unlockWithBiometric({title: 'x'}),
      ).rejects.toMatchObject({code: VAULT_ERROR_CODES.BIOMETRIC_UNSUPPORTED});
    });
  });

  it('destroy removes all three items and locks', async () => {
    await vault.createVault('pw');
    await vault.saveSecrets(payload);
    await vault.enableBiometric({title: 'x'});
    await vault.destroy();
    expect(vault.isUnlocked()).toBe(false);
    expect(secureStore.__items.size).toBe(0);
    expect(await vault.hasVault()).toBe(false);
  });

  it('needsKdfUpgrade is true for the lowered test iteration count', async () => {
    await vault.createVault('pw');
    expect(await vault.needsKdfUpgrade()).toBe(true);
  });

  it('unlockWithPassword re-wraps the DEK when the stored KDF parameters are stale', async () => {
    const actualCore = jest.requireActual(
      'dok-wallet-blockchain-networks/security/vaultCore',
    );
    await vault.createVault('pw'); // mocked wrap: 1000 iterations = stale
    const before = JSON.parse(secureStore.__items.get('vault.dek.password'));
    expect(before.kdf.iterations).toBe(1000);
    expect(actualCore.isKdfStale(before)).toBe(true);
    vault.lock();
    await vault.unlockWithPassword('pw');
    const after = JSON.parse(secureStore.__items.get('vault.dek.password'));
    // The re-wrap goes through the (mocked) wrapDek too, so iterations stay at
    // the test value; what proves the upgrade ran is a fresh wrap with the
    // original createdAt preserved and a newer updatedAt.
    expect(after.ct).not.toBe(before.ct);
    expect(after.createdAt).toBe(before.createdAt);
    expect(after.updatedAt).toBeGreaterThanOrEqual(before.updatedAt);
    vault.lock();
    expect(await vault.verifyPassword('pw')).toBe(true);
  });

  it('a failed KDF re-wrap write neither blocks the unlock nor touches the old wrap', async () => {
    await vault.createVault('pw'); // stale by construction (mocked 1000 iterations)
    await vault.saveSecrets(payload);
    vault.lock();
    const before = secureStore.__items.get('vault.dek.password');

    secureStore.__state.failNextSetKey = 'vault.dek.password';
    await expect(vault.unlockWithPassword('pw')).resolves.toEqual(payload);

    expect(vault.isUnlocked()).toBe(true);
    expect(secureStore.__state.failNextSetKey).toBeNull(); // the write was attempted
    expect(secureStore.__items.get('vault.dek.password')).toBe(before);
    expect(await vault.needsKdfUpgrade()).toBe(true); // caller can report it
    vault.lock();
    expect(await vault.verifyPassword('pw')).toBe(true);
  });

  it('an unreadable blob leaves the vault locked and does not attempt the re-wrap', async () => {
    await vault.createVault('pw');
    await vault.saveSecrets(payload);
    vault.lock();
    const blob = JSON.parse(secureStore.__items.get('vault.blob'));
    const ct = base64Decode(blob.ct);
    ct[0] = (ct[0] + 1) % 256; // flip one ciphertext byte → GCM auth fails
    blob.ct = base64Encode(ct);
    secureStore.__items.set('vault.blob', JSON.stringify(blob));
    const wrapBefore = secureStore.__items.get('vault.dek.password');

    // Not INVALID_PASSWORD: the Login screen must not count this as an attempt.
    await expect(vault.unlockWithPassword('pw')).rejects.toMatchObject({
      code: VAULT_ERROR_CODES.CORRUPT_ENVELOPE,
    });

    expect(vault.isUnlocked()).toBe(false);
    expect(() => vault.getStateKey()).toThrow();
    expect(secureStore.__items.get('vault.dek.password')).toBe(wrapBefore);
  });

  describe('getStateKey while the vault changes underneath', () => {
    afterEach(() => {
      vaultCore.__state.gate = null;
      vaultCore.__state.failNext = false;
    });

    it('a derivation that lands after lock() rejects and stores nothing', async () => {
      await vault.createVault('pw');
      let open;
      vaultCore.__state.gate = new Promise(resolve => (open = resolve));
      const pending = vault.getStateKey();
      vault.lock();
      open();
      await expect(pending).rejects.toMatchObject({
        code: VAULT_ERROR_CODES.LOCKED,
      });
      expect(vault.isUnlocked()).toBe(false);
      expect(() => vault.getStateKey()).toThrow();
    });

    it("a derivation from a previous DEK never becomes the new vault's state key", async () => {
      await vault.createVault('pw');
      const oldKey = base64Encode(await vault.getStateKey());
      vault.lock();
      await vault.unlockWithPassword('pw'); // memo cleared; derivation runs again
      let open;
      vaultCore.__state.gate = new Promise(resolve => (open = resolve));
      const pending = vault.getStateKey(); // in flight for the OLD dek
      await vault.destroy();
      await vault.createVault('pw2'); // brand-new DEK
      vaultCore.__state.gate = null;
      open();
      await expect(pending).rejects.toMatchObject({
        code: VAULT_ERROR_CODES.LOCKED,
      });
      const newKey = base64Encode(await vault.getStateKey());
      expect(newKey).not.toBe(oldKey);
    });

    it('a failed derivation does not poison later calls in the same unlock', async () => {
      await vault.createVault('pw');
      vaultCore.__state.failNext = true;
      await expect(vault.getStateKey()).rejects.toThrow('hkdf unavailable');
      expect(vault.isUnlocked()).toBe(true);
      expect(await vault.getStateKey()).toHaveLength(32);
    });
  });
});
