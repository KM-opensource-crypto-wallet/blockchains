/*
 * Review of a Stellar WalletConnect transaction (pure, never throws).
 * Refused: setOptions that adds or re-weights a signer, or changes the master
 * weight or a threshold (that is how an account is handed to another key).
 * An account merge (sends the whole balance away and closes the account) and
 * Soroban contract calls are danger; classic payment, DEX and trustline
 * operations are shown without a warning.
 */
import {Networks, TransactionBuilder} from '@stellar/stellar-sdk';

const LEVEL_RANK = {none: 0, warn: 1, danger: 2};
const KNOWN_OPERATIONS = [
  'createAccount',
  'payment',
  'pathPaymentStrictReceive',
  'pathPaymentStrictSend',
  'manageSellOffer',
  'manageBuyOffer',
  'createPassiveSellOffer',
  'setOptions',
  'changeTrust',
  'allowTrust',
  'accountMerge',
  'manageData',
  'bumpSequence',
  'createClaimableBalance',
  'claimClaimableBalance',
  'beginSponsoringFutureReserves',
  'endSponsoringFutureReserves',
  'revokeSponsorship',
  'setTrustLineFlags',
  'liquidityPoolDeposit',
  'liquidityPoolWithdraw',
  'extendFootprintTtl',
  'restoreFootprint',
];

const operationsOf = transaction =>
  (transaction?.innerTransaction ?? transaction)?.operations || [];

const changesSigners = op =>
  op?.type === 'setOptions' &&
  ((op.signer && Number(op.signer.weight) > 0) ||
    op.masterWeight !== undefined ||
    op.lowThreshold !== undefined ||
    op.medThreshold !== undefined ||
    op.highThreshold !== undefined);

// On a decoded Transaction / FeeBumpTransaction, as StellarChain signs it.
export const getStellarTakeoverReason = transaction =>
  operationsOf(transaction).some(changesSigners)
    ? 'This request changes who can sign for your Stellar account.'
    : null;

const assetName = asset =>
  !asset || asset.isNative?.() ? 'XLM' : asset.code ?? String(asset);

export const reviewStellarTransaction = xdr => {
  const result = {level: 'none', reasons: [], rows: [], blocked: false};
  const raise = (level, reason) => {
    if (LEVEL_RANK[level] > LEVEL_RANK[result.level]) {
      result.level = level;
    }
    if (reason && !result.reasons.includes(reason)) {
      result.reasons.push(reason);
    }
  };
  let transaction;
  try {
    // The passphrase only changes the hash, not how operations decode.
    transaction = TransactionBuilder.fromXDR(xdr, Networks.PUBLIC);
  } catch (e) {
    raise('danger', 'This Stellar transaction could not be read.');
    return result;
  }
  const operations = operationsOf(transaction);
  result.rows.push({
    label: 'Operations',
    value: operations.map(op => op.type).join(', '),
  });
  const takeover = getStellarTakeoverReason(transaction);
  if (takeover) {
    result.blocked = true;
    raise('danger', `${takeover} It cannot be signed.`);
  }
  operations.forEach(op => {
    switch (op.type) {
      case 'payment':
        result.rows.push({
          label: 'Sends',
          value: `${op.amount} ${assetName(op.asset)} to ${op.destination}`,
        });
        break;
      case 'pathPaymentStrictSend':
        result.rows.push({
          label: 'Sends',
          value: `${op.sendAmount} ${assetName(op.sendAsset)} to ${
            op.destination
          }`,
        });
        break;
      case 'pathPaymentStrictReceive':
        result.rows.push({
          label: 'Sends up to',
          value: `${op.sendMax} ${assetName(op.sendAsset)} to ${
            op.destination
          }`,
        });
        break;
      case 'createAccount':
        result.rows.push({
          label: 'Sends',
          value: `${op.startingBalance} XLM to ${op.destination}`,
        });
        break;
      case 'setOptions':
        // Removing a signer (weight 0) is not refused: the wallet's own key is
        // the master key, which the takeover check above covers.
        if (op.signer && Number(op.signer.weight) === 0) {
          result.rows.push({
            label: 'Removes signer',
            value: String(op.signer.ed25519PublicKey ?? 'a signer'),
          });
          raise('danger', 'This removes a signer from your Stellar account.');
        }
        break;
      case 'accountMerge':
        raise(
          'danger',
          `This closes your Stellar account and sends all of its XLM to ${op.destination}.`,
        );
        break;
      case 'invokeHostFunction':
        raise(
          'danger',
          'This calls a Soroban contract the wallet cannot check. Only continue if you trust this site.',
        );
        break;
      default:
        if (!KNOWN_OPERATIONS.includes(op.type)) {
          raise(
            'danger',
            `This Stellar operation (${op.type}) is not checked by the wallet.`,
          );
        }
    }
  });
  return result;
};
