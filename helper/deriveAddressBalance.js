import BigNumber from 'bignumber.js';

// Bitcoin-family chains (the only ones with per-address balances) use 8.
const DEFAULT_DECIMALS = 8;

/**
 * Per-address balances (`deriveAddresses[].balance`, from Electrum or the
 * `get_bitcoin_balances` API) are stored in base units (satoshis), like the
 * coin's `totalBalance`. Formats one for display in whole coins.
 */
export const formatDeriveAddressBalance = ({balance, decimal, symbol} = {}) => {
  const decimals =
    Number.isFinite(Number(decimal)) && decimal !== undefined
      ? Number(decimal)
      : DEFAULT_DECIMALS;
  const amount = new BigNumber(balance ?? 0);
  const whole = amount.isNaN() ? '0' : amount.shiftedBy(-decimals).toFixed();
  return symbol ? `${whole} ${symbol}` : whole;
};
