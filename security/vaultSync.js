// Keeps the vault blob in step with the in-memory wallets slice.
//
// A redux listener watches every `wallets/*` action that changes `allWallets`,
// extracts the secrets payload and writes it to the vault:
//   - immediately for the actions that create new key material (a kill
//     between the stripped `persist:wallets` write and the vault write would
//     otherwise persist a wallet without its key — spec §12.3.4);
//   - debounced for everything else (balance refreshes touch allWallets
//     constantly but never change the payload; the string compare skips them).
// `wallets/resetWallet` empties the vault but keeps it (the web "Reset
// Wallet" flow keeps the account and creates new wallets right after);
// `auth/logOutSuccess` — dispatched only when the account itself goes (Forgot,
// Delete Account, too many failed attempts) — destroys it. A non-empty payload
// while the vault is locked is reported (`vault.write_while_locked`) and
// dropped.
//
// Both apps add `middleware` to their store and call `flush()` when going to
// background / on pagehide, next to `persistor.flush()`.
import {createListenerMiddleware} from '@reduxjs/toolkit';
import {captureError} from 'services/logger';
import * as vault from './vault';
import {
  extractVaultPayload,
  vaultPayloadHasSecrets,
} from '../redux/wallets/walletSecrets';

export const VAULT_SYNC_DEBOUNCE_MS = 500;
// A failed vault write keeps its snapshot dirty and retries with doubling
// delay (starting at the debounce) up to this cap; flush() and the next
// wallets change retry it sooner. Dropping it would leave `persist:wallets`
// holding a stripped wallet whose keys never reached the vault.
export const VAULT_SYNC_MAX_RETRY_MS = 30000;

export const IMMEDIATE_VAULT_WRITE_ACTIONS = Object.freeze([
  'wallets/createWallet/fulfilled',
  'wallets/createWalletsBatch/fulfilled',
  'wallets/addToken/fulfilled',
  'wallets/addCoinGroup/fulfilled',
  'wallets/addOrToggleCoinInWallet/fulfilled',
  'wallets/addEVMAndTronDeriveAddresses/fulfilled',
  'wallets/add50AddressesOnCurrentCoin/fulfilled',
  'wallets/addCustomDeriveAddress/fulfilled',
  'wallets/setWalletHideSettings',
]);

const RESET_ACTION = 'wallets/resetWallet';
const LOGOUT_ACTION = 'auth/logOutSuccess';

export const createVaultSync = ({
  debounceMs = VAULT_SYNC_DEBOUNCE_MS,
  onError = captureError,
} = {}) => {
  const listener = createListenerMiddleware();
  let lastWritten = null;
  let timer = null;
  // The newest snapshot waiting for the debounce / retry timer, or null.
  let pending = null;
  let retryDelayMs = debounceMs;
  let chain = Promise.resolve();
  // Bumped every time a snapshot is taken from the store (or reset/logout
  // supersedes everything). A failed write may only re-arm its own snapshot
  // while that snapshot is still the newest one: a stale retry landing after
  // a reset or a newer write would put old key material back into the vault.
  let revision = 0;

  const takeSnapshot = allWallets => ({wallets: allWallets, rev: ++revision});
  const takePending = () => {
    const snapshot = pending;
    pending = null;
    return snapshot;
  };

  const enqueue = task => {
    chain = chain.then(task, task);
    return chain;
  };

  const cancelTimer = () => {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
  };

  const armTimer = delayMs => {
    cancelTimer();
    timer = setTimeout(() => {
      timer = null;
      enqueue(writeNow(takePending()));
    }, delayMs);
  };

  const writeNow = snapshot => async () => {
    const payload = extractVaultPayload(snapshot.wallets);
    const serialized = JSON.stringify(payload);
    if (serialized === lastWritten) {
      return;
    }
    if (!vault.isUnlocked()) {
      // Before login the wallets slice holds the persisted, secret-stripped
      // wallets, and startup housekeeping (privacy-mode addresses, hidden
      // wallet reassignment, client ids) touches them. That is expected and
      // carries nothing to vault. Only actual key material appearing while
      // locked is a defect worth a report.
      if (vaultPayloadHasSecrets(payload)) {
        onError(new Error('Vault write attempted while locked'), {
          tags: {area: 'vault', op: 'write_while_locked'},
          extra: {wallets: Object.keys(payload.wallets).length},
        });
      }
      return;
    }
    try {
      await vault.saveSecrets(payload);
      lastWritten = serialized;
      retryDelayMs = debounceMs;
    } catch (error) {
      onError(error, {
        tags: {area: 'vault', op: 'save_secrets'},
        extra: {retryInMs: retryDelayMs},
      });
      // Stay dirty, unless a newer snapshot (or a reset) was taken meanwhile:
      // that one supersedes this write and must not be overwritten by a
      // retry of it. Otherwise retry with backoff; flush() also picks it up.
      if (snapshot.rev === revision) {
        pending = snapshot;
        if (!timer) {
          armTimer(retryDelayMs);
        }
      }
      retryDelayMs = Math.min(retryDelayMs * 2, VAULT_SYNC_MAX_RETRY_MS);
    }
  };

  const schedule = allWallets => {
    pending = takeSnapshot(allWallets);
    armTimer(debounceMs);
  };

  listener.startListening({
    predicate: (action, currentState, previousState) =>
      typeof action?.type === 'string' &&
      action.type.startsWith('wallets/') &&
      action.type !== RESET_ACTION &&
      currentState?.wallets?.allWallets !== previousState?.wallets?.allWallets,
    effect: async (action, api) => {
      const allWallets = api.getState().wallets?.allWallets;
      if (IMMEDIATE_VAULT_WRITE_ACTIONS.includes(action.type)) {
        cancelTimer();
        pending = null;
        await enqueue(writeNow(takeSnapshot(allWallets)));
      } else {
        schedule(allWallets);
      }
    },
  });

  listener.startListening({
    type: RESET_ACTION,
    effect: async () => {
      cancelTimer();
      pending = null;
      lastWritten = null;
      // The empty payload goes through the same path as any other write so a
      // failure is reported, kept dirty and retried (timer / flush) instead of
      // leaving the old wallets' keys in the blob. Locked → nothing to do,
      // exactly as writeNow decides for a secret-free payload.
      await enqueue(writeNow(takeSnapshot([])));
    },
  });

  listener.startListening({
    type: LOGOUT_ACTION,
    effect: async () => {
      cancelTimer();
      pending = null;
      lastWritten = null;
      revision += 1; // an in-flight write that fails now has nothing to retry
      await enqueue(async () => {
        try {
          await vault.destroy();
        } catch (error) {
          onError(error, {tags: {area: 'vault', op: 'destroy'}});
        }
      });
    },
  });

  return {
    middleware: listener.middleware,
    /**
     * Write any pending (debounced or previously failed) change now and wait
     * for in-flight writes. Never rejects: a failure is reported through
     * onError and the snapshot stays dirty for the next flush / retry.
     */
    flush: async () => {
      if (pending) {
        cancelTimer();
        await enqueue(writeNow(takePending()));
      }
      await chain;
    },
    /** After unlock+hydrate: the vault already holds this payload. */
    markSynced: payload => {
      lastWritten = JSON.stringify(payload);
    },
    /** Force the next write regardless of the last one (tests, migration). */
    reset: () => {
      cancelTimer();
      pending = null;
      lastWritten = null;
      revision += 1;
    },
  };
};
