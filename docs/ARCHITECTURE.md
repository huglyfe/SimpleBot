# Architecture — SimpleBot

_A bot-first context engine for one endless conversation. Apache-2.0, self-hosted, single-user._

This is the current-state contract: what SimpleBot is, what owns what, and how one turn travels from request to stored effect. [AGENTS.md](../AGENTS.md) states the seven invariants and the working loop. The detailed contracts are [BACKEND_REQUIREMENTS.md](BACKEND_REQUIREMENTS.md) and [FRONTEND_REQUIREMENTS.md](FRONTEND_REQUIREMENTS.md); a cross-boundary change updates both in the same slice.

SimpleBot uses one bot-oriented application and engine. One named V2/V3 character card owns each bot, including its SimpleBot settings in `data.extensions.simplebot`. Its explicit default preset initializes new sessions; root config has no preset default. There is one authoring format and no separate per-bot configuration file.

## Thesis

> A conversation should be able to run forever, feel continuous, stay affordable, and require no manual context management.

SimpleBot joins bot-chat fidelity with durable context and explicitly granted capabilities in a system one person can understand. The engine is the product; the responsive WebUI is its golden client, and later clients use the same authenticated server contract.

It serves one person's ongoing bot conversations — editing, swipes, images, wall-clock awareness, long-running continuity, optional external capabilities — rather than the broader workspace, gateway, or multi-user category.

## Stack

- One Node 24–26 TypeScript process, one Fastify JSON/SSE API, one React/Vite WebUI, one SQLite database.
- Direct `better-sqlite3` plus FTS5. `server/schema.sql` is the sole pre-release schema definition. No ORM, embeddings, vectors, or semantic transcript retrieval.
- `@earendil-works/pi-ai` owns provider catalogs, authentication mechanics, normalized streams and tools, capabilities, usage, and faux-provider fixtures.
- SimpleBot owns assembly, the bounded model/tool loop, canonical conversation state, compaction, FTS history, effects, granted capabilities, optional MCP memory, schedules, media, and the authenticated client contract.

## Authority

- **SQLite** owns conversation facts, current session variables and to-dos, schedule definitions, and crash-visible work. Cron run timing is process-derived; a scheduled response is the sole run evidence.
- **Authored files** own configuration, presets, bots, and standalone Skills. Root config also names the external running dependencies SimpleBot manages. They are read when an operation needs them; direct reads are the baseline.
- **External providers** own model catalogs, MCP catalogs, memory, and remote data.
- **Process memory** owns live connections, streams, children, timers, and disposable projections.
- Transcript and authored sources outrank derived FTS and speech files.

Variables, to-dos, and schedules are ordinary session state. Operator edits update them directly; accepted model effects update the same rows. Effects retain the outcome of a requested action, but are never replayed to reconstruct current state. Variables carry only names and values; to-dos carry an ID, title, optional local deadline (date and time together), and note. Neither has edit history or attribution. Closing a to-do removes it.

### Authored ownership

| Owner | Owns |
| --- | --- |
| Root `config.json` | Providers, credential references, TTS, ordinary MCP definitions, Memory-server definitions, managed Docker definitions, authentication, application defaults, external-dependency lifecycle. |
| Private `secrets.json` | Saved credential values; owner-only file access, no value-read API, excluded from backups. |
| Presets | Persona, prompts, model choices, compaction policy, TTS synthesis choices. |
| Bot source | Identity, writing, greetings, default preset, and exact capabilities in one JSON document. No dependency lifecycle. |
| Sessions | Selected preset reference, transcript, variants, leaves, variables, to-dos, schedules, retrieval, accepted effects. |

Only the settings an operator actually chooses need to appear in `config.json`; configurable engine ceilings have working defaults and are reachable through the searchable Limits surface. File validation and settings clients share those schemas and defaults.

## One turn

1. **Wait.** Replies, swipes, and scheduled occurrences enter one global in-process ingress FIFO; compaction and acceptance enter one global effect FIFO. Each starts work in arrival order. One long attempt intentionally blocks later work from other sessions. Queued work disappears when the process exits.
2. **Admit.** At the head of ingress, store the durable user and assistant positions — or the new swipe variant — before any assembly or provider work. The stream's `admitted` event is the client ownership handoff: the composer clears and the server owns the turn. Pre-admission cancellation or rejection admits nothing. Once queued, the server continues without the browser, while explicit Stop still cancels.
3. **Assemble.** Read current SQLite state and authored files, resolve providers and grants against the published catalog, snapshot live resources, perform optional memory recall, and compile one immutable provider input. Variable and to-do reads keep that accepted snapshot throughout the attempt; proposed writes change state only on acceptance.
4. **Run.** Use that input through one sequential model/tool loop, streaming live output and accumulating candidate effects. Read tools, ordinary MCP calls, and Docker terminal and file commands execute here and return their results. Internal writes and Memory retention remain candidate effects.
5. **Respond.** Store the assistant output and its ordered reasoning/tool inspection trace using the same trace shape as the live client. An observed stop, failure, or context overflow preserves partial text and appends `<system_error>...</system_error>`; a no-output failure is the tag alone. There are no post-admission failed or cancelled outcome variants, and no automatic retry — retry is another swipe.
6. **Accept.** Applying effects or sending the next reply locks the selected response and admits its candidate effects.
7. **Apply.** Drain queued effects once in order. Store each result and continue after failure. An effect interrupted before its result becomes `unresolved` at restart; nothing re-applies it.

## Continuity

Provider-reported prompt size drives automatic compaction in the engine that assembled the request. SimpleBot adds the provider's mutually exclusive uncached input, cache-read, and cache-write categories once; output remains usage evidence and enters prompt accounting only if a later request includes it. Acceptance reads the selected response's stored usage, drains its accepted effects, then checks the current preset threshold and runs eligible compaction in that queue job. A client may display the stored usage evidence and request **Compact now**, but never reproduces the threshold rule.

Acceptance-triggered compaction and **Compact now** use that one session operation. At the queue head it freezes the next older canonical range before the configured live tail, inserts one pending leaf, and makes one summary call. The frozen transcript stays in memory; the leaf stores coverage and the resulting summary. Success or observed failure commits the summary or deterministic fallback directly into context; startup does the same for a crash-interrupted pending leaf without another call. If no older range is eligible, the operation no-ops. Eligibility and leaf uniqueness follow the covered range, so reducing the live tail can compact additional history without another reply.

A committed leaf is a session fact. Acceptance triggers the work, not activation of an already-created leaf; responses carry no compaction request or candidate leaf. Emptying a leaf preserves coverage while omitting its summary from reply context. Every later reply or swipe assembles from the committed leaves that exist when the attempt begins, while at least one verbatim exchange remains in the live tail. Editing covered history leaves its summary exactly as it is; nothing regenerates a leaf automatically. The operator may **Regenerate** any listed leaf: the same effect queue summarizes its range again from the current canonical transcript and current preset, replaces the summary on success, and changes nothing on failure. Later leaves keep the summaries they were written from.

## Capabilities

Dependency configuration and Skill edits save independently of activation. Before listen — and again on the one explicit global capability refresh — SimpleBot discovers standalone Skills, opens configured ordinary MCP and Memory connections through the same MCP transport owner, resolves configured Docker containers, and publishes one small immutable catalog. Reload opens fresh MCP connections, re-inspects Docker targets without restarting running containers, preserves ownership of containers SimpleBot started, and closes resources removed from the new set. It contains an exhaustive `mcp | memory | docker` dependency inventory and an exhaustive `tool | skill | memory | terminal` selectable inventory carrying only identity, description, Memory-retention support, and availability. Attempts select from that snapshot. A failed dependency stays visibly unavailable; nothing reconnects, lazily starts, or refreshes.

A bot's desired capabilities are one exhaustive `tool | skill | memory | terminal` list, with at most one Memory provider and one terminal target. An omitted list grants nothing, and unknown or unavailable entries remain authored. Selecting an exact MCP tool grants the progressive `tool_search` and `tool_call` bridge; selecting a Skill or terminal grants its read or execution tool. Implementation tools are never separately selectable. Built-ins use `system__<tool>`, MCP tools use `mcp__<server>__<tool>`, and Docker file tools use `docker__<container>__<tool>` consistently in grants, model calls, and inspection. Docker file tools expose their small schemas directly; MCP dispatch retains the original native tool name.

Ordinary MCP and Docker calls always execute during generation, including swipes and scheduled attempts. Granting a capability permits its calls; there is no separate write mode. An external write survives discarding or swiping its response, and a new attempt may perform another write.

Root `memoryServers` gives Memory its authored role before connection while reusing the exact MCP transport schema and lifecycle. Each entry must expose read-only `recall` and may expose stateful `retain`; those protocol methods are not selectable tools. Recall is transient assembly input, retention is an ordinary accepted effect, and the bundled Lorebook Memory MCP is the separate, read-only reference process; it imports SillyTavern World Info JSON without adding lorebook logic to the engine. Root config maps each managed Docker name to one exact operator-created container; a terminal capability selects that target and grants `system__terminal` as one bot fact.

Capabilities use standalone Skills and explicitly configured external dependencies. There is no plugin discovery, bundle manifest, or marketplace layer.

## Session isolation and search

Automatic context, ordinary history tools, variables, to-dos, schedules, leaves, effects, and writable state are session-isolated. FTS searches the canonical transcript and leaves within the current session. Separately granted bot-history tools are the sole built-in cross-session observation path — they read the same projection across the bot's previous sessions and never mutate state. Results carry readable session titles, one-based message numbers, kinds, and bounded canonical content; internal IDs never reach the model.

Selected variants and leaves are the search authority; search-document and FTS rows are rebuildable projections.

## Client contract

The authenticated server is the engine boundary for every client. Requests, authored files, external data, and browser responses validate at their receiving boundaries; typed server projections do not repeat outgoing runtime validation. Drafts, presentation, and warnings may remain client-local. Write behavior is fixed by the operation: ordinary MCP and Docker calls execute during generation; internal state changes and Memory retention wait for acceptance. The client never accepts a response merely because it completed. Admission, queue order, automatic compaction, cron, acceptance, effects, and dependency lifecycle remain server-owned.

After any privacy PIN unlock, initial render loads authentication, a compact bootstrap, and the selected session, with preset names for the active header; settings and capability surfaces load when opened. Server data lives in the client query cache while drafts and presentation state stay local. The installable WebUI keeps only build assets in its service-worker cache. An optional client-side privacy PIN gates presentation before private UI mounts on launch and conceals the mounted app on lock. Browser-control bypass is an accepted local-privacy limitation; pairing and its server-validated login cookie remain the authentication boundary (see frontend requirements, “Installed app and local privacy”). Message source is canonical, and safe Markdown/RP rendering preserves copied and edited source while treating raw HTML as text. Transcript pages carry positions only; committed leaves, server-derived exchange ranges, and context accounting come from a separately loaded bounded Context projection. Pending leaves and scheduled commands stay inside the backend.

## Runtime and operations

Startup validates required local state, acquires exclusive OS runtime ownership before opening SQLite, and performs exactly three deterministic completions — mark interrupted accepted effects `unresolved`, fill an admitted empty response with a generic system error, commit fallback for an incomplete pending leaf without another model call — activates configured dependencies once, publishes the catalog, and listens. It schedules only future cron occurrences. An empty database receives the current schema; an existing database must already match it. Startup refuses an incompatible schema without converting it.

`doctor` is explicit, read-only, network-free, secret-free, and non-repairing. Native HTTPS and one-owner pairing protect private APIs and assets. Each authenticated API request renews the same browser login and cookie using the current inactivity limit (30 days by default, 0 for none), only while its stored deadline is still valid. Startup/daily authentication cleanup deletes expired or revoked logins and expired or consumed pairing codes. A valid login can revoke every other browser login without master-key reauthentication. Backup and restore use SQLite's online backup boundary and report external references separately.

One versioned npm package contains the built server, WebUI, CLI, defaults, and notices. `npx @huglyfe/simplebot`, direct npm installation, Homebrew, and the source checkout expose the same `simplebot` executable and construct the same runtime. Package code and the operator's mutable root stay separate: updates and uninstall preserve operator data, and removal is a separate confirmed command.

## Principles

- **Bot first.** Conversation dominates; machinery appears through deliberate inspection.
- **Radically small.** Every abstraction, table, cache, worker, and transition pays for current behavior and a concrete failure boundary.
- **One owner.** Each fact has one authority; disposable projections are rebuilt.
- **Visible failure.** Missing sources, unavailable capabilities, broken projections, and uncertain writes report their real state.
- **Exact accounting.** Provider-reported usage drives token-sensitive behavior; unknown usage stays unknown.
- **One extension path.** New capabilities adapt to assembly, tools, and effects.
- **Explicit alpha upgrades.** `SCHEMA_VERSION` is the version the code reads and `schema.sql` stamps. Authorized operator-approved conversions happen outside the codebase after an online SQLite backup, coordinated with the matching server update. There is no migration ladder.

## Success

An ongoing conversation can run for months, retain continuity, use explicit portable capabilities, survive restart and upgrade, and remain traceable from request through assembly, generation, acceptance, and effects. One maintainer can reason about the whole engine.
