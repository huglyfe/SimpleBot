# SimpleBot Agent Guide

SimpleBot is a bot-first context engine for ongoing conversations with configurable bots. Preserve bot fidelity, endless continuity, explicit capabilities, and a codebase one maintainer can understand.

## Start here

Before changing behavior, read:

- `docs/ARCHITECTURE.md`
- the owning backend or frontend requirements
- the nearest scoped `AGENTS.md`

## Vocabulary

- **Operator:** the person who owns and runs the installation.
- **User:** the authored persona in a conversation.
- **Bot:** the authored identity, writing, and capability selections that own conversations; its source is one character card with inline SimpleBot settings.
- **Session:** one durable isolated conversation and its story-local state.
- **Attempt:** one admitted reply, swipe, or scheduled occurrence processed through generation. Every admitted attempt produces a canonical response; retry is a swipe.
- **Variant:** one stored assistant swipe at a stable message position.
- **Effect:** an internal state change or Memory retention held by a candidate variant and admitted on acceptance. Ordinary MCP and Docker calls execute during generation and do not become effects.
- **External dependency:** one root-configured MCP server or managed Docker container whose live resource SimpleBot opens or starts.
- **Capability:** one exact tool, Skill, Memory provider, or terminal target a bot may select from the published catalog.
- **Client:** a UI over the authenticated server contract.

Use these terms in code, contracts, and discussion.

## Seven engine invariants

1. **One authority.** SQLite owns conversation facts; files own authored state and configured external dependencies; external providers own their data. Projections and live resources are disposable.
2. **One assembly.** Each attempt reads authority once, selects from one immutable capability catalog, and uses one immutable input through its model/tool loop.
3. **One canonical path.** Only selected variants enter later context, search, compaction, or state.
4. **One acceptance boundary.** Internal writes and Memory retention are candidate effects. Acceptance locks the selected response and admits those effects. Ordinary MCP and Docker calls execute directly in every attempt's model loop so their results can inform the response. Completion alone never accepts a response.
5. **One ordered effect path.** Engine compaction work, accepted internal effects, and accepted Memory retention use one global process-local queue. Threshold compaction and **Compact now** use the same operation. Failures are results and the queue continues. Nothing retries automatically.
6. **One compaction gate.** Acceptance checks the selected response's saved prompt usage and triggers session compaction on the effect queue; **Compact now** requests that same work explicitly. The first eligible operation freezes one older canonical range before the live tail; a single call or fallback commits its leaf directly into context, and a later ineligible operation no-ops in queue. Swipes assemble from whichever committed leaves exist when they begin. Compaction never accepts or locks a response.
7. **Session isolation.** Transcript mutation, variables, schedules, leaves, effects, and writable state never cross sessions. Explicitly granted bot-history tools may read canonical history from other sessions belonging to the same bot.

If a design needs another authority, assembly path, effect path, retry system, or durable worker, stop and prove the failure boundary first.

Banned regardless of naming: reconciliation/recovery/self-healing passes, outboxes, job tables, dispatch queues beyond the ingress and effect FIFOs, retries, backoff, idempotency tokens, health checks that take corrective action, and defensive re-application of committed state. Crash mid-effect-drain and unknown queued Memory-retention outcomes end as operator-visible `unresolved` effects. An MCP or Docker write may survive a process crash without durable SimpleBot evidence; that narrower loss buys same-turn tool results without mid-generation persistence. Queued work and missed schedules disappear on process exit. An admitted turn ends as a canonical response. Startup performs only three deterministic completions: mark interrupted accepted effects `unresolved`, fill an empty crash-interrupted response, and commit a pending leaf's fallback without another provider call. These are accepted losses by design. During the public alpha, startup initializes only an empty database and otherwise requires the exact current schema. Keep one-time conversions outside the codebase; explicitly authorize, back up, and coordinate them with the operator deployment. Do not add a migration ladder or compatibility branches. Any change adding durability, queuing, or retry must name the permitting invariant and concrete failure in one sentence in its PR description, or be deleted.

## Three ways to damage the project

1. **Touching live data.** Run tests and development servers against disposable roots. Snapshot a live SQLite database through the online backup API. Keep credentials, conversations, generated databases, message images, and runtime data out of Git.
2. **Killing by pattern.** Stop only a PID captured at spawn or a verified listener owner. Several checkouts and agents may run simultaneously.
3. **Growing a second engine.** Keep SQLite and files authoritative, the authenticated server as the client boundary, and attempts as the conversation path. Adapt new capabilities to assembly, tools, and effects.

## Check every affected boundary

Before calling a cross-surface change complete, identify which boundaries apply:

- **Authority:** file, SQLite, external provider, process projection, and client cache.
- **Forward path:** create, connect, select, run, apply, or install.
- **Reverse path:** inspect, clear, disconnect, disable, roll back, or remove.
- **Failure and restart:** before commit, after commit, interruption, and unavailable optional capability.
- **Client contract:** API schema, live SSE, WebUI projection, authentication, and later-client compatibility.
- **Distribution:** source checkout, built server, paired browser, service manager, and future host compatibility when relevant.

Audit relevant boundaries; do not build unused clients or speculative abstractions.

## Working loop

1. Read the owning contract, current task, and scoped guide.
2. Inspect current code, behavior tests, and the named prior-art route.
3. Decide authority and failure behavior before choosing storage or abstractions.
4. Implement the smallest complete vertical slice through the real boundary.
5. Delete superseded paths, tests, dependencies, and documentation in the same slice.
6. Add behavior and invariant coverage, including restart or meaningful transcript size where relevant.
7. Run focused proof, then the canonical checks required by the scope.
8. Review `git diff --check`, `git status --short`, and the complete diff. Preserve unrelated work.

## Code map

- `server/` — engine, storage, providers, tools, HTTP/SSE, and backend tests.
- `web/` — React WebUI, browser state, interaction, and accessibility.
- `shared/` — JSON/SSE schemas and genuinely shared contracts.
- `acceptance/` — black-box production-shaped Playwright journeys.
- `docs/` — current product, architecture, implementation, and proof contracts.

Read the nearest scoped guide before working in one of these trees.

## Verification

In the macOS agent sandbox, `--single-process` can run isolated Chromium checks but has failed during browser-context reuse in the acceptance suite. An isolated pass does not establish full acceptance. Keep the suite unchanged and report full acceptance as unverified unless it completes successfully.

- `pnpm check` is the canonical proof. Run it locally; CI runs the same gates as parallel jobs. Each implementation slice expands it with its real proof, and every gate must stand alone.
- Use focused tests while iterating and report unavailable proof plainly.
- Stop development servers by their captured PID before canonical smoke or acceptance.

## Documentation and status

Keep repository documentation current-state and compact. Update the owning contract and user guide when behavior changes.

`docs/ARCHITECTURE.md` and the owning detailed requirements describe the implemented contract; `docs/USER_GUIDE.md` describes the shipped runtime. Planned work is not evidence that behavior exists. Update these contracts as implementation lands. State an invariant in one place: prefer the schema constraint or the test name that enforces it over a fourth paragraph describing it. Git history preserves retired milestone documents; dated reviews remain historical evidence.

## Done

- The behavior works through its real boundary.
- Focused regression coverage protects the contract and failure mode.
- The seven invariants still hold.
- The relevant contracts reflect the result.

- The diff contains only the intended change and contains no private or generated data.
