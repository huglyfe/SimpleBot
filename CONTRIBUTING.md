# Contributing

SimpleBot is public alpha software maintained by [huglyfe](https://github.com/huglyfe). Small, focused fixes are welcome. Open an issue before proposing a new subsystem or changing the conversation model.

Read [AGENTS.md](AGENTS.md), the [architecture](docs/ARCHITECTURE.md), and the guide in the directory you are changing. Use a disposable development root:

```sh
pnpm install --frozen-lockfile
CI=true ./dev.sh
```

Keep the authoritative state and acceptance boundaries intact. Include focused behavior tests and update the owning contract when behavior changes. Stop your development server, then run `pnpm check` and `pnpm test:acceptance`. Report any unavailable checks in the pull request. Screenshots and fixtures must be synthetic.

Never include credentials, personal cards, conversations, generated databases, or operator files. Report security issues through [SECURITY.md](SECURITY.md).

Contributions are submitted under Apache-2.0. Only contribute material you have the right to license on those terms, and preserve required third-party attribution. AI-assisted contributions follow the same review and verification requirements.
