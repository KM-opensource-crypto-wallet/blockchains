/**
 * Routing of the WalletConnect review screen's risk review.
 *
 * Runner: node-env jest config (pulls in the Solana and Hedera reviewers).
 */
import {reviewWalletConnectRequest} from 'dok-wallet-blockchain-networks/helper/walletConnectRequestReview';

describe('reviewWalletConnectRequest', () => {
  it('returns null for methods without a review (personal_sign, messages)', () => {
    expect(
      reviewWalletConnectRequest({method: 'personal_sign', signTypeData: '0x'}),
    ).toBeNull();
    expect(
      reviewWalletConnectRequest({
        method: 'solana_signMessage',
        signTypeData: 'x',
      }),
    ).toBeNull();
    expect(reviewWalletConnectRequest(undefined)).toBeNull();
  });

  it('routes typed data and fills in blocked=false', () => {
    const review = reviewWalletConnectRequest({
      method: 'eth_signTypedData_v4',
      chainId: 'eip155:1',
      signTypeData: JSON.stringify({
        primaryType: 'Login',
        domain: {chainId: 10},
        message: {},
      }),
    });
    expect(review).toMatchObject({level: 'danger', blocked: false});
  });

  it('routes Tron and keeps blocked from the reviewer', () => {
    const review = reviewWalletConnectRequest({
      method: 'tron_signTransaction',
      signTypeData: {
        raw_data: {contract: [{type: 'AccountPermissionUpdateContract'}]},
      },
    });
    expect(review).toMatchObject({level: 'danger', blocked: true});
  });

  it('passes the method to the Solana review (single transaction, not the array)', () => {
    const review = reviewWalletConnectRequest({
      method: 'solana_signAndSendTransaction',
      signTypeData: {transaction: 'not-a-transaction', transactions: []},
      walletAddress: '11111111111111111111111111111111',
    });
    expect(review).toMatchObject({level: 'danger'});
  });

  it('routes XRPL', () => {
    const review = reviewWalletConnectRequest({
      method: 'xrpl_submitTransaction',
      signTypeData: {
        transaction: {TransactionType: 'SetRegularKey', RegularKey: 'rX'},
      },
    });
    expect(review.blocked).toBe(true);
  });

  it('turns a reviewer that throws into danger', () => {
    const review = reviewWalletConnectRequest({
      method: 'signPsbt',
      signTypeData: {
        get psbt() {
          throw new Error('boom');
        },
      },
    });
    expect(review).toMatchObject({level: 'danger', blocked: false});
  });
});
