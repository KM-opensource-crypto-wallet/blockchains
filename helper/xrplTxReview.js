/*
 * Review of an XRPL WalletConnect transaction (pure, never throws). Refused:
 * SetRegularKey that sets a key and SignerListSet that adds signers, both of
 * which let another key sign for the account. AccountDelete (sends the whole
 * balance away) is danger. Payments are summarised.
 */

const LEVEL_RANK = {none: 0, warn: 1, danger: 2};

// The tx JSON a WalletConnect request carries; RippleChain signs this object.
export const extractXrplTxJson = data => {
  if (!data) {
    return {};
  }
  if (Array.isArray(data)) {
    return extractXrplTxJson(data[0]);
  }
  if (data.tx_json) {
    return data.tx_json;
  }
  if (data.transaction) {
    return data.transaction;
  }
  return data;
};

export const getXrplTakeoverReason = tx => {
  const type = tx?.TransactionType;
  const addsRegularKey = type === 'SetRegularKey' && !!tx.RegularKey;
  const addsSigners =
    type === 'SignerListSet' &&
    Array.isArray(tx.SignerEntries) &&
    tx.SignerEntries.length > 0;
  return addsRegularKey || addsSigners
    ? `This request (${type}) lets another key sign for your XRP account.`
    : null;
};

const describeAmount = amount => {
  if (typeof amount === 'string') {
    const drops = BigInt(amount);
    const fraction = (drops % 1000000n)
      .toString()
      .padStart(6, '0')
      .replace(/0+$/, '');
    return `${drops / 1000000n}${fraction ? `.${fraction}` : ''} XRP`;
  }
  return `${amount?.value} ${amount?.currency}`;
};

export const reviewXrplRequest = signTypeData => {
  const result = {level: 'none', reasons: [], rows: [], blocked: false};
  const raise = (level, reason) => {
    if (LEVEL_RANK[level] > LEVEL_RANK[result.level]) {
      result.level = level;
    }
    if (reason && !result.reasons.includes(reason)) {
      result.reasons.push(reason);
    }
  };
  try {
    const tx = extractXrplTxJson(signTypeData?.transaction);
    const type = tx?.TransactionType;
    if (!type) {
      raise('danger', 'This XRP Ledger transaction could not be read.');
      return result;
    }
    result.rows.push({label: 'Type', value: String(type)});
    const takeover = getXrplTakeoverReason(tx);
    if (takeover) {
      result.blocked = true;
      raise('danger', `${takeover} It cannot be signed.`);
    } else if (type === 'Payment') {
      result.rows.push({
        label: 'Sends',
        value: `${describeAmount(tx.Amount)} to ${tx.Destination}`,
      });
      if (tx.DestinationTag !== undefined) {
        result.rows.push({
          label: 'Destination tag',
          value: String(tx.DestinationTag),
        });
      }
    } else if (type === 'AccountDelete') {
      raise(
        'danger',
        `This deletes your XRP account and sends the remaining XRP to ${tx.Destination}.`,
      );
    }
  } catch (e) {
    raise('danger', 'This XRP Ledger transaction could not be read.');
  }
  return result;
};
