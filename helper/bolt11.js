import BigNumber from 'bignumber.js';

// BOLT11 amount multipliers, as powers of ten relative to 1 BTC
const MULTIPLIER_EXPONENT = {
  m: -3,
  u: -6,
  n: -9,
  p: -12,
};

/**
 * Extract the amount encoded in a BOLT11 lightning invoice without a full
 * bech32 decode: the amount lives in the human-readable prefix
 * (ln + network + digits + optional multiplier) before the "1" separator.
 * Amountless invoices can't false-match because bech32 data excludes "1".
 *
 * @param {string} input - invoice, optionally with a "lightning:" scheme
 * @returns {string|null} amount in BTC as a decimal string, or null when the
 *   input is not an invoice or carries no amount
 */
export const getBolt11InvoiceAmount = input => {
  if (typeof input !== 'string') {
    return null;
  }
  const invoice = input
    .trim()
    .toLowerCase()
    .replace(/^lightning:/, '');
  const match = invoice.match(/^ln(bc|tb|tbs|bcrt)(\d+)([munp])?1/);
  if (!match) {
    return null;
  }
  const exponent = match[3] ? MULTIPLIER_EXPONENT[match[3]] : 0;
  const amount = new BigNumber(match[2]).multipliedBy(
    new BigNumber(10).exponentiatedBy(exponent),
  );
  if (!amount.isFinite() || amount.lte(0)) {
    return null;
  }
  // Round up to satoshi precision so a sub-satoshi invoice is never underpaid
  return amount.decimalPlaces(8, BigNumber.ROUND_UP).toFixed();
};
