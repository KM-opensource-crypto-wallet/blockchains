import {VersionedTransaction} from '@solana/web3.js';
import {Buffer} from 'buffer';

// Fee payer of a base64-serialized Solana transaction (legacy or v0): it is
// always the first static account key. Display-only, so never throws.
export const getSolanaFeePayer = base64Tx => {
  if (typeof base64Tx !== 'string' || !base64Tx) {
    return null;
  }
  try {
    const tx = VersionedTransaction.deserialize(
      Buffer.from(base64Tx, 'base64'),
    );
    return tx.message.staticAccountKeys?.[0]?.toBase58() ?? null;
  } catch (e) {
    return null;
  }
};
