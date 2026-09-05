import * as bitcoin from 'bitcoinjs-lib';
import ecc from '@bitcoinerlab/secp256k1';

// bitcoinjs-lib needs the secp256k1 backend registered before any taproot
// (p2tr) call; idempotent, so every entry point may call it. Lives in its own
// dependency-free module so transport-level code (electrum.js, which the web
// bridge also loads) can init without pulling in the HD/helper layer.
let eccInitDone = false;
export const ensureEccInit = () => {
  if (!eccInitDone) {
    bitcoin.initEccLib(ecc);
    eccInitDone = true;
  }
};
