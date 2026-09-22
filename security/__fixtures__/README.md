# Vault fixtures

`vault.v1.json` holds known-answer vectors for the vault v1 envelope, generated
by a plain Node `crypto` reference implementation with fixed salt, IV and DEK
(1000 PBKDF2 iterations so the test stays fast; the iteration count lives in
the envelope, so the code path is identical to production's 600k).

The same file is asserted by `security/vaultCore.test.js` when it runs in the
mobile repo (react-native-quick-crypto adapter, mocked to node:crypto under
Jest) and in the web repo (WebCrypto adapter). Both passing is the proof that
the two platforms read and write one envelope format.

Never change these vectors in place: a change means the envelope format
changed, which needs a new `v` and a migration.
