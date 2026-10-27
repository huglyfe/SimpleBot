# Acceptance Guide

This tree owns black-box Playwright journeys against one production-shaped Fastify process.

## Test boundary

- Exercise public HTTP/SSE and browser-visible behavior.
- Arrange state through public contracts or isolated startup fixtures.
- Use the credential-free faux provider and disposable runtime roots by default.
- Map journeys to frontend section 14 and the corresponding backend acceptance gate.
- Prefer accessible roles, labels, and visible text; add a test ID when the UI has no stable identity.
- Control clock, provider scripts, ports, and initial data.
- Retain failure traces outside Git and stop only captured PIDs.
- Run the production build through the shipping entrypoint once that entrypoint exists.

## High-value journeys

- Pairing, session creation, streaming, swipe-as-retry, locking, and editing.
- Session-owned compaction entering context immediately, **Compact now** leaving the current response swipable, acceptance-triggered compaction without response flags or compaction effects, crash fallback without retry, and two-FIFO ordering.
- Search/read across active and evicted leaves.
- Authored next-attempt reads, one desired-capability list, standalone Skills and root MCP definitions, global external-dependency save/restart, the separate Memory panel's on-demand health and selection path, lazy optional UI surfaces, images, and model-capability changes.
- Effects, variables, cron, memory, TTS, and Docker through their real visible boundaries.
- Desktop and phone keyboard, focus, touch, and non-hover paths.

## Live acceptance

Use live providers only when the task requires them and the operator authorizes the external calls. Report provider and capability evidence separately from faux-provider proof.

Browser installation and visual review require a supported Chromium host.

## Engines

Chromium runs the suite. A `*.webkit.spec.ts` journey runs on WebKit instead, and is for behavior that is only wrong there — Safari silently drops a scroll offset written past the end of a container, which a Chromium-only gate passed. Add one only with a defect that engine actually has.
