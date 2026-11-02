# Frontend Requirements — SimpleBot

Status: Current implementation contract. License: Apache-2.0.

This document owns visible behavior. `docs/BACKEND_REQUIREMENTS.md` owns the API and engine invariants that support it.

## 1. Product experience

SimpleBot should feel like a private, ongoing direct-message conversation with a bot. The bot, transcript, and composer dominate. Models, prompts, context, compaction, and capabilities appear through deliberate inspection.

The responsive WebUI is the shipped client. Clients own presentation while the authenticated server owns conversation state.

Keep the conversation shell eager and load the existing SettingsPanel chunk when opened. This is the single optional settings boundary; do not split individual controls or add speculative loading layers.

## 2. Information architecture

After any privacy PIN unlock, initial render loads authentication, a compact bootstrap, and the active session. An active conversation also loads preset names for its header. Other surfaces load their data when opened. Reads run once without retry or offline deferral. Healthy bootstrap and session reads may refresh on window focus; failed reads do not resume on focus or reconnect. Bootstrap and session failures share one standard Unable to load dialog with an explicit Refresh action for failed active reads. Concurrent failures never stack banners or dialogs; a failure without loaded data keeps Refresh available, while a background failure can be dismissed. A failed background bootstrap or session read preserves the mounted conversation and editors.

The application has five scopes:

1. **Navigation:** bots and conversations.
2. **Conversation:** transcript, composer, and the selected shared preset.
3. **Providers:** chat providers, credentials, catalogs, capability evidence, and TTS connection.
4. **Capabilities:** root MCP, Memory, and Docker configuration with published status.
5. **Application:** appearance, defaults, operational detail, and legal/source information.

Settings code loads on first opening, with cancellable loading feedback and a dismissible failure surface. The installed shell still precaches its public assets. Bot content, shared presets, providers, capabilities, and application settings retain distinct UI ownership. The Bot panel edits its one revision-checked tool, Skill, Memory, and terminal capability list.

### Owner pairing

- Show one pairing screen before loading private state.
- The authentication gate bounds its initial server read to ten seconds, cancels it on unmount, and uses the existing connection error/Retry surface when unreachable. Authentication requests use the shared API client.
- Accept a one-time code from `pnpm auth:pair` or the reusable owner key through one password-style field.
- Give the pairing action the shared phone touch target without enlarging the compact form, and keep the same target while it reports `Pairing…`.
- Report a generic invalid-or-expired result and keep submitted credentials out of browser storage, URLs, analytics, and logs.
- Replace the gate with the application after success; return to it when the browser session expires or is revoked.
- Provide logout in Application Settings. Its searchable Limits list exposes browser login expiry in days (default 30, 0 disables expiry), explaining that the limit measures inactivity and applies on next use. Place **Purge other logins** beside **Log out** in **Application → Login management**, above About and separate from the sheet header actions, using the shared filled danger buttons, equal-width action pairs, and 44px touch targets on phones, with a simple warning that other browsers will be logged out and this browser stays logged in; close the warning on success and retain failures inside it without retry.
- Default to native HTTPS and pairing. Present login-disabled mode as a restart-required local setting.

### Installed app and local privacy

The production WebUI is installable through its manifest and icons on trusted HTTPS (localhost is permitted for development). One build-generated service worker caches an exact list of public interface assets, including the entry HTML. API requests, attachments, artwork, audio, and writes pass directly to the server; there is no private offline store, background synchronization, or queued send. An offline launch can show the local lock screen; after unlocking, server unavailability uses the ordinary explicit Retry action. Cache availability is best effort and browser-owned.

The **Privacy PIN** is an optional, entirely client-side screen lock for casual local privacy, particularly in the installed PWA. Someone controlling the browser can bypass it through developer tools or local storage; this is an accepted product boundary, not a server-authentication defect. Installation does not strengthen that boundary. Pairing with a one-use code or owner key establishes the server login cookie; the server authorizes private requests independently of the privacy screen. The PIN neither encrypts conversations nor blocks API access with a valid login.

Application → Login management offers **Set privacy PIN**, **Change privacy PIN**, and **Remove privacy PIN** for one operator-chosen 4–20 digit PIN per browser storage area. Store only a salted PBKDF2 verifier. Each action saves through its own dialog; change and removal require the current PIN. Clearing site data removes the PIN and local preferences.

Persisted browser keys, login cookie names, and shell-cache ownership keep their stable namespace across product renames.

Launch and reload start locked before mounting private UI when a PIN exists. **Lock now** and automatic concealment use a full-screen native modal above every sheet and portal, keeping the mounted conversation and drafts intact. Backgrounding conceals immediately and stops message audio; returning within 30 seconds restores the screen, otherwise the PIN is required. Admitted attempts continue through the existing server path. Unreadable PIN storage fails closed; failed writes do not claim success. Browser screenshots and OS app-switcher previews are not a guaranteed protection boundary.

An updated worker waits while the app is open. A centered **Update available** dialog appears automatically, warning about unsent drafts and unsaved edits. **Later** preserves them and dismisses the prompt for this page visit; refreshing offers the waiting update again. **Update and reload** activates it explicitly. Other open windows are not automatically reloaded. Closing all app windows lets the browser activate a waiting version normally. Activation removes only obsolete SimpleBot shell caches. No periodic update polling or automatic reload.

### Desktop shell

- The drawer's right border resizes by dragging or focused Left/Right keys; Home/End select the bounds and Enter or double-click restores the default. Width stays between 240 and 480 pixels while reserving at least 400 pixels for the conversation, and persists per browser across reloads and collapse/reopen. Phone overlays retain their own width.
- A top-left hamburger opens the conversation drawer. While the drawer is open that same toggle is the close chevron at the top of the drawer itself, so exactly one control is visible for the state.
- The drawer begins with search followed by the close toggle, and groups conversations beneath collapsible bot headings.
- Bot rows show circular artwork, name, and one stable action slot. Expanded rows offer new conversation directly; collapsed rows put the menu in that slot, and the menu offers new conversation, bot management, conversation cleanup, and bot deletion with separate confirmations.
- Bot counts appear only when collapsed. Conversation rows are modestly indented beneath bot headings, with regular-weight titles and a neutral filled selection distinct from hover; keyboard focus retains its own outline. Each conversation row shows its relative recency (now, 5m, 3h, 6d, then a short date) and preserves the title as plain text, including literal punctuation. Navigation actions use the shared touch target. The drawer footer keeps Providers, Capabilities, and Settings side by side with their labels at every width.
- Conversation rows show one title line and an overflow menu ordered **Edit title**, then **Delete**. Editing opens the shared focused editor; Enter saves, failed saves retain the draft and error, and pending saves disable further edits and dismissal. Mark the active conversation with `aria-current`. Before an operator edit, the title is the bounded opening of the session's first message. The client never requests or waits for model-generated titles.
- Drawer search (section 12) shows a matching row one snippet line beneath its title. A failed search shows its error and labels the remaining results as title matches only. Superseded requests are discarded; changing the query requests a new search.
- **New bot** follows the bot list and opens one creation panel: enter a name or select a JSON/PNG character card, then explicitly **Create bot**. Name stays editable when a card is selected: a nonblank name overrides the imported name; blank uses the card name. A standard **Import card** button opens one picker for PNG or JSON; supported formats appear beside the button and the removable selected filename occupies its own row. The creation panel retains its draft across desktop/phone layout changes. Picking or cancelling a file never creates a bot; submission failures retain the choice and error in the panel.
- The drawer footer contains controls ordered Providers, Capabilities, and Settings with desktop text labels, accessible names, and tooltips. Each icon and label sits centered inside one content-sized target, with equal footer gutters.
- The header is three floating glass pills over the transcript: navigation at left, the active bot identity centered with the conversation's preset name beside it (hidden on phones), and distinct Conversation controls and Preset controls at right. Activating bot identity opens the bot panel. Between pills, pointer input reaches the transcript.
- A panel arrives from where its control lives. Preset opens as a right-hand side sheet from the header; Bot drops from the top under the identity it belongs to; the drawer's Providers, Capabilities, and Application panels open centered and near full screen, full-bleed on a phone. The dismiss affordance points back the way the panel came in: right for a right-hand side sheet, up for the top sheet, an X for a centered one.
- Settings, dependency, and preset reads share authored-file schemas and defaults. Character cards retain their raw payload.
- Each authored panel holds one draft and saved revision. Inline controls change that draft; Save (a checkmark icon, filled with the accent while there are changes) persists it; Discard (an undo arrow) restores its last saved snapshot without closing. Both are icon-only with accessible names and tooltips, and both are disabled while unchanged or saving. A panel with unsaved changes marks its title with an accent dot. Nested authored editors use Done (checkmark) to stage their edit and Discard (X) to close without applying it. Application Save/Discard includes staged browser appearance. A successful write adopts its returned revision and unlocks editing immediately; dependent list refreshes run separately. Background reads never rebase drafts; stale writes retain edits and offer Reload latest.
- Closing a dirty settings panel or switching away from a dirty preset offers Cancel, Discard, and Save. Save uses the same native validation and write path as the header and leaves only after success. Pending writes block editing and dismissal without dimming the form; failures retain drafts and an actionable error. Capabilities controls are ordered Refresh, Discard, Save. Refresh remains yellow and activates saved files only after dependency drafts are saved or discarded. Each Skill editor independently saves its own file and captured revision, with Save and Discard controls; confirmed Skill deletion acts immediately. Skill conflicts retain the draft; discarding and reopening Capabilities explicitly reloads the list. Privacy/login actions retain their explicit dialogs.

### Phone shell

- Keep the conversation as the primary screen. Use the browser-managed safe viewport; do not opt into edge-to-edge `viewport-fit=cover` or add a second layer of safe-area insets. The composer keeps its ordinary bottom gutter. Native keyboard accessory controls remain browser-owned.
- Open navigation and settings as labeled overlays with focus containment, explicit close, escape/back behavior, and safe-area spacing. The phone drawer uses the same focus, Tab containment, Escape, and focus-return behavior as other modals. Opening settings preserves the phone drawer and its search underneath, makes it inert, and returns focus to its opener on close. Selecting or creating a conversation still dismisses the drawer.
- Give every pointer interaction a visible touch path.

### Shared record editing

Long text, variables, schedules, summaries, providers, Skills, and external dependencies use shared record rows with a title and preview. A collection is one rounded, raised group with hairline dividers between records, and its Add row is a quiet accent line at the foot of the group; hairline dividers and small uppercase labels separate sections. Click a row to open its focused editor; Done (checkmark) stages authored edits and X discards the local edit. Skills and conversation records use Save (checkmark) to persist directly through their existing APIs. Red trash controls confirm removal: configuration removals enter the panel draft, while Skills and conversation records are deleted directly. Disable dismissal while pending and retain failures. Clear text through its editor. Actions retain accessible names, tooltips, shared touch targets, progress, and focus return to the opener or collection. Desktop uses a bounded overlay; phone editors follow the visual viewport and make the parent inert.

Session records commit through Save (or Create); authored subeditors apply their edits to the panel draft through Done. Short controls share the Field label/control row. Numbers and switches stay horizontal on phones; connection forms stack at narrow widths. Environment/header rows validate nonblank unique names and preserve exact values. Nested fields shrink within the viewport. There is no form registry, save timer, retry, or write queue.

Use near-neutral light/dark surfaces, one violet accent, alpha hairline borders, restrained shadows, and consistent radii from `web/src/styles/tokens.css`, which owns every concrete colour and size. Add rows share the collection geometry. Context metrics use aligned label/value rows, with input/output token counts followed immediately by Prompt cache hit/miss counts when usage is available. Cache hits are cache-read tokens; misses are input plus cache-write tokens. Keep cron syntax and onboarding unchanged.

## 3. Bots and conversations

- Show bot artwork beside the editable name, with a stable artwork fallback. Bot omits the visible Name caption while retaining an accessible label and empty-field placeholder; New bot keeps its visible Name label. The image button and “Saves immediately” hint share a wrapping row.
- Open Bot from the centered identity. Show name, default preset, capabilities, Writing, then greetings. The card owns an explicit default preset; there is no application default. Writing and greetings use the shared focused editor; confirmed removal enters the panel draft. Clicking artwork opens a larger viewer. A standard Add/Change image button below Name, beside the artwork, selects a PNG and saves it immediately, independently of card Save/Discard, with that behavior labeled beside the picker. Upload progress blocks further edits and dismissal; failures retain the prior image and any text draft. Successful replacement updates the panel, header, and drawer from the shared bot list.

- Create bots by name or import V2/V3 card JSON or PNG. Extract PNG metadata once into a named card JSON plus `icon.png`; preserve its payload and grants, reject slug collisions, and report the result inline.
- Start conversations deliberately. A bot's default preset initializes new sessions and leaves existing sessions unchanged. New bot creation opens Bot settings with the first valid preset alphabetically by display name already saved; imported cards without a default use the same choice.
- Keep conversation lifecycle actions in navigation. Confirm destructive operations with the named bot or conversation and exact scope.
- Edit the current bot's exact tool, Skill, Memory, and terminal entries in the bot editor through one desired-capability list and one revision boundary. Fold the multi-select entries into compact Tool, Skill, and Terminal groups with selected counts; keep Memory separate as the native single-select field its invariant requires.

## 4. Conversation transcript

- Render user and assistant positions as one ordered story. Swipes remain variants inside one assistant position.
- Open a conversation on its newest page and load older pages on an explicit operator action, so opening a year-old conversation costs the same as opening a new one and no history becomes unreachable.
- Scope the conversation surface to one session. A switch is a fresh conversation root, so an attempt in flight never streams into another session's transcript; its reply still completes and persists, and reopening that session shows it.
- Update loaded pages in place. A mutation patches the rows it reports changed, and a fresh newest page preserves loaded history when the ranges overlap or meet. If background turns leave a gap, use the fresh page and its older-history cursor so every intervening message remains reachable.
- Keep leaves out of transcript geometry. Use quiet accessible boundary bars for **Searchable history**, **Summarized context**, and **Exact context**, with message treatment that never relies on color alone.
- Keep tool and reasoning evidence inside its assistant position. Keep scheduled events as dedicated quiet system elements followed by the bot's response or intentional-silence state.
- Read a scheduled occurrence out of its stored element rather than showing the element. Present the schedule's name, its run instant, and the authored prompt as ordinary prose; the storage form is the engine's, not the operator's. Occurrences recorded before the prompt moved inside the element carry no prompt and show their heading alone.
- Use one safe Markdown/GFM renderer for every bot message. Operator text renders verbatim in a faintly accent-tinted bubble: Markdown is not how the operator writes. Copy and edit operate on canonical source. Clipboard failures show a visible message beside the response; copying again is explicit. Render a trailing `<system_error>` region within its assistant response as visibly distinct system material, not a separate recovery card.
- Show immutable model provenance in the message footer without repeating the provider. Let it truncate before controls move and expand when activated, and keep the stable swipe group at the leading edge. Message editing opens the same focused sheet as other records, with source, validation, explicit Discard, and failed-save drafts. The transcript and its toolbar do not switch into an editing layout. Swipe deletion is available directly on the toolbar when allowed. Keep message controls compact; when a variant has pending effects, place **Apply effects** before Copy so Copy and Edit never shift. The centered header owns bot artwork; do not repeat it beside every assistant message.

## 5. Composer and generation

The transcript extends behind the header toolbar and composer, with transparent surrounding space that passes pointer input through to the transcript. The composer reserves its measured height in transcript bottom padding so the last message can be scrolled above growing drafts, attachments, and notices. The composer and header pills share one translucent glass surface and blur; their text and controls remain opaque. Message footers reveal on hover or focus with a pointer and stay visible on touch. Top padding clears the toolbar at the start of the transcript; navigation errors retain their own visible space.

- Use an autosizing bottom-anchored composer with message text on the left and right-side controls: `+` images anchored at the top and Send/Stop at the bottom, both with 40 × 40 px targets flush with the entry area’s right corners, without outer control padding. Keep text padding independent and the empty composer 66 px tall including its border. Send/Stop uses a compact 32 px visible circle. Show staged images above the entry area only when present. Keep accessible names and tooltips.
- Require non-whitespace message text even when images are staged. The send button and ⌘ Enter / Ctrl Enter use the same send path. Ordinary Enter inserts a newline; composition and repeated shortcut keydown events never send.
- Allow one operator send operation in flight from upload through admission. While queued, keep the exact draft and staged files. A pre-admission rejection or cancellation keeps them because the conversation never owned them. On the stream's `admitted` event, clear the composer permanently and render the stored user and assistant positions from the server projection.
- Keep streamed content and tool activity inside the admitted assistant position. Preserve every event in order while publishing the live overlay at animation-frame cadence, flushing remaining progress on completion. Admission refreshes the session; completion refreshes the session and navigation once. Text before tool calls remains in the completed response. Stop and provider failure finalize that same response by appending the engine-authored system error tag. Reload during a hard-crash interruption shows the startup-generated generic system error; the stream itself is not replayed.
- Leaving the app or losing its stream does not stop queued or admitted work. On return, detach a potentially suspended stream and read canonical state. When the server reports queued or admitted work without a local stream, refresh the session once per second until it finishes; stop refreshing on a read failure. Preserve loaded history and allow explicit Stop after reopening. All session reads merge through one query path; a failed refresh retains the transcript and composer with the shared **Unable to load** dialog and explicit **Refresh** action. Returning during generation may discard the detached stream's partial preview until the canonical answer arrives. Do not replay streamed output or infer automatic acceptance for a detached attempt.
- Do not offer TTS for a response containing a system error and do not add retry, recovery, or error-card controls.
- Validate new images against the selected model before storing the user turn. Preserve historical images when later omitted for a text-only model.
- Show pending variable, cron, and Memory-retention effects as one ordered preview in the producing message. Add **Apply effects** when the selected variant has pending effects; applying or sending the next user message locks that position and applies them in order.
- Ordinary MCP and Docker calls run during generation and appear in tool evidence. Internal effects wait for **Apply effects** or the next message. Completion alone never accepts a response, including after reconnect; no write-mode preference exists.
- Replace pending previews with outcomes in place. Collapse applied effects behind one count-based disclosure; expanding restores the original effect order. Pending, applying, failed, and unresolved effects remain visible without expanding. Collapse state is presentation-only and resets on reload.
- Show an `unresolved` effect (accepted but interrupted before its result was stored) conspicuously in its producing message with one action: mark resolved. Do not offer re-apply or re-call.

## 6. Swipes and edits

- Navigate variants within one assistant position and show position/count. The client holds only the canonical variant, which is always present; stepping asks the server for the neighbour.
- Treat the authored opening message and `alternate_greetings` as ordinary swipes. Keep its regenerate control present but disabled; its previous and next controls behave like every other assistant position.
- Retry every admitted turn by swiping its assistant position. Edit the user source, settings, or grants before swiping when needed. Stopping and provider failure are already visible in the canonical response; do not restore the composer or add a retry flow.
- Permit selection changes and non-final variant deletion until the position locks. Swipe deletion confirms the selected target before applying the deletion.
- Edit user and assistant source independently. Preserve position, variants, provenance, effects, and attachments. Editing history a committed leaf covers leaves that leaf's summary exactly as it is until the operator regenerates it.
- Keep locked swipe controls spatially stable with disabled styling.
- A failed transcript mutation rejects with its actual error. The initiating editor displays it once and retains the draft; toolbar selection, acceptance, and resolve report through one conversation notice; swipe deletion retains pending state and failures in its confirmation. Nothing retries automatically.

## 7. Preset

The preset picker assigns the selected preset to the current session immediately; it does not merely choose a file to edit. A dirty draft offers Save, Discard, and Cancel before assignment. Failed assignment retains the current selection and draft. Already assembled attempts keep their frozen inputs; later assemblies use the new assignment. The Bot default picker stages its authored selection until Save. Open presets in their default editing state. Inline fields edit the panel draft; focused prompt editors stage changes through Done, and the panel Save persists the preset.

Offer Clone preset, Rename preset, and Delete preset beside the preset selector. Clone copies the current draft to a new file identity and display name. Rename changes only the authored display name; all file and conversation references keep their stable slug. Delete refuses bot or conversation references and reports the owner. Clone selects the new preset for the current conversation. If creation succeeds but selection fails, report that partial result and leave the new preset available for explicit selection. Delete lets the operator choose a preset to remove without assigning it to the conversation.

The editor contains:

- main provider/model and effort;
- summarization model choice and effort;
- one `Use main model for summaries` toggle over the authored reuse boolean; when off, reveal the separate summary-model picker;
- persona;
- compaction threshold, live tail, active-leaf cap, and maximum leaf length labeled explicitly in characters;
- system, instructions, post-history, and summary prompts;
- link to the owning bot source;
- authored context policy fields only.

Preset prompts and persona description use focused editors. Empty text clears the saved field while keeping its row visible. Empty bot System/Post-history overrides display Uses preset; other empty text displays Not set. Clearing a bot note preserves depth. Models, persona name, context policy, and voice remain inline.

Keep model selection inline on the Preset panel: the current model control expands a search field and bounded, scrollable results directly beneath it, without opening a dialog. Escape collapses the choices and returns focus to the control. Use one searchable model picker across all configured providers, saving the exact `{ provider, model }` reference. Show the provider beside each result and keep available catalogs usable when another fails. Custom model IDs require an explicit provider choice. Effort uses a native select with supported levels and any saved unsupported value.

Saved changes affect the next assembly for every conversation using the preset. Session context inspection and leaves live in Conversation controls.

## 8. Providers, capabilities, and application settings

### Providers & Keys

- List pi-ai chat providers with configured-connection add/remove controls.
- Configured provider rows show their URL and saved catalog count. Counts are catalog evidence, not continuous health. Failed discovery shows Catalog unavailable and its error. The focused editor owns the credential reference and optional URL. End with Add provider.
- Show the TTS connection as a summary row or Add speech connection. Its focused editor saves the complete connection; confirmed removal clears it. Synthesis choices remain preset-owned.
- Disable and mute preset voice controls while no TTS connection is configured; retain their authored values.
- Save one validated draft atomically to `config.json`.
- Offer Environment reference (`${NAME}`) and Saved secret (`secret:NAME`) sources for provider, TTS, MCP, and Memory credentials. Saved secrets are managed in Providers & Keys, and Capabilities points there: add, replace, remove, and reload metadata. Secret mutations save immediately and separately from panel drafts. Password inputs start empty and are discarded when the focused editor closes; values never enter query caches or browser persistence. Show reference-only selections and server errors for stale writes or in-use removal. Explain that saved values are excluded from backups and MCP changes require explicit capability refresh. Reject literal credentials in configuration. Discovery uses the saved reference; missing values report an error even when the provider has a static model catalog. Catalog counts describe available metadata, not proof of a successful generation request.
- Block provider removal while a preset references it.

### Capabilities

- Use the one published capability catalog for dependency status and bot selections; do not render a separate Published catalog section. The Bot panel filters that catalog without rebuilding a second client authority.
- Present the current bot's Memory entry as a distinct native single-select field with **None**, configured providers, availability, and retention support. Present tool, Skill, and terminal entries as the exact remaining desired-capability list. Allow at most one Memory provider and one terminal target. Unknown or unavailable desired entries remain selected and explain whether their dependency was removed, is unavailable, or stopped advertising the selection.
- Group bot tools into collapsible **System** and alphabetically ordered server sections, each with its own selected count and exact `system__<tool>` and `mcp__<server>__<tool>` names. Keep **Skills** visible even at zero selections and zero available entries; show **No skills available.** when expanded and empty. Keep terminal selections and unavailable selections in their existing sections.
- Edit exactly `{ mcpServers, memoryServers, dockerContainers }` through structured focused editors sharing one revision-checked root write. Saving preserves unrelated root config and does not activate resources. Dependency rows show published availability/errors; MCP rows also show published tool counts.
- Capabilities has one yellow refresh icon in the shared header-control style, labeled Refresh capabilities. It explicitly reconnects MCP/Memory, re-inspects Docker without restarting running containers, and rediscovers Skills. It spins only while pending; there are no per-dependency lifecycle controls.
- Failed dependency writes retain the focused draft. Refresh failure is separate from saved configuration. Skill rows provide create, edit, and confirmed delete for name, description, and instructions; descriptions wrap in a compact scrollable multiline field, instructions use the remaining editor space, and the conventional blank separator after YAML stays outside the editable body; existing names are stable identities. Supporting files remain outside the UI. Skill edits and deletion affect the published catalog only on refresh. Bot Skill grants remain in Bot.
- Save bot selections and writing together in the selected bot source through one revision boundary without restarting dependencies. The global Capabilities panel never edits bot grants.
- Show standalone Skills plus root MCP and Memory definitions in the one catalog. There is no plugin or marketplace surface.
- Show independently selectable `docker__<name>__read_file`, `write_file`, `edit_file`, and `search_files` entries grouped by Docker dependency, including unavailable prerequisite reasons. Show each managed Docker dependency's terminal capability. Selecting it grants `system__terminal` for that target automatically; there is no separate Docker selector or terminal grant.
- Treat adding a Docker entry as explicit authorization for SimpleBot to start and stop that exact operator-created container. Do not discover, create, rebuild, remove, or mutate other Docker containers.

### Application Settings

- Open as a centered near-full-screen panel with explicit close.
- Edit timezone, clock format (12-hour or 24-hour), appearance, and login mode directly. Clock format defaults to 24-hour and is saved in application settings; the compact bootstrap carries it and the timezone for message times, calendar grouping, schedule times, and deadline display. Choose timezone through one searchable list of friendly cities and IANA identifiers, built when Application settings opens; persist only the IANA identifier. Omit transient UTC-offset labels. The attachment ceiling, 256-variable session cap, and to-do bounds are fixed engine constants and have no controls here.
- Put every engine ceiling — message and tool limits, timeouts, image and terminal bounds — behind one search box rather than a permanent wall of number fields. Match on label, key, and keywords so an operator finds a setting by the word they think in. Show a setting when it matches the query or when it is already off its default, state the engine's value beside each field, and offer a reset that names the value it returns to. An empty result and an all-default section read differently and say so.
- Persist system/light/dark appearance per browser.
- Save validated system settings atomically to `config.json`.
- Include alpha version, Apache-2.0 license, source link, and bundled third-party notices.

## 9. Conversation controls

Conversation controls owns Context, To-dos, Variables, and Schedules, as one scrolling column of sections like every other settings sheet rather than a panel selector of its own. Its sections carry titles and field labels, not explanatory copy. Context loads one bounded session projection only when opened. Transcript pages and mutations never carry leaves.

Compaction threshold and live-tail settings belong only in the preset. Context shows the last request's stored provider usage as **input · output**, followed immediately by **Prompt cache** hit/miss counts, then **Last message cost**, committed leaves in context now, the current exchange, the first exact-context exchange, and **Compact now**. List active summaries newest first, with a short preview and server-projected exchange range. A row opens its full summary in the shared editor. Use **Summaries** and **Exchanges** in visible coverage labels, never Leaves or Positions. Derive other visual regions from those facts. Call usage **Last request tokens**, never **Current context**; the client does not estimate the next prompt or reproduce automatic-compaction policy. **Last message cost** sums the selected response's provider calls only when all usage is available; otherwise show **Unavailable**, including an empty conversation. A reported zero remains `$0.00`, and sub-cent costs retain four decimal places.

The Bot panel places only the editable name beside the artwork, with full-width default-preset and Memory server controls below in one undivided section. Preset selection uses the shared inline search; Memory keeps its native device picker. Neither opens the phone keyboard automatically.

A three-dot menu beside the preset selector offers Clone, Rename, and Delete; Delete uses the shared danger style. Escape dismisses the menu before the panel.

Bot and Preset panels share one searchable preset picker with loading/error feedback and a visible saved selection when it is absent from the catalog. Presets, models, timezones, and voices use one inline search component with bounded, scrollable results. Search stays above the results, starts blank, supports clear and keyboard selection, and ranks exact/prefix matches ahead of fuzzy matches. The saved selection appears first before searching. An absent saved selection retains its value and is marked **not in catalog**; an empty catalog still shows its guidance beside that saved choice. Long choice labels wrap in the results and remain available in the trigger tooltip. Desktop focuses search; phone preserves focus on the picker control until the operator taps search. Preset selection and persona name retain accessible labels without redundant visible captions. Providers & Keys keeps connection summaries and operational status without explanatory prose.

Bot card edits use one revision-checked authored write boundary. Artwork saves independently as described in section 3. **Writing** shows System, description, personality, example dialogue, scenario, Bot note/depth, and Post-history fields for every bot. Instructions remain preset-owned. Blank overrides inherit the preset. Every greeting can be removed; removing the first promotes the next and removing the last leaves no opening. Blank swipe choices remain selectable. The drawer offers **New bot**, whose panel creates by name or imports a character card (JSON or PNG).

### To-dos

- Show the current list in Conversation controls using the same record rows, focused editor, Save/Discard actions, and confirmed deletion as variables and schedules. Fields are Title, optional native Due date, Due time when a date is present, and Note. Selecting a date initializes midnight; the time is editable, and clearing the date clears the entire deadline. Native input presentation follows the device locale; saved rows use the application clock format. Rows show the absolute local deadline and relative due status in the application timezone. No closed-history panel or automatic reminders.
- Operator saves and removal apply immediately. Model proposals remain in the producing response's existing effect preview until acceptance. Keep failed drafts and refresh the Context projection after writes, using the existing cache path.

### Variables

- Open current-session variables from Conversation controls. The server returns current names and values, without history or change attribution. List each name and a short value preview.
- Present stored variables followed by one quiet **Add variable** row. The resting state has no empty creation form; selecting a variable or Add opens the same editor in edit or create mode. Support rename and delete, including the first variable from the empty state. Collect name and value together, enforce the engine's name and value limits before writing, refuse a name another variable already holds rather than overwriting it, and confirm a deletion's session-local scope. Keep entered data and report a persistent error when a write fails; never retry one.

### Schedules

- Open one Conversation-controls manager with stored schedules followed by a quiet **Add schedule** row. The resting state has no empty creation form; selecting a schedule or Add opens one editor in edit or create mode. Preserve delete, switch-style enablement, and the process-computed next run. Every schedule follows the one current application timezone without carrying or displaying a per-schedule timezone; render its next run in that application timezone.
- Operator to-do, variable, and schedule saves update session state immediately. Show model-proposed changes in the producing message's ordered effect preview until acceptance.
- Render each occurrence as a quiet system event with job and run time, followed by the response or intentional silence.
- Distinguish an active attempt, queued live occurrence, and disabled definition using live client state only. A generation failure is the canonical response beside its scheduled event. Do not show or persist a separate last outcome, and do not imply that missed or process-lost work will catch up.

## 10. Leaves and compaction

- Edit bot source, preset fields, and leaves through their owning surfaces with validation and effect timing.
- Show committed leaf content, coverage, provenance, and fallback status only in Context. Empty text saves normally and previews as **Empty summary**.
- Bound Context to the active leaf cap. Leaves the cap no longer admits stay reachable through search.
- Provide stepped and exact compaction-threshold controls with reserved-output validation and headroom warnings.
- Make **Compact now** enqueue `compact(session)`. It never names, accepts, locks, or stores a request on a response. Keep its label stable and disable it when no older range is compactable or while its request is running; on completion re-read Context so the newly committed leaf appears. Do not persist or poll a second job-state projection.
- Acceptance triggers automatic threshold compaction on the server's effect queue. Keep it out of the response stream and effect preview: there is no per-response compaction request, leaf acceptance state, or separate progress component. The next reply waits for the acceptance job before assembly.
- Render a committed fallback plainly in Context and keep normal compaction quiet.
- Give each listed summary a trailing **Regenerate summary** control. It overwrites without confirmation, spins while running, disables every row's regeneration control and the target summary's edit control until it settles, re-reads Context on success, and shows a failure in Summaries while the row keeps its prior text. This lock belongs to the mounted panel; it does not track jobs across clients or reopening Context.

## 11. Model capability and reasoning

Preset settings has separate Main Model and Summary Model sections, using the same section layout as Persona and Prompts. Both effort labels read **Reasoning effort**, with distinct Main/Summary accessible names. Each section keeps its model choice and effort together; Summary Model also contains its reuse switch.

- Distinguish configured, provider-declared, and live-verified capabilities.
- Derive the effort selector from supported values; treat `off` as distinct from inherited default. Changing the effective Main or Summary model resets its draft effort to the lowest reported supported level, including `off`. Unlisted custom IDs use `off`. Model selection and summary reuse wait for initial model discovery to finish. Opening a preset or selecting the same model preserves saved effort, including unsupported values. Keep effort selectors visible even for a single supported level. Summary reuse retains the separate model selection; disabling reuse initializes it from Main if absent, and a separate model is required when reuse is off.
- Show readable reasoning and tool activity in a collapsible disclosure inside the assistant position. It starts collapsed, including during streaming, and preserves the operator’s open/closed state when answer text begins and when the attempt completes. One assistant row spans streaming and completion; the disclosure belongs to its variant. Loading stored history or selecting another stored variant starts collapsed.
- While active, show `Thinking…` and tool-call count. After completion, show duration and tool-call count.
- Render the variant's ordered reasoning/tool trace sequentially in the same disclosure while streaming and after completion, reload, and swipe selection. Tool results update their existing rows, with status, duration, arguments/results, and failures. A completed attempt's call with no result says **No result**, not **Running**. Completion must not discard or reorder visible evidence.
- Display only evidence the provider supplies.
- Show the admitted turn being answered beside the live reply. Both positions come from the server projection; streaming is only a live overlay on the stored assistant position.

## 12. Search and long-lived navigation

- Conversations whose bot source is missing or invalid remain reachable under the bot slug; opening the Bot panel reports the source error.
- The drawer's search field is the client's one search. There is no second search surface inside a conversation.
- Match titles from the bootstrap list as the operator types, and widen with the server's full-text index over canonical messages and accepted leaves — including the ones Context no longer lists — across every session and bot. Show one snippet per matching row; do not expose internal search handles.
- Keep search and leaf expansion observational; assembled context changes only through their owning edits.

## 13. Visual system and accessibility

- Use one CSS-owned semantic palette for system/light/dark appearance and Markdown prose: neutral dialogue and headings, warm amber italic narration, soft violet blockquotes, and clearer violet links, list markers, and inline code on a faint violet background. Code blocks retain neutral text. Bold inherits its surrounding color; blockquotes retain their border and indentation.
- Apply user and bot accents only to identity surfaces.
- Build hierarchy through composition, spacing, typography, and weight.
- Give every control an accessible name, keyboard path, and visible focus. Use phone-sized touch targets for primary actions and compact 32 px targets for the repeated transcript control bar. Every control in that bar carries the 32 px target, including the ones whose own label is smaller.
- Sheets, confirmations, and the phone drawer use native modal dialogs for top-layer ordering, background inertness, and keyboard containment. One shared hook owns entry, Escape/backdrop dismissal, and focus return after DOM updates. Privacy concealment defers new dialogs until unlock. Confirmations own their asynchronous action, disabled controls, and retained failure in one component.
- Name destructive targets and consequences. Enabled actions that delete, remove, revoke, or discard use the shared red danger treatment across buttons, icons, menus, and confirmations, visible before hover; disabled actions remain muted.
- Keep switch tracks and thumbs visible in both themes, with distinct on, off, and disabled states. Combine color with text or icon state. Support reduced motion, high zoom, long text, missing art, and narrow viewports.
- Desktop chrome is compact: `--touch-target` and `--text-ui` are 32px and 14px with a fine pointer, and 44px and 16px at phone widths or with a coarse pointer, where iOS Safari would otherwise zoom a focused field and not zoom back out. Message prose and all multiline text entry stay at `--text-body` (16px) so text does not resize when a message opens for editing. Text-entry sizing belongs to the element rules in `base.css`; native selects and searchable pickers share minimum height, padding, radius, and chevron. Area stylesheets must not set a font size on an `input`, `textarea`, or `select`: a class-qualified selector outranks that rule, so a second opinion wins silently and the zoom returns.
- Shape every text-entry control from that same element rule, and give it its focus treatment from a rule that matches it selector for selector. A control that is deliberately unboxed clears the border itself.
- Compose actions, including menu items and menu triggers, from the shared button and icon-button styles with modifiers, and every hint, empty state, and failure from one of three shared text treatments. An area stylesheet that restates a button or a message style is a duplicate, not a variant.
- Compose every labeled control from one form row: a label, an optional description above the control, and an optional hint or error below it. Sheets share one form grammar rather than one per surface, so a control sizes to its own content and every settings sheet reads as the same surface.
- Preserve scroll stability during streaming and avoid token-by-token assistive announcements.
- Give the transcript viewport one owner, which moves it for four reasons only: a session opened, the loaded transcript changed while the operator was already at the live edge, an older page was prepended above what they were reading, or they asked to return to the latest. Rendering, reflow, focus, and browser scroll anchoring must not move it. A prepended page keeps the anchor message at its screen offset, measured by the owner: anchoring is suppressed at scroll offset zero, which is where the load-earlier control is pressed, so it cannot own that correction.
- Decide where the operator is by observing a marker at the end of the transcript, not by reading scroll offsets. Scroll events are deferred through momentum on iOS Safari, so an offset read during a flick is stale for the back half of the gesture.
- Suspend the viewport owner for the length of a touch gesture, ending it when scrolling stops rather than when the finger lifts. Arriving output must never cut a flick short.
- Keep the composer at a stable 16px bottom gutter on desktop, including on focus. Narrow touch viewports use a 4px typing gutter while the textarea is focused.
- Reserve the box for anything that loads late, including message attachments, so the transcript never shifts under whoever is reading it. The reserved box is a ceiling, not a size to grow into: an attachment smaller than it renders at its own size rather than being scaled up to fill it.
- Let the assistant control bar narrow rather than widen the application. A full bar's min-content is wider than a phone, so every ancestor between the scroll region and the row must be allowed to shrink past its content; model provenance is the one part that yields, and it truncates to nothing before a control moves. Nothing in the transcript may put a horizontal scrollbar on the document.
- Show swipe controls only for the newest unlocked assistant reply; omit them from locked history. Show `Return to latest` once the operator is more than two transcript heights back, and not before: reading back a few messages is ordinary scrolling and needs no control. Honour reduced motion when returning.
- Trim the loaded transcript back to a bounded window on reaching the live edge, where every dropped row is far above the viewport. Paging backwards may load without limit while the operator is reading; it must not stay loaded once they return to the end. Do not window the rendered rows or estimate heights — the second scroll algorithm that costs is worse than the DOM it saves.

The interface prioritizes readable long conversations, direct swipe controls, and compact conversation navigation.

## 14. Frontend acceptance

1. Desktop and phone layouts keep conversation primary and provide grouped bot navigation, import, bot management, bot identity, and distinct settings surfaces.
2. A fresh distribution has no bots and retains the default preset. The empty state directs the operator to New bot in the drawer; creating or importing a bot enters the normal session flow.
3. Admission immediately makes the turn canonical. Streaming, stops, provider failures, and hard-crash completion remain inside one logical assistant position; retry is another swipe.
4. Editing, variant navigation/deletion, and selection locking preserve stable positions.
5. The composer preserves a draft through pre-admission failure or cancellation. After admission it clears permanently while the transcript owns the turn.
6. Inline preset edits remain drafts until an explicit Save; subeditor Done actions update the owner draft without writing, and dirty panel dismissal offers Cancel, Discard, and Save. Valid saves affect later attempts and provenance remains immutable.
7. Cards, bot capabilities, presets, and leaves edit through their authoritative surfaces; PNG import produces the folder-backed card.
8. The transcript stays bounded; leaves and scoped search expose older canonical history while assembled context remains stable.
9. Effort and reasoning show provider-supported values and evidence with chronological tool detail.
10. Search stays canonical and observational, and the drawer owns the one search surface.
11. Appearance, provider, application, legal/source, title, and destructive lifecycle controls persist through their owning surfaces with exact confirmation and private credentials.
12. Context state, Markdown source, variables, keyboard/touch/focus, zoom, long content, reduced motion, scrolling, and failures remain accessible at desktop and phone widths. Focusing the pairing code, composer, search, message editor, and any settings control on iOS Safari leaves the page at its original scale.
13. Pairing protects private state through restart, logout, and revocation while credential failures stay generic.
14. Images use the composer's inline `+`; Context, To-dos, Variables, and Schedules live in Conversation controls; internal effects and Memory retention share one ordered **Apply effects** boundary.
15. One Capabilities panel has distinct editable MCP, Memory, and Docker sections with published status and MCP tool counts on the dependency items. Available status and MCP tool counts share the success color, with no “Published:” prefix; this reflects the last published discovery, not continuous connection health. Published status remains separate from saved configuration. The Bot panel uses a native single-select Memory field and exact tool, Skill, and terminal selections. Configuration saves independently; one Refresh capabilities icon loads dependencies and Skills. Bot selections use their own save boundary and contain no dependency lifecycle control. Desired and live state remain truthful without automatic recovery.
16. After any privacy PIN unlock, initial render loads auth, bootstrap, active session, and its preset-name list; optional surfaces load on open.
17. Privacy and PWA journeys prove cookie-independent locking, PIN changes/removal, background grace, retained drafts, offline shell launch, private-cache exclusion, and a two-build update with cancellation and cache replacement.
