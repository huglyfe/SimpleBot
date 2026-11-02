# Contributing

SimpleBot is public alpha software maintained by [huglyfe](https://github.com/huglyfe). Small, focused fixes are welcome. Open an issue before proposing a new subsystem or changing the conversation model.

Read [AGENTS.md](AGENTS.md), the [architecture](docs/ARCHITECTURE.md), and the guide in the directory you are changing. Use a disposable development root:

```sh
pnpm install --frozen-lockfile
CI=true ./dev.sh
```

Keep the authoritative state and acceptance boundaries intact. Include focused behavior tests and update the owning contract when behavior changes. Stop your development server, then run `pnpm check` and `pnpm test:acceptance`. Report any unavailable checks in the pull request. Screenshots and fixtures must be synthetic.

For a short edit/test loop, build the shared contracts once with `pnpm --filter @simplebot/shared build` (and again after changing them), then run the owning test directly:

```sh
node --import tsx --test server/src/continuity-contract.test.ts
pnpm --filter @simplebot/web exec vitest run src/components/sheets/ConversationSheet.test.tsx
```

`pnpm check` runs the same standalone gates as CI. Workspace builds follow dependency order; package tests and type checks run concurrently with output grouped by package. Browser acceptance remains separate because it requires installed Chromium and WebKit. Use `pnpm test:acceptance acceptance/chat.spec.ts` for one journey file. Failed browser tests retain traces and screenshots in `/tmp/simplebot-playwright-results`; passing tests leave no screenshots. These are diagnostic artifacts, not visual snapshot assertions.

When refreshing dependencies, keep TypeScript on 6.x until `typescript-eslint` supports TypeScript 7; its type-checked lint rules need the compiler API that TypeScript 7 no longer ships. Keep pnpm on 11.27.x: from 11.28.0, `pnpm licenses list --prod` returns no packages, which empties the generated notices. Format the regenerated `pnpm-lock.yaml` with Prettier, and re-key any versioned entries in `legal/upstream/sources.json` that `pnpm legal:notices` reports.

If license verification reports `ERR_PNPM_MISSING_PACKAGE_INDEX_FILE`, restore the local package-store metadata with `pnpm install --force --frozen-lockfile`, then rerun `pnpm legal:check`. A normal install can report “already up to date” without repairing that index. Do not regenerate notices from an incomplete install.

Never include credentials, personal cards, conversations, generated databases, or operator files. Report security issues through [SECURITY.md](SECURITY.md).

Contributions are submitted under Apache-2.0. Only contribute material you have the right to license on those terms, and preserve required third-party attribution. AI-assisted contributions follow the same review and verification requirements.
