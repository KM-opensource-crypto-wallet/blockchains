# Listing DOK Wallet and KIML Wallet on WalletBeat

[WalletBeat](https://walletbeat.eth.limo) rates Ethereum wallets on security,
privacy, self-sovereignty, transparency and ecosystem. A wallet is added by a
pull request to [`walletbeat/walletbeat`](https://github.com/walletbeat/walletbeat).
This guide covers how to submit our entry and how to keep it up to date.

Both apps ship from one codebase, so the KIML entry reuses DOK's data and
overrides only what differs. Only the mobile apps (iOS and Android) are listed.

## Where our data lives

All files are in the WalletBeat repository, not in this one:

| File | What it holds |
|---|---|
| `data/software-wallets/dok-wallet.ts` | All of DOK Wallet's feature data and its references |
| `data/software-wallets/kiml-wallet.ts` | KIML Wallet; spreads DOK's features and overrides the differences |
| `data/software-wallets.ts` | Registers both wallets |
| `data/entities/moreover4u2.ts`, `data/entities/kiml-view.ts` | The two companies |
| `data/entities/onesignal.ts` | OneSignal, which the apps contact at launch for push notifications |
| `data/entities.ts` | Registers the three entities |
| `data/contributors/matan-kelly.ts` | The contributor, with the disclosed affiliation to both companies |
| `public/images/wallets/`, `public/images/entities/` | Wallet and company icons |
| `public/references/wallets/dok-wallet/`, `public/references/wallets/kiml-wallet/` | Screenshots cited as references |

## 1. Merge our own changes first

Every reference in the entry must point to public code at a fixed commit.
WalletBeat's checks reject a GitHub `blob` link on a branch name, and reviewers
open every link.

1. Merge to `main` every change the entry cites in `mobile_app`, `web_wallet`
   and this repository, including the submodule pointer bumps.
2. In the WalletBeat clone, list the links that are not pinned yet:

   ```bash
   grep -n "tree/main\|blob/main" data/software-wallets/dok-wallet.ts data/software-wallets/kiml-wallet.ts
   ```

3. Replace each one with a link to the merged commit:
   `https://github.com/<owner>/<repo>/blob/<40-char-commit-hash>/<path>#L<start>-L<end>`.
   A file cited as a whole (for example `LICENSE`) needs no line range.

## 2. Set up commit signing (once)

WalletBeat's CI fails a pull request whose last commit is not signed.

```bash
cd walletbeat
git config commit.gpgsign true
git config gpg.format ssh
git config user.signingkey ~/.ssh/id_ed25519.pub
```

Add the same public key on GitHub under **Settings → SSH and GPG keys → New SSH
key**, with key type **Signing Key**.

## 3. Fork WalletBeat

Press **Fork** on <https://github.com/walletbeat/walletbeat>.

## 4. Commit and update the branch

```bash
cd walletbeat
git checkout add-dok-and-kiml-wallets
git add data public tests src .cspell.json
git status                     # check that only our files are staged; .claude/ must not appear
git commit -m "Add DOK Wallet and KIML Wallet"
git log --show-signature -1    # the commit must show a valid signature

git fetch origin
git rebase origin/main
pnpm install
pnpm fix
pnpm check:all                 # must pass before you push
```

If `pnpm fix` or `pnpm check:all` changes files, add them to the same commit:
`git add -u && git commit --amend --no-edit`.

## 5. Push and open the pull request

```bash
git push --set-upstream git@github.com:<your-github-username>/walletbeat.git add-dok-and-kiml-wallets
```

Open the link that `git push` prints. The target is `walletbeat/walletbeat`,
branch `main`.

Title: `Add DOK Wallet and KIML Wallet`

Description (WalletBeat asks for plain English, and screenshots over prose):

> Adds DOK Wallet (Moreover4u2 Ltd) and KIML Wallet (KIML View Ltd). Both are
> one open-source codebase (GPL-3.0); KIML reuses DOK's feature data and
> overrides only what differs.
>
> - Only the mobile apps (iOS and Android) are listed.
> - Contributor: Matan Kelly, founder with equity in both companies, disclosed
>   in the affiliation field.
> - Every value cites our public code at a fixed commit, the store pages or our
>   websites.
> - OneSignal is used only for push notifications. WalletBeat has no
>   push-notification purpose, so the row uses `ANALYTICS`, the nearest one.
> - Two small changes outside `/data`: the duress-resistance details sentence is
>   split in two to pass the grammar check, and
>   `tests/feature-attribute-references.test.ts` lists one intentional
>   difference, because the Sentry row collects no account address.
> - `pnpm check:all` passes locally.

Attach screenshots of both wallet pages from `pnpm dev` (light and dark).

The contributor in the entry should open the pull request. If someone else
opens it, say in the description that it is submitted for Moreover4u2 Ltd and
KIML View Ltd.

## 6. Answer the review

For each round of review comments: edit, run `pnpm check:all`, make a signed
commit, then `git push`. The pull request updates itself.

## Claims a reviewer can test

WalletBeat marks some ratings as verifiable, and reviewers may test them:

- **L1 provider independence.** With only an Ethereum RPC reachable and every
  other connection blocked, creating and importing a wallet must work, and so
  must the ETH balance, an ERC-20 balance and an ERC-20 send. The built-in coin
  list (`redux/currency/defaultCoins.js`) is what lets creation and import work
  without the backend.
- **Data collection.** Reviewers can watch the app's network traffic. Every
  company the app contacts must appear in the data-collection rows.

Run these tests yourself before you submit.

## Keeping the entry up to date

When a change in the apps affects a rated feature (permissions, RPC handling,
data sent to third parties, transaction review, licensing), update the entry in
the same release:

1. Update the value and its reference in `dok-wallet.ts` (or `kiml-wallet.ts`
   when only KIML differs). WalletBeat's `/wallet-update` Claude Code skill in
   `.agents/skills/wallet-update` walks through this.
2. Use `null` for anything not yet verified. Never guess a value.
3. Run `pnpm dev` and check the wallet pages, then `pnpm check:all`.
4. Send the change as a new signed pull request, as in steps 4 to 6.
