# Backend Guide

This tree owns the Fastify application, direct SQLite storage, schema, assembly, provider/tool loop, effects, compaction, images, operations, and production static serving.

Read `docs/BACKEND_REQUIREMENTS.md`. Read the frontend requirements when an API or shared-contract change alters visible behavior.

## Architecture

- Keep one small composition root and resource-owned handlers under `src/routes/`.
- Organize the kernel by behavior: assemble, attempt/tool loop, candidate storage, acceptance/effects, compaction, and search.
- Use `server/schema.sql`, prepared `better-sqlite3` statements, small row decoders, and transactions adjacent to their invariants.
- Build one capability catalog at startup or global reload. It contains standalone Skills plus the tools, Memory providers, and terminal targets supplied by built-ins and configured external dependencies. Assembly only selects the bot's desired usable subset.
- Ordinary MCP and Memory servers keep separate authored roles and protocol validation while sharing one direct MCP connection owner. Docker containers remain a separate direct implementation behind the same external-dependency lifecycle boundary.
- Complete SQLite transactions before provider, MCP, TTS, Docker, or filesystem network I/O.
- Keep the two global FIFOs, active cancellation/stream handles, one cron timer, the immutable capability catalog and live MCP/Docker resources, TTS requests, terminal children, and recall in process. Persist conversation facts, one pending or committed leaf per eligible covered range, effects, current session variables, schedules, and attachment/authentication facts.
- Validate application boundaries with Zod and provider tool schemas with TypeBox.
- Preserve provider-reported usage and unknown-usage uncertainty.
- Keep backend-only types local and cross-boundary contracts in `shared/`.
- Resolve package and mutable-data paths at startup and pass them explicitly.
- Serve every client through the authenticated API/SSE contract.

## Schema

- `SCHEMA_VERSION` in `server/src/database.ts` is the version the code reads; `server/schema.sql` stamps the same number and a test enforces the pair.
- A schema change bumps both. Startup initializes an empty database or requires the exact current schema; test that a mismatch refuses without changing conversation facts or schema.
- During the public alpha, handle authorized operator-approved conversions outside the codebase, with an online SQLite backup and a coordinated server update.
- Do not retain migration code, compatibility branches, or repair passes.
- Use raw SQL for SQLite behavior such as FTS5 tables and triggers.

## Turn safety

- Admit the user position and empty assistant variant atomically before provider work. Finalize that variant with normal output or an appended system error.
- Store bounded tool evidence with a completed variant and keep selected conversational content canonical.
- Lock variant selection when conversation or accepted effects advance past it.
- Acceptance reads the selected response's saved provider usage in its locking transaction. After accepted effects finish, the same queue job checks prompt size against the current preset and runs session compaction when eligible. **Compact now** requests that work without the threshold check. Store no per-response compaction state.
- Run compaction operations and acceptance batches through one ordered effect queue. The first eligible compaction freezes one pending leaf before the live tail; one call or fallback commits it directly into context. Store no response request, candidate activation rule, special trigger kind, or synthetic tool row. Internal effects and Memory retention wait for ordinary acceptance. Nothing retries automatically.
- A selected Memory capability requires read-only `recall` and may support `retain`. Neither convention method is a separately selectable tool. Recall is transient input; retention uses the ordinary candidate-effect path.

## Files and tests

- Use generated storage keys, containment checks, checksums, and atomic file/database behavior for message images.
- Use temporary roots and real temporary SQLite databases in tests.
- Prefer Fastify `inject()` for request tests and a real listener for socket, streaming, or static-serving behavior.
- Use the deterministic faux provider for engine-owned behavior.
- Prioritize capability normalization, desired-selection filtering, assembly, exact schema initialization, authoritative admission, canonical variants and errors, compaction gating, duplicate effects, global external-dependency reload, and acceptance-boundary tests.
- Exercise the built entrypoint in a disposable root at packaging and transport seams.
