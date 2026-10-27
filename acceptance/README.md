# Acceptance suite

This directory contains black-box Playwright acceptance checks. Playwright builds the app and starts two isolated production-shaped Fastify processes: an ordinary faux-provider runtime and a protected pairing runtime. Tests interact only through public HTTP/SSE and browser-visible behavior.

Keep acceptance scenarios aligned with `docs/FRONTEND_REQUIREMENTS.md` section 14 and the relevant backend acceptance criterion. Do not replace focused Vitest coverage with large acceptance scenarios. The credential-free faux provider is the default for acceptance and regression runs.

Install the browsers once with `pnpm exec playwright install chromium webkit`, then run `pnpm test:acceptance`. CI runs this browser gate alongside the canonical checks. Runtime roots, traces, screenshots, and browser state remain outside the repository.

The browser suite follows the current structure. It covers pairing/logout; send, swipe, search, and preset inspection; Context-owned variable and schedule actions; current assembly and compaction-fallback evidence; Bot PNG import, artwork diagnostics, macro warnings, and bot-owned grants; distinct root settings surfaces; phone containment; reload, rename, and confirmed deletion.

Keep each failure contract at its owning boundary:

| Boundary | Proof to keep |
| --- | --- |
| Shared contracts and server | Parsing, SQLite authority, session isolation, canonical variants, acceptance/effects, queues, crash completion, and compaction. |
| Shared authored editor and form | Draft/revision snapshots, pending writes, failed saves, Discard, stale-write refusal, and explicit Reload latest. |
| Individual settings panels | Field mapping, validation, selected save target, and preservation of unrelated configuration. |
| Shared confirmation | One submission, pending controls, blocked dismissal, surfaced failure, explicit resubmission, cancellation, and focus return. Resource tests verify the action and target. |
| Browser | Native focus/inert/dialog behavior, two competing editors, saving during a held list refresh, one nested deletion failure, responsive layout, streaming and reload, pairing, and installed-app behavior. |

Preset editing, application settings, and Skill publication are separate journeys. The shared picker journey exercises a 400-model catalog, keyboard/focus behavior at desktop and phone widths, draft-only model changes, and persisted session preset selection. Root configuration is restored after each settings journey, including failures. The ordered trace lifecycle runs once on a phone, then checks desktop containment by resizing. Repeat a complete journey across engines or viewports only when that boundary has a distinct failure mode; retain the Safari scroll regression and native editor interaction matrix.

Focused server tests own queue ordering, crash completion, effect semantics, exact schema identity, dependency activation failures, and compaction edge cases. Package proof installs and runs the assembled artifact from a clean directory; Homebrew audit and service proof remain release gates. Do not reintroduce obsolete composer pop-outs, attempt states, plugin paths, or compatibility selectors to broaden a browser journey.

Privacy/PWA journeys cover local PIN lifecycle with a valid pairing cookie, phone/desktop lock surfaces, background grace and retained drafts, offline launch, exclusion of private API responses from caches, and a real second Vite build that waits for explicit reload. The upgrade journey owns a separate disposable static directory and runtime. These browser checks do not establish OS installation, trusted certificate setup, or app-switcher screenshot behavior on a physical phone.
