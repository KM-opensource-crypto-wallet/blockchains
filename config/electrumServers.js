/**
 * Electrum server endpoints, as pure data.
 *
 * Hostnames and ports are the part that rots, so they live here once. Which
 * subset each app uses and in what order is deployment policy, not shared
 * knowledge: a phone and our own Next.js server reach different hosts on
 * different ports with different reliability. Each app therefore composes its
 * own ordered array in `utils/electrumTransport` (and, on web,
 * `utils/electrumServer`).
 *
 * This table states no platform opinion — nothing in it says "browser" or
 * "native" — which is why it can stay in the shared submodule.
 */

export const ELECTRUM_SERVER = {
  // Our own Fulcrum server. Every app should list this first.
  // The DNS record must stay "DNS only" in Cloudflare: proxying it breaks port
  // 50002, which the proxy does not forward.
  own: {host: 'electrum.kimlwallet.com', port: 50002},

  foundation: {host: 'mainnet.foundationdevices.com', port: 50002},
  bluewallet: {host: 'electrum1.bluewallet.io', port: 443},
  // electrs-esplora hard-codes MAX_ARRAY_BATCH = 20 and, as deployed, closes
  // the connection (no reply at all) on any JSON-RPC batch larger than that.
  blockstream: {host: 'electrum.blockstream.info', port: 50002, maxBatch: 20},

  testnetBlockstream: {
    host: 'electrum.blockstream.info',
    port: 60002,
    maxBatch: 20,
  },
  testnetAranguren: {host: 'testnet.aranguren.org', port: 51002},
};
