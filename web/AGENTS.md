# Web Guide

This tree owns the React/Vite golden client. Keep the conversation primary and context machinery inspectable but quiet.

Read `docs/FRONTEND_REQUIREMENTS.md` and consult backend requirements for affected API or engine behavior.

## Architecture and ownership

- `src/api.ts` is the only JSON/SSE backend seam. It parses shared contracts and never probes fallback endpoints.
- `App.tsx` owns the compact bootstrap and active-session cache. Optional surfaces mount lazily.
- Server data lives in React Query. Drafts, active panels, streaming buffers, and browser preferences stay locally owned.
- `useAuthoredEditor.ts` owns one panel draft, saved revision, explicit writes, stale-write refusal, and Reload latest. `AuthoredForm` supplies pending controls and panel Save/Discard; the shared editor validates every save entry point, and a settings subeditor Done updates the panel draft and Discard drops its local edit. Dirty panel dismissal offers Cancel, Discard, and Save; Skills and conversation records save directly. Panel Save and Done are checkmarks, panel Discard an undo arrow, and nested Discard an X. No save timers or write queues.
- Bot owns exact tool, Skill, Memory, and terminal selections in its character card. Capabilities owns dependency configuration, standalone Skill editing, one explicit Refresh capabilities control, and published status. Configuration saves never refresh resources.
- SSE represents one live attempt with queued, admitted, progress, and completed events plus late-event handling.
- Import wire contracts from `shared/` and keep renderer view state in `web/`.
- Initial render loads auth, bootstrap, and active session, plus preset names for an active header. Optional surfaces fetch and mount when opened.
- Keep production requests same-origin and runtime origins host-owned.
- The privacy PIN is a client-side casual-viewing screen with intentional browser-control bypass, not authentication. Review against `docs/FRONTEND_REQUIREMENTS.md` → Installed app and local privacy; pairing/API authorization failures and failures to conceal the UI remain defects.

## Components and styling

- Keep one component per owning surface: shell/sidebar, conversation, settings, and authentication.
- `src/styles/` owns the palette: `tokens.css` holds every colour and step, including the compact desktop and touch-sized `--touch-target`/`--text-ui` split, and the area stylesheets compose those tokens. `pnpm screens [label]` captures reference screenshots of a built WebUI into the ignored `.ui-screens/`.
- Persist system/light/dark appearance in one browser key and apply it at startup.
- Extract a reusable primitive after a pattern repeats.
- Destructive actions (delete, remove, revoke, discard) use the shared red danger styles in their resting state, including icons and menus. Disabled actions stay muted.

## Interaction and performance

- Keep the composer anchored and preserve scroll position when prepending history or leaving the live edge.
- Give every action pointer, touch, keyboard, accessible-name, visible-focus, and adequate-target behavior.
- Use native dialogs through the shared dialog hook for modal surfaces; retain one close control, Escape dismissal, and focus return. Keep confirmation pending/error state in ConfirmDialog.
- Render card, model, and message text through safe source-preserving paths and the restrictive CSP.
- Treat phone widths as a primary layout with overlay navigation, safe-area spacing, and visible message actions.
- Exercise realistic long transcripts and streaming updates for list, cache, and animation changes.
- Preserve object identity on no-op cache updates when it prevents expensive rerenders.

## React and tests

- Keep hooks synchronized, abort async work on cleanup, and derive state during render when possible.
- Use component tests for deterministic interaction and `acceptance/` for HTTP/SSE/browser journeys.
- Add Playwright coverage with the first real cross-boundary interaction.
- Verify keyboard, focus, touch paths, responsive layout, streaming, editing, and swipe navigation.
- Review screenshot baselines on a supported Chromium host when visual behavior changes.
