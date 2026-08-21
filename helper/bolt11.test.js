import {getBolt11InvoiceAmount} from './bolt11';

// Real mainnet invoice for 69660n BTC (6966 sats)
const INVOICE_6966_SATS =
  'lnbc69660n1p4g0ld7pp5zvnger975gyt355jdfq2pnwanchpn00rc5z2648ml8w5j4hywy9qdpdf46kcmrkv9jzq4jsfcs9va6gdp2923t6x4exv36yxff47cqzzsxqrrsssp5kskwlutuftvmed8nr3jfwne7dmuk5kvj6l0gcrakt83ykqdndcuq9qxpqysgq0c950mjmj3tp3xdh00p0g4ezepzewrfxgr620aucwc3xnpufpgqqalkzqw65d3xneyv9zn9x9k045r7cdqtnsmhtdj5ktmc243ndydqqswrpuj';

describe('getBolt11InvoiceAmount', () => {
  it('decodes the amount from a mainnet invoice with n multiplier', () => {
    expect(getBolt11InvoiceAmount(INVOICE_6966_SATS)).toBe('0.00006966');
  });

  it('accepts a lightning: scheme prefix', () => {
    expect(getBolt11InvoiceAmount(`lightning:${INVOICE_6966_SATS}`)).toBe(
      '0.00006966',
    );
  });

  it('accepts uppercase invoices as produced by QR codes', () => {
    expect(getBolt11InvoiceAmount(INVOICE_6966_SATS.toUpperCase())).toBe(
      '0.00006966',
    );
  });

  it('decodes the m multiplier (milli-bitcoin)', () => {
    expect(getBolt11InvoiceAmount('lnbc20m1pvjluez')).toBe('0.02');
  });

  it('decodes the u multiplier (micro-bitcoin)', () => {
    expect(getBolt11InvoiceAmount('lnbc2500u1pvjluez')).toBe('0.0025');
  });

  it('decodes the p multiplier (pico-bitcoin) rounded to 8 decimals', () => {
    expect(getBolt11InvoiceAmount('lnbc10p1pvjluez')).toBe('0.00000001');
  });

  it('decodes a whole-bitcoin amount with no multiplier', () => {
    expect(getBolt11InvoiceAmount('lnbc21pvjluez')).toBe('2');
  });

  it('decodes testnet invoices', () => {
    expect(getBolt11InvoiceAmount('lntb2500u1pvjluez')).toBe('0.0025');
  });

  it('returns null for an amountless invoice', () => {
    expect(getBolt11InvoiceAmount('lnbc1p4g0ld7pp5zvnger975gyt355')).toBe(null);
  });

  it('returns null for an on-chain bitcoin address', () => {
    expect(
      getBolt11InvoiceAmount('bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4'),
    ).toBe(null);
  });

  it('returns null for random text', () => {
    expect(getBolt11InvoiceAmount('hello world')).toBe(null);
  });

  it('returns null for empty or missing input', () => {
    expect(getBolt11InvoiceAmount('')).toBe(null);
    expect(getBolt11InvoiceAmount(undefined)).toBe(null);
    expect(getBolt11InvoiceAmount(null)).toBe(null);
  });
});
