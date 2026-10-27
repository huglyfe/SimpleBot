# Prompt macros

SimpleBot expands one small deterministic macro set in bot and preset text. Ordinary generation and summarization use the same immutable snapshot.

## Supported macros

- `{{char}}` — bot name
- `{{user}}` — preset persona name
- `{{model}}` — selected model ID
- `{{date}}` — local date in the configured application timezone
- `{{time}}` — local time in the configured application timezone
- `{{weekday}}` — local weekday in the configured application timezone
- `{{isodate}}` — UTC date for the attempt
- `{{isotime}}` — UTC time for the attempt
- `{{idleDuration}}` — time since the preceding canonical user message
- `{{getvar::name}}` — one accepted session variable
- `{{todos}}` — current accepted to-dos, with IDs, titles, absolute and relative due dates, and notes; `No open to-dos.` when empty
- `{{listvars}}` — all accepted session variables as sorted `name: value` lines

Macro names are case-insensitive. `{{idle_duration}}` is retained as an alias for imported bot text. Unknown macros remain visible instead of being partially evaluated.

Idle duration uses the two largest useful adjacent units: seconds, minutes and seconds, hours and minutes, or days and hours. With no preceding user message it expands to `0s`. The `system__idle_time` tool returns the same format.

## Invariants

- Expansion reads one attempt snapshot and never writes state.
- Stored transcript and prior summary text remain verbatim.
- Swipes and later attempts assemble again from current accepted state.
- Clock macros above the live tail can invalidate a provider prompt cache; authors can place changing values in the Character note or post-history instruction when that matters.

`{{todos}}` uses the attempt’s fixed clock and application timezone. A due date is due throughout that local calendar day and overdue on the next. Place it in post-history to keep goals visible without engine-injected reminders; pending changes appear only after acceptance in a later assembly.

Only the macros listed here are supported. Expansion is stateless and does not execute scripts or random expressions.

Character cards resolve `{{original}}` in System and Post-history overrides to the corresponding preset prompt. V3 `nickname`, when nonblank, supplies `{{char}}`, `<char>`, and `<bot>` substitutions; `<user>` uses the preset persona name. Unknown macros remain literal.
