import {
  getWalletConnectVerifyStatus,
  isRiskyVerifyStatus,
  verifyHost,
} from 'dok-wallet-blockchain-networks/helper/walletConnectVerify';

const ctx = verified => ({
  verified: {verifyUrl: 'https://verify.walletconnect.org', ...verified},
});

describe('getWalletConnectVerifyStatus', () => {
  it('maps the Verify API states', () => {
    expect(
      getWalletConnectVerifyStatus(
        ctx({origin: 'https://a.io', validation: 'VALID'}),
      ),
    ).toEqual({status: 'verified', origin: 'https://a.io'});
    expect(
      getWalletConnectVerifyStatus(
        ctx({origin: 'https://b.io', validation: 'INVALID'}),
      ),
    ).toEqual({status: 'mismatch', origin: 'https://b.io'});
    expect(
      getWalletConnectVerifyStatus(
        ctx({origin: 'https://c.io', validation: 'UNKNOWN'}),
      ),
    ).toEqual({status: 'unknown', origin: 'https://c.io'});
  });

  it('puts a scam flag above any validation result', () => {
    expect(
      getWalletConnectVerifyStatus(
        ctx({origin: 'https://d.io', validation: 'VALID', isScam: true}),
      ).status,
    ).toBe('scam');
  });

  it('treats a missing or malformed context as unknown', () => {
    expect(getWalletConnectVerifyStatus(undefined)).toEqual({
      status: 'unknown',
      origin: '',
    });
    expect(getWalletConnectVerifyStatus({verified: {origin: 42}})).toEqual({
      status: 'unknown',
      origin: '',
    });
  });
});

describe('isRiskyVerifyStatus', () => {
  it('flags only scam and mismatch', () => {
    expect(
      ['scam', 'mismatch', 'verified', 'unknown'].map(isRiskyVerifyStatus),
    ).toEqual([true, true, false, false]);
  });
});

describe('verifyHost', () => {
  it('returns the host of a URL and the input otherwise', () => {
    expect(verifyHost('https://app.example.com/swap?x=1')).toBe(
      'app.example.com',
    );
    expect(verifyHost('not a url')).toBe('not a url');
    expect(verifyHost(undefined)).toBe('');
  });
});
