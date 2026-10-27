# Release artifacts

The source alpha, npm package, and Homebrew formula use the same CLI. These commands prepare artifacts locally; none creates a repository or publishes.

## npm tarball

```sh
pnpm install --frozen-lockfile
pnpm legal:notices
pnpm check
pnpm package
cd dist-package
npm pack
```

Install the resulting `huglyfe-simplebot-<version>.tgz` into a disposable prefix:

```sh
npm install --prefix /tmp/simplebot-package-test /absolute/path/to/package.tgz
SIMPLEBOT_ROOT=/tmp/simplebot-package-root /tmp/simplebot-package-test/node_modules/.bin/simplebot init
SIMPLEBOT_ROOT=/tmp/simplebot-package-root /tmp/simplebot-package-test/node_modules/.bin/simplebot doctor
```

Use fresh, task-specific temporary paths. The tarball includes the built WebUI, server, bundled shared contracts, defaults, Apache license, third-party notices, and source-repository metadata. Native SQLite may need Python and a compiler when its prebuilt binary is unavailable. Runtime dependencies resolve at install time under npm; the source checkout's frozen pnpm lockfile is the reproducible source build. Verify source installation from a fresh clone separately.

Publish the **tested tarball**, not an independently rebuilt directory, only after reviewing its contents and confirming ownership of `@huglyfe/simplebot`:

```sh
npm publish /absolute/path/to/package.tgz --access public --tag alpha
```

The alpha tag prevents this prerelease from becoming the default `latest` install. After publication, the invocation is `npx @huglyfe/simplebot@alpha`.

## Homebrew

```sh
pnpm package:brew /absolute/path/to/package.tgz
```

This fills the formula's version, npm URL, and SHA-256 from the exact tarball. The remote URL will not work until that tarball is published. Homebrew uses Node 24 and OpenSSL, and runs the same `simplebot start` for its service. Before announcing Homebrew support, run formula style/audit, install/test, and service start/stop against disposable data on the intended host. Publish through an owned tap (such as `huglyfe/homebrew-simplebot`), not a claim of Homebrew core inclusion. Homebrew readiness does not gate the source alpha.

## Public source export

`packaging/public-files.txt` is the explicit file allowlist. Review it whenever a source file is added or removed. `pnpm export:check`, included in `pnpm check` and CI, refuses missing maintained source files and invalid manifest entries without changing the export. It never adds files automatically. The allowlist excludes historical character assets, dated private audits, local agent state, runtime data, and old Git history. Explicit `private:start` / `private:end` comment blocks are removed from release Markdown, JavaScript configuration, and `.gitignore`; checksums describe the exported bytes. Internal reference snapshots and their reading guide do not ship. Required licensing and attribution remain included.

```sh
pnpm export:public
```

Inspect `dist-public/` and its `SHA256SUMS` before creating the new Git repository. Run checks against the export as well as the development checkout. Preserve required licenses and attribution. A clean history does not remove licensing obligations. The export is an artifact, not a second development tree.

Use the reviewed export to initialize a separate repository with one root commit and a public-safe author identity. Never copy the development `.git` directory or push its branches or tags. Preserve the private development repository and its history; later public updates come from reviewed exports.

Before changing an existing repository’s history or visibility, approve the exact exported tree and destination. Replacing a branch does not prove that old hosted commits, tags, pull requests, releases, or cached artifacts have disappeared. Review those surfaces separately; if sensitive material ever reached the destination, resolve that exposure before publication. Enable GitHub private vulnerability reporting, run hosted CI on the exact release commit, and verify a fresh clone before announcing the alpha. Keep private deployment records and rollback material outside the public repository.
