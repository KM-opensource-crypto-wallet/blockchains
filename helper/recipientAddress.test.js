// Mock the chain layer and the blockchain helper so the test stays isolated
// from native modules (the real modules pull in react-native, ethers, etc.).
const mockGetChain = jest.fn();
jest.mock('dok-wallet-blockchain-networks/cryptoChain', () => ({
  getChain: (...args) => mockGetChain(...args),
}));
jest.mock('dok-wallet-blockchain-networks/helper', () => ({
  isNameSupportChain: chain_name =>
    ['ethereum', 'binance_smart_chain'].includes(chain_name),
}));

import {resolveRecipientAddress} from 'dok-wallet-blockchain-networks/helper/recipientAddress';

const makeChain = ({valid = false, resolved = null} = {}) => ({
  isValidAddress: jest.fn(async () => valid),
  isValidName: jest.fn(async () => resolved),
});

beforeEach(() => {
  mockGetChain.mockReset();
});

describe('resolveRecipientAddress', () => {
  it('returns the trimmed address when the chain accepts it', async () => {
    const chain = makeChain({valid: true});
    mockGetChain.mockReturnValue(chain);
    const result = await resolveRecipientAddress({
      chain_name: 'bitcoin',
      phrase: 'p',
      customRPC: undefined,
      address: '  bc1qabc  ',
    });
    expect(mockGetChain).toHaveBeenCalledWith('bitcoin', 'p', undefined);
    expect(chain.isValidAddress).toHaveBeenCalledWith({address: 'bc1qabc'});
    expect(chain.isValidName).not.toHaveBeenCalled();
    expect(result).toEqual({
      isValid: true,
      validAddress: null,
      resolvedAddress: 'bc1qabc',
    });
  });

  it('resolves a name on name-support chains when the address is invalid', async () => {
    const chain = makeChain({valid: false, resolved: '0xResolved'});
    mockGetChain.mockReturnValue(chain);
    const result = await resolveRecipientAddress({
      chain_name: 'ethereum',
      address: 'vitalik.eth',
    });
    expect(chain.isValidName).toHaveBeenCalledWith({name: 'vitalik.eth'});
    expect(result).toEqual({
      isValid: false,
      validAddress: '0xResolved',
      resolvedAddress: '0xResolved',
    });
  });

  it('does not try name resolution on chains without name support', async () => {
    const chain = makeChain({valid: false, resolved: '0xShouldNotBeUsed'});
    mockGetChain.mockReturnValue(chain);
    const result = await resolveRecipientAddress({
      chain_name: 'bitcoin',
      address: 'not-an-address',
    });
    expect(chain.isValidName).not.toHaveBeenCalled();
    expect(result).toEqual({
      isValid: false,
      validAddress: null,
      resolvedAddress: null,
    });
  });

  it('returns null resolvedAddress when the name does not resolve', async () => {
    mockGetChain.mockReturnValue(makeChain({valid: false, resolved: null}));
    const result = await resolveRecipientAddress({
      chain_name: 'ethereum',
      address: 'nobody.eth',
    });
    expect(result.resolvedAddress).toBeNull();
    expect(result.validAddress).toBeNull();
  });

  it('short-circuits on empty input without touching the chain', async () => {
    const result = await resolveRecipientAddress({
      chain_name: 'ethereum',
      address: '   ',
    });
    expect(mockGetChain).not.toHaveBeenCalled();
    expect(result).toEqual({
      isValid: false,
      validAddress: null,
      resolvedAddress: null,
    });
  });
});
