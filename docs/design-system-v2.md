# Risk Report Generator design system, v2.6

The look every new screen follows: calm, Apple-like screens, white cards on a pale page, Marsh navy for actions and titles, and colour only where it means something.

- **See it:** the design system artifact, https://claude.ai/artifact/TfMsJ7P3xDDbR3jLZwgH79 (colours, type, components with live previews, motion, toasts). Ask Jesper for access if the link doesn't open.
- **Where it came from:** the CP-23 design canvas (rounds 1–6, Nov 2026), https://claude.ai/artifact/L4TgUQYe21kDGMRKLazmeG.
- **Relation to the old guide:** `docs/design-system.md` still lists the code's tokens and components. Where the two disagree on look and feel (type, spacing, shape, motion, colour use), this file wins. Restyle old components to this look as you touch them.
- **For coding agents:** read this file before any UI work, together with the `apple-design` skill. Use the token names below; don't add new hex values.

## Skills used to build this design system

Jesper builds and checks every screen with these agent skills. Install the same ones so your agent follows the same rules. Sources come from the local install records; where none is recorded it says so.

**From** `emilkowalski/skills` (https://github.com/emilkowalski/skills)

- `apple-design`: the Apple feel (type, materials, springs, restraint). Used on every UI change.
- `emil-design-eng`: judges polish and the small details that make a screen feel right.
- `mobile-native`: makes screens feel native on a phone (375 px checks, tap targets, safe areas).
- `review-animations`: reviews motion code against the Motion card. Run once in Check.
- `improve-animations`: audits motion across the app and plans fixes. End-of-project polish.
- `break-ui`: stress-tests a screen with worst-case data (long names, empty lists, huge counts).
- `animate`: builds one motion from the Motion card (purpose, property, curve, duration).
- `find-animation-opportunities`: finds the few places motion helps and what must not move. Used on the Motion board.
- `remove-animations`: removes motion the app doesn't need.
- `animation-performance`: fixes janky or costly animation (blur, big areas).
- `ask-sonner`: Sonner toast setup and styling, for the Toast component. Docs: https://sonner.emilkowal.ski

**From** `pbakaus/impeccable` (https://github.com/pbakaus/impeccable)

- `impeccable`: build new UI, then audit, critique and polish it. Used on every frontend change.

**Other sources**

- `web-design-guidelines`: checks UI code against Vercel's Web Interface Guidelines, which the skill fetches from https://github.com/vercel-labs/web-interface-guidelines (the skill's own repo is not recorded locally).
- `playwright-cli`: drives a real browser for the 375 / 1280 / 1440 / 1920 px screenshot checks. Repo not recorded locally; its SKILL.md installs the tool with `npm install -g @playwright/cli@latest`.
- `dataviz` (optional, for charts): source not recorded locally.

**How to install:** copy or clone the skill folder into `~/.claude/skills/` (all projects) or `.claude/skills/` (this repo only), so that `<skill>/SKILL.md` exists, then restart your agent. For Codex use `~/.codex/skills/`. Jesper's install records come from the `npx skills` installer; check each repo's README for its own install command.

## 0. Why this exists: one app, one look

The point of this system is **consistency**. The same kind of information looks and behaves the same on every screen, whichever story built it and whoever uses it (engineer, knowledge admin, account admin). A user who has learnt one table, one status pill or one jurisdiction chip already knows them everywhere else, so the app feels familiar and easy, even on a screen they have never opened.

- **Same data, same component.** A jurisdiction is always the blue globe chip, a status is always its pill, a due date is always the Report due cell, a list of records is always the standard table (section 2). Never restyle one for a single screen.
- **Look before you build.** Before designing or coding a screen, find where the app already shows the same kind of thing and reuse that component and layout. Only if nothing fits, make a new pattern, mark it "NEW pattern" on the canvas, and add it here once approved.
- **Reference screens** (copy these when showing the same kind of thing):
  - Records in a table, with filters, row actions and footer counts: the Observations tab (CP-22) and the Assessments / Clients lists (CP-23).
  - A record's own page (header, chips, tabs, side facts): the client page (CP-23).
  - Adding or editing a record: the Add observation form (CP-22) and the New Assessment form (CP-23).
  - Files and uploads: the client Documents tab and the reading screen (CP-23).
- **A baseline, not a ceiling.** The canvas mock screens and this file set the direction. Build and Check should make the real screens look better than the mocks (spacing, alignment, motion, detail), never different in kind.
- **Check enforces it.** Every new screen is compared with its approved board and with the reference screen for its kind of content before Jesper sees it.

## 1. Principles

1. **One font.** The system font (SF Pro on Apple devices): `-apple-system, BlinkMacSystemFont, "SF Pro Text", Inter, system-ui, sans-serif`. No second family.
2. **Navy is for actions and titles.** Primary buttons and page/card titles use `--marsh-navy`. Nothing decorative is navy.
3. **Colour means something.** Red = late or an error, amber = soon or not sure, green = done or new, and the category colours (jurisdiction, facility, assessment type, file type). Never colour for decoration.
4. **Quiet surfaces.** Thin 1 px borders, no heavy fills. Shadows only on things that float (popovers, menus, toasts, the Create button).

## 2. Rules every screen follows

- **Icons first for actions.** Row and secondary actions are 32–36 px round icon buttons: bin = remove, rotate-ccw = retry, archive, chevron = open, pencil = edit, plus = add, download. Bins are red; every other icon is quiet grey. Words only for the one main action of a screen (Create, New assessment, Upload, Cancel).
- **Tooltips name the action only** ("Rename client", "Delete document"), never the client, site or file, so a long name never buries it. The screen-reader name still names the item ("Rename client NUS"): pass `tooltip` beside `label` on IconButton, RowAction or NavAction.
- **Not allowed yet: grey out and explain.** A blocked action stays visible, greyed and focusable (`aria-disabled`). Hover, focus or tap opens a reason box saying why ("Can't remove yet · This client has 1 open assessment. Archive it, then remove the client."). No error after a click, and no names in the reason.
- **Hover by background.** Hover changes the fill, not the border: grey on white, white with a ring on grey, darker on grey buttons, a white veil in segmented tracks and on navy. The surface sets it; hover only where a pointer can hover.
- **Dropdown options keep their icons.** If a value shows an icon anywhere in the interface (a status pill, a type tile, a Report due state), its dropdown option shows that same icon and colour. Values with no icon of their own, such as jurisdictions, stay plain.
- **Keyboard-only focus ring.** The navy focus ring shows for keyboard use only (`:focus-visible`), never after a mouse click, on every control.
- **A toast for every confirmed action.** Create, save, delete, archive, upload and restore each show a toast (section 7), so the state is always clear.
- **Collapsed sidebar = full width.** When the sidebar collapses, the page content fills the full width, keeping its 32 px side padding. Check every screen with the sidebar open AND collapsed.
- **Layout.** Navy sidebar on the left, in navy, white and one light blue only (the avatar), with no accent colours. The one exception is the Inbox's red count, like the bell's, because it means work is waiting; the collapsed rail and phone menu show it as a dot. A white top bar holds the round Back button (section 6) beside the eyebrow and page title, the main action (top right) and the bell. Page background `--graphite-50`, cards white.
- **One list frame.** Every list screen: top bar with one helper line under the title (what the page is for), then a 64 px toolbar (search, filter pills, a labelled sort pill, the main button at the right end), so every list's header row starts at the same height.
- **No filler copy.** No captions explaining the obvious ("Kept under the client"), no counts in page headers; the one helper line under a list's title is the exception. Counts live in the table footer ("5 assessments · 3 reports late", the late count is a filter link). Help goes behind a (?) icon.
- **Words.** Plain English, short. Use "assessment type" (First survey, Resurvey, Follow-up); never "visit". Errors say what's wrong in ≤ 4 words, then the fix.
- **Tables.** The name column (Client, Assessment, Document) is left-aligned, header and content; every other column is centred. A labelled sort pill names the current order and the sorted column shows an arrow; groups reorder with it. A row that just changed (created, uploaded, edited) holds a soft blue tint for 1 s, then fades. Columns spread across the full width; the hover-actions column is only as wide as its icons (32 px each + 2 px gaps). Fixed-content columns get fixed widths (Report due 168 px, small numbers 64 px). Long text wraps to at most 2 lines, never widens a column.
- **Forms.** One full-width column. Fields 40 px high in rows (e.g. Site name | Jurisdiction | Facility type, then Address full width). "Add …" actions are slim dashed rows. Cancel and Create sit in a sticky action bar at the bottom of the window (section 6); the top bar keeps only the title. On Create with missing fields: scroll to the first one, turn its border red and show one short line under it; pressing Create again gives that field one small shake. No error box or banner.
- **Dates.** Typed and shown as dd/mm/yyyy in forms; tables and pages show "12 Nov 2026".
- **Not-sure values** (AI-filled, needs a look): amber border and tint with one 16 px warning icon, centred in the field, 12 px from its right edge (8 px left of a dropdown's chevron), no caption.
- **No "made by AI" labels.** New screens don't mark things just because the AI made them: no "AI draft", "AI-generated" or "AI proposal" badges and no AI tint or rule on AI-written text. Violet itself is fine for anything it already means (statuses, the site walk proposal, email tiles). Existing screens stay as they are.
- **Phone.** Everything works at 375 px: no sideways scroll, 44 px tap targets, 16 px text in inputs (no zoom on focus), safe areas (`viewport-fit=cover`), tables reflow, dialogs fit, and popovers and menus become sheets under 768 px (`mobile-native` skill). The phone top bar is the sidebar's navy (`--surface-nav`) with the stacked wordmark; the drawer is the desktop sidebar.

## 3. Colour

Existing code tokens (`client/src/design-system/tokens/colors.css`) are reused; the two **new** ones are marked.

| Role                 | Token                          | Value             | Use                                                                     |
| -------------------- | ------------------------------ | ----------------- | ----------------------------------------------------------------------- |
| Navy                 | `--marsh-navy`                 | #000f47           | Primary buttons, page and card titles                                   |
| Marsh blue           | `--report-navy`                | #002c77           | Avatars, First survey tile text. Alternative button colour to try later |
| Blue tint            | `--ink-50`                     | #e9f2fe           | Soft fills, jurisdiction chip, First survey tile                        |
| Blue tint, strong    | `--ink-100`                    | #d3e6fb           | Counts, selected tag, search marks                                      |
| Blue text            | `--ink-600`                    | #2c5488           | Jurisdiction chip text, Word file tile                                  |
| Page                 | `--graphite-50`                | #f7f9fc           | Behind every screen                                                     |
| Fill                 | `--graphite-100`               | #eef1f6           | Filter pills, search field, dividers inside tables, skeletons           |
| Border               | `--graphite-200`               | #e0e5ec           | Cards and fields                                                        |
| Text                 | `--graphite-900`               | #1a1f26           | Body text, values                                                       |
| Label                | `--graphite-700`               | #3d4550           | Field labels, table heads, status words                                 |
| Muted                | `--graphite-600`               | #545e6b           | Secondary text, icon buttons, the fix part of an error                  |
| Placeholder          | `--graphite-400`               | #a3aebb           | Empty fields, waiting circles                                           |
| Red                  | `--red-600` / `--red-50`       | #ad2e2d / #fdeae8 | Late dates, error words and their icon only. PDF tile                   |
| Amber                | `--amber-600` / `--amber-50`   | #8f5f13 / #fdf1d8 | Due within 7 days, not-sure fields, Follow-up tile                      |
| Green                | `--green-600`                  | #2f7049           | Done tick, New badge text, success toast icon                           |
| Green tint **(new)** | `--green-50`                   | #e6f4ea           | New badge background                                                    |
| Teal **(new)**       | `--teal-600` / `--teal-50`     | #016d9e / #dff4f8 | Facility chip, Resurvey tile                                            |
| Violet               | `--violet-600` / `--violet-50` | #6258a3 / #eeecfb | Draft status, email file tile                                           |

The canvas drew green as #1f7a45; code uses the existing `--green-600` (#2f7049), which passes contrast.

## 4. Type

| Style      | Size / weight                     | Use                                                        |
| ---------- | --------------------------------- | ---------------------------------------------------------- |
| Page title | 28 / 700, `--marsh-navy`, -0.01em | Top bar title                                              |
| Card title | 16 / 700, `--marsh-navy`          | Card and section headings                                  |
| Body       | 14 / 400                          | Rows, fields, text                                         |
| Label      | 12 / 600, `--graphite-700`        | Field labels, table heads, small group labels              |
| Eyebrow    | 11 / 700, caps, +0.08em           | Above the page title                                       |
| Small      | 12–13 / 500                       | Second lines (Client › Site), due-date lines, status words |

Numbers that line up (dates, counts, refs) use `font-variant-numeric: tabular-nums`.

## 5. Shape and size

| Thing                    | Value                                                                          |
| ------------------------ | ------------------------------------------------------------------------------ |
| Cards                    | radius 16, 1 px `--graphite-200`, padding 16–20                                |
| Fields                   | 40 px high, radius 10                                                          |
| Buttons                  | 40 px high, radius 999. Create adds `box-shadow: 0 6px 16px rgba(0,15,71,.28)` |
| Pills, chips, tags       | radius 999; chips 24–26 px high                                                |
| Tiles (file, type, site) | 32 px, radius 9                                                                |
| Popovers, menus, toasts  | radius 14, shadow `0 12px 32px rgba(0,15,71,.16)` + 1 px `--graphite-200` ring |
| Tap target               | 44 × 44 minimum                                                                |

New radius tokens to add when building: `--radius-card: 16px`, `--radius-popover: 14px`, `--radius-field: 10px`, `--radius-tile: 9px`.

## 6. Components (all drawn in the artifact)

- **Buttons:** primary navy pill (New assessment, Create), secondary pill (`--graphite-100` fill: filters, Documents · 3), icon buttons (section 2).
- **Status pills:** Draft (violet), Not started (grey dashed circle), Under review (amber), Archived (outline). Icon + word.
- **Chips:** jurisdiction (blue, globe icon), facility (teal, building icon). Plain, no border. A client's division is plain text (facts panel, Clients table's second line), not a chip.
- **New badge:** green tint, green text, 12 / 700.
- **Tag pill:** fixed width so every row matches: 164 px in tables, wider in the documents popover (sized in Build so a long "Site · Assessment" fits). Tag icon first, chevron last; long text ends in … with the full name on hover.
- **Date cell** (`ReportDue`): calendar icon 8 px from the date, centred on its two lines; date 14 / 500; a 12 px second line, at most two lines. Report due: late = calendar-x and red "N days late"; within 7 days = calendar-clock and amber "in N days"; on track = grey "in N days"; none = grey "Not set". Next survey uses the same cell with its site as the second line (`note`), never late; in the Clients list it drops the icon (`icon={false}`) so a long site name can't push it away. No coloured fills.
- **Segmented control:** First survey / Resurvey / Follow-up, each with its icon and wearing its assessment-type colour; the white thumb slides to the choice and the tile beside "Assessment N" follows it. Sits on the "Assessment N" header line.
- **Back button:** a round 36 px button beside the page title: `#eef1f6` at rest, `#e3e8ef` on hover, scale 0.96 pressed, navy focus ring.
- **Reason box:** a small white box (popover look) tied to one control: a short title and one line saying why. Opens 150 ms after the pointer rests, on focus, or on tap. Use it instead of a plain tooltip whenever the answer is "why not".
- **Date picker** (`DatePicker`): a dd/mm/yyyy field; a click or tap anywhere on it opens the calendar (popover on desktop, centred card on a phone) while focus stays in the field, so typing still works. Typing adds the slashes (8 digits fill it; "1/" pads to "01/") with the rest of the mask shown faintly; number pad on phones. Calendar: month arrows, Today, Clear, days before a minimum greyed, today ringed, 44 px cells on phones, full keyboard.
- **Sheet:** a bottom sheet on phones (44 px rows, Cancel at the bottom, no close icon), or a centred card for the date picker.
- **Sticky form action bar:** Cancel and Create pinned to the window's bottom edge, 48 px, 16 px text; Create swaps its word for a spinner in the same width while saving.
- **Dialog** (`className="ds-dialog--v2"`, the chat's Apple sheet in the app font): 18 px corners, no border, shadow `0 24px 64px rgb(0 15 71 / .18), 0 2px 8px rgb(0 15 71 / .08)`; title 19 / 600 navy; a round grey close button floating in the corner, so the helper text runs the full width (14 px, normal line filling, no balanced wrapping); no footer band; pill buttons, 44 px and equal width on phones. Helper text says the consequence and the way back in one or two plain sentences, never repeating the title ("It won't be offered for new assessments. Existing assessments stay as they are, and you can restore it from Removed sites."). Titles name the thing ("Rename Northgate Freight Group"); buttons name the action.
- **Long lists in popovers:** five rows show, the rest scroll with a fade and a scroll bar; the add row stays in view. Popovers float above every card and the sticky bar.
- **Dashed add row:** full-width, 40–44 px, 1.5 px dashed `--graphite-300`, navy text with a plus.
- **File tiles:** email violet, PDF red, Word blue, text grey; unknown types grey.
- **Fields:** normal, not sure (amber, section 2), error (red border + one line under it).
- **Found so far** (reading screen): Client, Sites, Assessments groups, each only as tall as what was found once the read is in; grey placeholder rows while reading.
- **Documents popover:** opened from a "Documents · N" button in the client card; rows of file tile, name + size, Tag pill, bin; a dashed "Add documents" row. No caption.
- **Reading status cell** (files being processed): words first, then the indicator at the right edge. Working = status words in 13 px `--graphite-700` + a 16 px spinner; Waiting = "Waiting" in `--graphite-600` (the words need 4.5:1 contrast) + a 16 px hollow circle in `--graphite-400`; Done = 16 px green filled tick only. **Spinner, circle and tick are the same size and sit in the same pixel column.**
- **Ask tab** (AS-01, NEW pattern): the review workspace's right inspector has Evidence and Ask tabs at its top (shared `Tabs`, Ask with its count); below 760 px Evidence stays in the panel and "Ask about this assessment" opens Ask as a bottom sheet (`ds-dialog-sheet`). A question sits on the right on `--surface-sunken`; its answer is a card with a 3 px `--ai-fg` left rule and `--ai-border`, "Answer" in violet and the `ConfidenceIndicator` (High/Medium/Low) on its header line, the statements with `CitationMark` numbers, any "Evidence missing:" line on `--surface-sunken`, and its sources as `EvidenceCitation`s, a quote not found marked with an amber "Quote not found" badge. Selecting a citation or source switches to Evidence and opens it there. While it is written a violet pulsing dot names the step (Searching…, Writing…). A failure is a danger callout, "Answer stopped at 14:02: <cause>. Ask again.", with Ask again. The question box is a `Textarea` (Enter asks, Shift+Enter a new line) with Ask, or Stop while answering. AI violet here is AC2's exception to "No made by AI labels". Built without a board; to approve on the canvas.
- **Ask about this** (AS-02, NEW pattern): selecting the draft's text in the review workspace shows a small secondary "Ask about this" button (`message-circle-question`, 6 px under the selection, the popover shadow); where the selection can't be asked about it is greyed out with its reason box, and Ctrl+Alt+K says the reason in a small card. In the document editor the same action is a toolbar icon beside Comment, with the Ask panel (`message-circle-more`) beside the comments list, a 380 px panel in its place. The passage is quoted verbatim behind a 2 px `--border-strong` rule in `--text-secondary`, under the section's name: in the question box (on `--surface-sunken`, with an × to take it off) and above the question once asked, with a "Go to the passage" link, or a grey "Text deleted" tag once its words are gone; more than four lines fold, with "Show the whole passage". Going back marks the words on `--ink-100`, as search marks are. Where the sources disagree, the line starts "Sources disagree:" in semibold `--text-secondary` with `git-compare-arrows`, on `--surface-sunken`, never amber or red: neither side is chosen. Built without a board; to approve on the canvas.
- **Comment margin and thread card** (RV-03, NEW pattern): in the document editor, open threads sit in a 296 px margin right of the text, each card level with its passage (amber tint `--amber-50`, the chosen thread's `--amber-100` with an `--amber-500` underline); cards that would overlap move down, the chosen one stays level with its text. A folded card shows the first comment (avatar initials on `--ink-50`, name, time, three lines) and "N replies"; chosen, it unfolds with every comment, Edit (pencil) and Delete (red bin) on one's own only, a reply box and a round Resolve (tick) or Reopen (rotate-ccw) icon button. The comments list is a 380 px panel over the right of the editor (full width on phones), with Open / Resolved / All as a segmented control; where no margin fits, threads open there too.
- **Search marks** (CP-13, NEW pattern): a search box (`SearchField`) at the left of a list's toolbar, the count beside it reading "2 of 9 recordings" while searching; on a phone the search takes a full row, 44 px tall, with the count under it, and the filters follow two to a row in even columns, on the Observations tab and on All Photos, Pages and Recordings (Location, Category, Severity and the item's own Status or Description). The words found are marked in place (`HitText`, `.ob-hit`): `--ink-100` behind the text, its colour unchanged, 2 px radius; in forced colours the system's Mark. A mark inside an AI-unsure word keeps the dotted violet underline round it. An item found in its closed text opens it. On the Observations list a 13 px grey line with a 12 px search icon under the text says where else the words were found ("Matched in Recording 2"). None found: the empty state with a search icon, "No recordings match “forklift”" and a tinted Clear search. Built without a board; to approve on the canvas.
- **Failed row:** neutral row and tile; under the file name, a red alert icon + the short error in red 600, then the fix in grey ("Can't read .zip files. Add PDF, Word, Outlook (.msg) or .eml files."); one grey bin (or retry) icon on the right. Only the icon and the short error are red.
- **Rejected pill** (`RejectedPopover`): beside Documents on the filled-in form, only when a file was refused or failed to read. A red `circle-x`, the navy word, a red count (`--red-50` fill, `--red-600` text). The popup is as wide as its longest message, so every message stays on one line (min 320, max 720); long file names are cut with "…" and never widen it. Tiles are neutral grey and there are no row actions. On a phone it is a sheet and messages wrap; the two pills share a row under the heading, 44 px tall, no chevrons.
- **Photo tiles** (`PhotoStrip`): `repeat(auto-fill, minmax(72px, 1fr))`, gap 8, square, so a row always ends exactly at the card above it (5 at 460 px, 4 at 343 px). A dashed "Add photo" tile the same size always follows the last photo. Remove is a 28 px white circle with a red bin in the corner: on hover or focus on desktop, always on touch, with a 44 px tap area.
- **Recording row** (`RecordingRow`): a state goes on the second line after the length, as words with a 14 px icon (`2:05 · Transcribing`); a finished one shows only its length. Failed is a red alert icon and red words, with a grey retry icon beside the red bin. On a phone the failed words read "Try again"; screen readers still hear "Couldn't transcribe".
- **Site walk mark** (`ObservationBadge`): an observation from a walk has a 20 px round footprints mark on the bottom-right corner of its category tile, with the tooltip "From site walk", and no pill.
- **Inbox row** (a mail list crossed with a checklist, not a table): one card of rows, each a tick circle, an icon tile, three lines of words (sender in grey, task in bold, detail in grey), the due date cell and the time. Every marker is centred to the row's height, and this goes for row icons in any list. Words keep a fixed column and never run under the dates; title and helper wrap to two lines each, then "…"; desktop text stops at 640 px. A failure's detail word and tile are red, and a document needing a look is amber. The bin appears on hover or focus in place of the time. Tabs are To do with a red count, and Done; their empty cards are the same height.
- **Phone Inbox row:** the ring holds the type icon and ticks the item when tapped, as a 44 px target. Two lines of words, and the due date alone on the right, or nothing if there is no date. The bin shows on Done rows only.
- **Thin popover header** (the bell): 40 px, with 28 px grey icon buttons for its actions, and no count text or close button. On a phone sheet: title 19 px, header 60 px, 44 px targets with 20 px icons.
- **Bell number:** app font, 12 px bold, tabular numbers, 18 px tall, growing to the right so 99+ doesn't cover the bell.
- **Already-handled dialog** (`AlreadyHandledDialog`): says a row's work was already dealt with. Centred: 48 px green tick badge, title 17 / 600, then the person's avatar, name and time at 13 px on one line. One normal-size primary pill, only as wide as its words. No close button, and Esc does nothing, because it has one way out: a `Dialog` with no `onClose`.
- **Assigned engineer picker:** a person's role sits in grey on the right of their name, in the list and once chosen. A long name is cut and the role stays.

## 7. Toasts

Use **Sonner** (`ask-sonner` skill), styled to this system and wrapped in our own `Toast` helper so callers don't depend on Sonner directly.

- Sonner's default behaviour: stacked (newest in front, older ones peek behind and spread on hover), swipe to dismiss, pauses on hover and while the tab is hidden, a loading toast that turns into success or error (`toast.promise`).
- Our styling: white card, radius 14, 1 px `--graphite-200`, the popover shadow, 14 px text with the title in `--graphite-900`; icon only coloured: green tick for success (our own `SuccessIcon`, the tick raised 0.4 units to its optical centre), red alert for errors; an icon-button close. The icon is centred in the toast's height, on every toast. The toast hugs its message, centred, up to 356 px; longer text wraps.
- Both toast paths (Sonner `toast.*` and the older `Toast` still used for archive and create) share the icon and the layout.
- Actions are small buttons inside the toast: "Undo" after archive/delete, "View" after create. Errors don't auto-close.
- Every confirmed action gets one (section 2).

## 8. Motion

Built with the `animate` skill, reviewed with `review-animations`. Motion only to give feedback, show where something came from, or bridge a change; under 300 ms for UI; never on things used many times a day. Animate `transform` and `opacity`; with reduced motion, fade only. Use the existing tokens in `motion.css` (`--ease-out`, `--ease-standard`, `--duration-fast` 120, `--duration-base` 180, `--duration-slow` 260) and add `--duration-scroll: 450ms` and `--ease-in-out: cubic-bezier(0.77, 0, 0.175, 1)`.

Rules: 120 ms for hover and colour, 180 ms for things appearing, 240–260 ms for screens and bars; exits faster than entrances; only position, size and fade (plus one small shake for a repeated error); with reduced motion every motion becomes a fade; nothing moves under a list you are reading.

| Where                                               | What                                                                                                                                                                                                                                                                               | Timing                                                              |
| --------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| Create with missing fields                          | Smooth scroll to the first missing field (stops 96 px under the top bar), focus it, border turns red, error line fades in and slides down 4 px. Pressing Create again while the error is still there: that field shakes once, 4 px                                                 | scroll 450 ms ease-in-out; border 120 ms; line 180 ms; shake 300 ms |
| Reading progress bar                                | One bar for all files; grows with `scaleX`; a faint sweep while working; turns green when full                                                                                                                                                                                     | 400 ms ease-out per step                                            |
| Found so far                                        | Each item replaces its grey placeholder: placeholder fades out, item fades in and rises 4 px; "+ N more" number crossfades                                                                                                                                                         | 120 ms / 180 ms ease-out                                            |
| Status words                                        | Words crossfade as they rotate; spinner becomes the tick, drawn in                                                                                                                                                                                                                 | 120 ms; tick 260 ms                                                 |
| A file that fails to read                           | Its short error fades in and slides down 3 px under the name, in place of the spinner                                                                                                                                                                                              | 180 ms ease-out                                                     |
| Reading done → form                                 | Bar turns green, page blurs (0 → 6 px) behind a small card "All 6 documents read · Preparing the form…"; after the pause the card and blur fade and the form cards fade-rise in, 40 ms apart, once (fill `backwards`, so a finished card never traps a popover under the next one) | 180–260 ms ease-out                                                 |
| Adding or removing a site, assessment or contact    | New block fades in, rising 6 px; a removed block fades out, then the space closes                                                                                                                                                                                                  | add 180 ms; remove 120 ms                                           |
| Picking a site card                                 | Card presses to 0.98, its navy border fades in, the tick pops from 80%                                                                                                                                                                                                             | border 120 ms; tick 180 ms                                          |
| Segmented controls                                  | The white thumb slides to the choice; interruptible                                                                                                                                                                                                                                | 180 ms ease-out                                                     |
| Sticky Create bar                                   | Rises from the bottom edge once the form is ready; Create swaps to a spinner in the same width                                                                                                                                                                                     | rise 260 ms; swap 120 ms                                            |
| Client page tabs                                    | The new panel fades in, rising 4 px; the tab bar doesn't move                                                                                                                                                                                                                      | 180 ms ease-out                                                     |
| Documents: the row that changed                     | Upload: fades in and holds a blue tint 1 s; retag: the tag crossfades; delete: the row fades out, then the table closes up                                                                                                                                                         | 180 ms; tint 1 s + 260 ms; delete 120 ms                            |
| Reason box                                          | Opens after the pointer rests 150 ms, fading in and growing from the button's corner; fades out when it leaves                                                                                                                                                                     | in 150 ms; out 100 ms                                               |
| Switching Assessments and Clients                   | The sidebar highlight glides; the old page fades out, the new one fades in rising 6 px                                                                                                                                                                                             | out 100 ms; in 200 ms                                               |
| Going deeper (list → client page, → New Assessment) | The new screen slides in 16 px from the right as it fades in                                                                                                                                                                                                                       | in 240 ms; out 120 ms                                               |
| Going back                                          | The earlier screen slides in 16 px from the left; filters and sort kept                                                                                                                                                                                                            | in 240 ms; out 120 ms                                               |
| Sidebar                                             | Highlight glides to the picked item; collapse eases                                                                                                                                                                                                                                | 260 ms                                                              |
| Popovers and the date picker                        | Scale from 0.97 and fade, origin at the trigger; the calendar's month slides when changed                                                                                                                                                                                          | 180 ms in, 120 ms out                                               |
| Dialogs                                             | Open: fade and scale from 0.97 with the backdrop fading in. Close (Cancel, ✕, Esc or after confirming): the card fades and scales to 0.98 with the backdrop. A save error slides in 4 px; a step change (Edit site → its scope check) crossfades                                   | open 220 ms; close 150 ms; error 180 ms; step 160 ms                |
| Sheets (phone)                                      | Rise from the bottom edge with the scrim fading in; leave the same way                                                                                                                                                                                                             | 260 ms in; 200 ms out                                               |
| Centred card (date picker on phones)                | Fades and scales from 0.96                                                                                                                                                                                                                                                         | 220 ms in; 160 ms out                                               |
| Navigation drawer (phone)                           | Slides in from the left with the scrim fading in; leaves the same way                                                                                                                                                                                                              | 260 ms in; 180 ms out                                               |
| Toasts                                              | Come in from the edge they leave by                                                                                                                                                                                                                                                | 260 ms in; 120 ms out                                               |
| Press feedback                                      | Buttons scale to 0.97 while pressed (Back button 0.96)                                                                                                                                                                                                                             | 120 ms                                                              |
| Hover                                               | Background fades                                                                                                                                                                                                                                                                   | 120 ms                                                              |
| Ticking an Inbox row                                | Circle presses to 0.88 and fills, tick draws, pause, row fades and lifts 4 px, list closes up. Unticking is the mirror                                                                                                                                                             | fill 120 ms; tick 260 ms; pause 240 ms; row 180 ms                  |
| Back to the Inbox after opening a row               | The row is there ticked, then leaves as above, only when returning by Back                                                                                                                                                                                                         | pause 240 ms; row 180 ms                                            |
| New item on an open Inbox                           | Row fades in rising 6 px and holds the blue "just changed" tint                                                                                                                                                                                                                    | 180 ms; tint 1 s + 260 ms                                           |
| A count rising (sidebar)                            | One pop to 1.2 and the number crossfades; the phone menu's dot pops                                                                                                                                                                                                                | 260 ms; 120 ms                                                      |
| Last To do item cleared                             | Tick draws, "All done" rises 4 px                                                                                                                                                                                                                                                  | 260 ms; 180 ms                                                      |
| Move to Done (already-handled dialog)               | Dialog fades out, then the row's usual tick plays. No toast: the tick is the confirmation                                                                                                                                                                                          | 150 ms, then as ticking                                             |

Not animated: rows reordering on sort or filter, row hover actions and the rows themselves, opening filter and sort menus beyond their quick scale-in, staggering list rows on load, keyboard shortcuts, Report due cells.

**Sound (F-10).** Generated in code with Web Audio, no sound files. The bell is a soft handbell; the Inbox is two rising notes. A sound plays only for an item newer than anything this person has seen, so your own actions and an item coming back by an untick stay silent. Several at once play one sound, and the Inbox wins. Two open tabs don't both play.

## 9. How this system grows

- **Plan:** every UI story starts on a design canvas built from this system and the artifact above. New screens reuse these components; anything new is marked "NEW pattern" on the board.
- **Keep the approved boards with the story.** Each story's spec lives in its own folder with its boards beside it: `<specs>/sprint-<n>/<story>/<story>.md` and `<specs>/sprint-<n>/<story>/boards/v1/01-<Screen>.png …`. A later round of changes goes in `boards/v2/` and holds only the boards that changed, under the same numbers (e.g. `v2/05-Clients.png`, `v2/07-ClientDocs.png`); the latest version of each number wins. The spec's **Design references** section lists them, so Build and Check build from the images even after a handoff.
- **Approve:** Jesper approves boards on the canvas before Build.
- **Save:** when a story is committed, approved new patterns are added here (the section they belong to) and to the artifact, in the same story. Changes are versions, nothing here is final: improve a pattern by updating it here and noting why.
- **Changelog:**
  - v2.0 (4 Nov 2026, CP-23): first version from the CP-23 canvas.
  - v2.1 (5 Nov 2026, CP-23 feedback rounds 7–16): tooltips name the action only; grey out and explain (reason box); hover by background; keyboard-only focus ring; one list frame with a helper line; first column left, the rest centred; labelled sort; "just changed" row; dates as dd/mm/yyyy in forms; Not-sure icon placement; Back button, date picker, sheets, sticky action bar, Apple dialog (look, copy and motion), long lists in popovers, Found so far; one date cell for Report due and Next survey; toast tick and width; the full motion set with its rules (replaces the seven-motion list, and "no shake" becomes one shake on a repeated error).
  - v2.2 (5 Nov 2026): sidebar, phone drawer and phone top bar back to the original navy (`--surface-nav`); dropdown options keep their icons; sign out uses the sidebar's own hover; sidebar is navy, white and one light blue, 224 px wide so a role fits on one line. Phone lists run edge to edge with fixed due columns; the phone All view shows Client › Site under the reference. On tablets (768–1023 px) Rename and Remove are round icon buttons, and Sort drops to its icon only where a labelled pill would squeeze search under 96 px.
  - v2.3 (5 Nov 2026, RV-03): the comment margin, thread card and comments list (section 6), built without a board; to approve on the canvas.
  - v2.4 (6 Nov 2026, F-10 and RV-11): Inbox row and phone ring; row icons centred to the row; red Inbox count as the sidebar's one exception; thin popover header and bell number; already-handled dialog; role in the engineer picker; Inbox motions and the sound rules.
  - v2.5 (7 Nov 2026, Sprint 4 fixes): a toast's icon is centred in its height; Rejected pill; photo tiles that fill the row; recording row with its state on the second line and a retry icon; site walk footprints mark.
  - v2.6 (9 Nov 2026, AS-01): the Ask tab in the review workspace's inspector (section 6), built without a board; to approve on the canvas.
  - v2.7 (12 Nov 2026, CP-13): search marks on `--ink-100` and "Matched in" (section 6), built without a board; to approve on the canvas.
  - v2.8 (12 Nov 2026, AS-02): Ask about this, the quoted passage and "Sources disagree" (section 6), built without a board; to approve on the canvas.

## 10. When this file says nothing

Get everything from this file first. Only if it gives no guidance on something, use the old guide, `docs/design-system.md`. Never copy an old rule that this file already decides.
