# dok-wallet-blockchain-networks

All Dok wallet blockchain network on 1 repository.

Consumed as a git submodule by both apps:

- `mobile_app` — React Native
- `web_wallet` — Next.js (package `dokwallet-desktop`)

## Platform seams

This repository is **common code**. When something genuinely differs per
platform, it does not belong here — it belongs behind a *seam*: this repo
imports a bare app-level specifier, and **each app ships its own file at that
path** exporting the same names with the same signatures.

```js
// here, in the shared code — no platform knowledge
import {runElectrumQuery} from 'utils/electrumTransport';

// web_wallet/src/utils/electrumTransport.js   -> POSTs to /api/bitcoin
// mobile_app/src/utils/electrumTransport.js   -> react-native-tcp-socket
```

Resolution needs no work on mobile (babel `module-resolver` with
`root: ['./src']`); on web a new top-level namespace must be added to both
`jsconfig.json` `paths` and `jest.config.js` `moduleNameMapper`, so prefer the
namespaces already in use.

Current seams: `utils/toast`, `utils/common`, `utils/wlData`,
`utils/navigation`, `utils/hideWallet`, `utils/localStorageData`, `utils/xmtp`,
`utils/electrumTransport`, `myWallet/wallet.service`,
`myWallet/wallet-lightning.service`, `redux/store`, `data/currency`.

`utils/electrumServer` is *not* a seam, despite the mention in
`config/electrumServers.js`: nothing here imports it, and it exists only in
`web_wallet`, as internal plumbing behind that app's `utils/electrumTransport`.
Mobile ships no counterpart and needs none.

Conventions: `src/utils/<lowerCamelCase>.js` for helpers,
`src/myWallet/<name>.service.js` for key/wallet bridges; named exports only, no
default export; colocated `<name>.test.js`. Keep the two implementations'
signatures identical — where they have drifted (`addCustomDeriveAddressToWallet`
returns `{account}` on web and a bare object on mobile) it is a bug, not a
pattern.

Prefer a runtime flag over a seam only when the difference is a value, not an
implementation — see `isWeb` in `config/config.js`, still used by `dokApi.js`,
`coinMarketCap.js`, `SolanaChain.js` and `TronChain.js`.

## Tests

Colocated `*.test.js`, run by the host apps (this repo has no `package.json`).
Everything under `service/` and `helper/` also runs from the web app's jest;
`cryptoChain/` and `redux/` suites need React Native mocks and run only on
mobile.
