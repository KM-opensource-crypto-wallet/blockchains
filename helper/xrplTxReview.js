/*
 * Review of an XRPL WalletConnect transaction (pure, never throws). Refused:
 * SetRegularKey that sets a key and SignerListSet that adds signers, both of
 * which let another key sign for the account. AccountDelete (sends the whole
 * balance away), NFT offers (the price is not checked) and any type outside
 * KNOWN_TYPES are danger. Payments, DEX offers and trust lines are summarised.
 */

const LEVEL_RANK = {none: 0, warn: 1, danger: 2};

// Types reviewed without a warning (beyond the rows and checks below).
const KNOWN_TYPES = [
  'Payment',
  'TrustSet',
  'OfferCreate',
  'OfferCancel',
  'AccountSet',
  'SetRegularKey',
  'SignerListSet',
  'AccountDelete',
  'CheckCash',
  'CheckCancel',
  'EscrowFinish',
  'EscrowCancel',
  'NFTokenMint',
  'NFTokenBurn',
  'NFTokenCancelOffer',
  'AMMDeposit',
  'AMMWithdraw',
  'TicketCreate',
  'DepositPreauth',
];
const NFT_OFFER_TYPES = ['NFTokenCreateOffer', 'NFTokenAcceptOffer'];
const TF_SELL_NFTOKEN = 1;

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
      // DeliverMax is the newer name for Amount.
      const amount = tx.Amount ?? tx.DeliverMax;
      if (amount === undefined) {
        raise(
          'danger',
          'This XRP Ledger payment has no amount the wallet can read.',
        );
      } else {
        result.rows.push({
          label: 'Sends',
          value: `${describeAmount(amount)} to ${tx.Destination}`,
        });
      }
      // SendMax caps what leaves the account (cross-currency payments).
      if (tx.SendMax !== undefined) {
        result.rows.push({
          label: 'Spends up to',
          value: describeAmount(tx.SendMax),
        });
      }
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
    } else if (type === 'OfferCreate') {
      if (tx.TakerGets !== undefined) {
        result.rows.push({
          label: 'You give',
          value: describeAmount(tx.TakerGets),
        });
      }
      if (tx.TakerPays !== undefined) {
        result.rows.push({
          label: 'You get',
          value: describeAmount(tx.TakerPays),
        });
      }
    } else if (type === 'TrustSet') {
      if (tx.LimitAmount) {
        result.rows.push({
          label: 'Trust line',
          value: `${describeAmount(tx.LimitAmount)}, issuer ${
            tx.LimitAmount.issuer
          }`,
        });
      }
    } else if (NFT_OFFER_TYPES.includes(type)) {
      if (tx.NFTokenID) {
        result.rows.push({label: 'NFT', value: String(tx.NFTokenID)});
      }
      if (tx.Amount !== undefined) {
        result.rows.push({
          // eslint-disable-next-line no-bitwise
          label: Number(tx.Flags) & TF_SELL_NFTOKEN ? 'Sell for' : 'Buy for',
          value: describeAmount(tx.Amount),
        });
      }
      if (tx.Destination) {
        result.rows.push({label: 'Only to', value: String(tx.Destination)});
      }
      raise(
        'danger',
        'The wallet cannot check the price of this NFT offer. Only continue if you trust this site.',
      );
    } else if (!KNOWN_TYPES.includes(type)) {
      raise(
        'danger',
        `This XRP Ledger transaction type (${type}) is not checked by the wallet.`,
      );
    }
  } catch (e) {
    raise('danger', 'This XRP Ledger transaction could not be read.');
  }
  return result;
};
