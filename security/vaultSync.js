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
  let pendingWallets = null;
  let chain = Promise.resolve();

  const enqueue = task => {
    chain = chain.then(task, task);
    return chain;
  };

  const writeNow = allWallets => async () => {
    const payload = extractVaultPayload(allWallets);
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
    } catch (error) {
      onError(error, {tags: {area: 'vault', op: 'save_secrets'}});
    }
  };

  const cancelTimer = () => {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
  };

  const schedule = allWallets => {
    pendingWallets = allWallets;
    cancelTimer();
    timer = setTimeout(() => {
      timer = null;
      const wallets = pendingWallets;
      pendingWallets = null;
      enqueue(writeNow(wallets));
    }, debounceMs);
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
        pendingWallets = null;
        await enqueue(writeNow(allWallets));
      } else {
        schedule(allWallets);
      }
    },
  });

  listener.startListening({
    type: RESET_ACTION,
    effect: async () => {
      cancelTimer();
      pendingWallets = null;
      lastWritten = null;
      if (!vault.isUnlocked()) {
        return;
      }
      await enqueue(async () => {
        try {
          await vault.saveSecrets({...vault.EMPTY_VAULT_PAYLOAD, wallets: {}});
        } catch (error) {
          onError(error, {tags: {area: 'vault', op: 'reset'}});
        }
      });
    },
  });

  listener.startListening({
    type: LOGOUT_ACTION,
    effect: async () => {
      cancelTimer();
      pendingWallets = null;
      lastWritten = null;
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
    /** Write any pending change now and wait for in-flight writes. */
    flush: async () => {
      if (timer) {
        cancelTimer();
        const wallets = pendingWallets;
        pendingWallets = null;
        await enqueue(writeNow(wallets));
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
      pendingWallets = null;
      lastWritten = null;
    },
  };
};
