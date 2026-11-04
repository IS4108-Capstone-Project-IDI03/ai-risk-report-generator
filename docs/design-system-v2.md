# Risk Report Generator design system, v2

The look every new screen follows: calm, Apple-like screens, white cards on a pale page, Marsh navy for actions and titles, and colour only where it means something.

- **See it:** the design system artifact, https://claude.ai/artifact/TfMsJ7P3xDDbR3jLZwgH79 (colours, type, components with live previews, motion, toasts). Ask Jesper for access if the link doesn't open.
- **Where it came from:** the CP-23 design canvas (rounds 1–6, Nov 2026), https://claude.ai/artifact/L4TgUQYe21kDGMRKLazmeG.
- **Relation to the old guide:** `docs/design-system.md` still lists the code's tokens and components. Where the two disagree on look and feel (type, spacing, shape, motion, colour use), this file wins. Restyle old components to this look as you touch them.
- **For coding agents:** read this file before any UI work, together with the `apple-design` skill. Use the token names below; don't add new hex values.

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
3. **Colour means something.** Red = late or an error, amber = soon or not sure, green = done or new, and the category colours (jurisdiction, facility, division, assessment type, file type). Never colour for decoration.
4. **Quiet surfaces.** Thin 1 px borders, no heavy fills. Shadows only on things that float (popovers, menus, toasts, the Create button).

## 2. Rules every screen follows

- **Icons first for actions.** Row and secondary actions are 32–36 px round icon buttons with an `aria-label` and a tooltip: bin = remove, rotate-ccw = retry, archive, chevron = open, pencil = edit, plus = add. Words only for the one main action of a screen (Create, New assessment, Upload files, Cancel).
- **A toast for every confirmed action.** Create, save, delete, archive, upload and restore each show a toast (section 7), so the state is always clear.
- **Collapsed sidebar = full width.** When the sidebar collapses, the page content fills the full width, keeping its 32 px side padding. Check every screen with the sidebar open AND collapsed.
- **Layout.** Navy sidebar on the left. A white top bar holds the eyebrow, page title, the main action (top right) and the bell. "‹ Back" sits under the top bar, never in it. Page background `--graphite-50`, cards white.
- **No filler copy.** No captions explaining the obvious ("Kept under the client"), no counts in page headers. Counts live in the table footer ("5 assessments · 3 reports late", the late count is a filter link). Help goes behind a (?) icon.
- **Words.** Plain English, short. Use "assessment type" (First survey, Resurvey, Follow-up); never "visit". Errors say what's wrong in ≤ 4 words, then the fix.
- **Tables.** Columns spread across the full width; the hover-actions column is only as wide as its icons (32 px each + 2 px gaps). Fixed-content columns get fixed widths (Report due 168 px, small numbers 64 px). Long text wraps to at most 2 lines, never widens a column.
- **Forms.** One full-width column. Fields 40 px high in rows (e.g. Site name | Jurisdiction | Facility type, then Address full width). "Add …" actions are slim dashed rows. On Create with missing fields: scroll to the first one, turn its border red and show one short line under it. No error box or banner.
- **Not-sure values** (AI-filled, needs a look): amber border and tint with a warning icon, no caption.
- **No "made by AI" labels.** New screens don't mark things just because the AI made them: no "AI draft", "AI-generated" or "AI proposal" badges and no AI tint or rule on AI-written text. Violet itself is fine for anything it already means (statuses, the site walk proposal, division chips, email tiles). Existing screens stay as they are.
- **Phone.** Everything works at 375 px: no sideways scroll, 44 px tap targets, tables reflow, dialogs fit (`mobile-native` skill).

## 3. Colour

Existing code tokens (`client/src/design-system/tokens/colors.css`) are reused; the two **new** ones are marked.

| Role | Token | Value | Use |
|---|---|---|---|
| Navy | `--marsh-navy` | #000f47 | Primary buttons, page and card titles |
| Marsh blue | `--report-navy` | #002c77 | Avatars, First survey tile text. Alternative button colour to try later |
| Blue tint | `--ink-50` | #e9f2fe | Soft fills, jurisdiction chip, First survey tile |
| Blue tint, strong | `--ink-100` | #d3e6fb | Counts, selected tag |
| Blue text | `--ink-600` | #2c5488 | Jurisdiction chip text, Word file tile |
| Page | `--graphite-50` | #f7f9fc | Behind every screen |
| Fill | `--graphite-100` | #eef1f6 | Filter pills, search field, dividers inside tables, skeletons |
| Border | `--graphite-200` | #e0e5ec | Cards and fields |
| Text | `--graphite-900` | #1a1f26 | Body text, values |
| Label | `--graphite-700` | #3d4550 | Field labels, table heads, status words |
| Muted | `--graphite-600` | #545e6b | Secondary text, icon buttons, the fix part of an error |
| Placeholder | `--graphite-400` | #a3aebb | Empty fields, waiting circles |
| Red | `--red-600` / `--red-50` | #ad2e2d / #fdeae8 | Late dates, error words and their icon only. PDF tile |
| Amber | `--amber-600` / `--amber-50` | #8f5f13 / #fdf1d8 | Due within 7 days, not-sure fields, Follow-up tile |
| Green | `--green-600` | #2f7049 | Done tick, New badge text, success toast icon |
| Green tint **(new)** | `--green-50` | #e6f4ea | New badge background |
| Teal **(new)** | `--teal-600` / `--teal-50` | #016d9e / #dff4f8 | Facility chip, Resurvey tile |
| Violet | `--violet-600` / `--violet-50` | #6258a3 / #eeecfb | Division chip, email file tile |

The canvas drew green as #1f7a45; code uses the existing `--green-600` (#2f7049), which passes contrast.

## 4. Type

| Style | Size / weight | Use |
|---|---|---|
| Page title | 28 / 700, `--marsh-navy`, -0.01em | Top bar title |
| Card title | 16 / 700, `--marsh-navy` | Card and section headings |
| Body | 14 / 400 | Rows, fields, text |
| Label | 12 / 600, `--graphite-700` | Field labels, table heads, small group labels |
| Eyebrow | 11 / 700, caps, +0.08em | Above the page title |
| Small | 12–13 / 500 | Second lines (Client › Site), due-date lines, status words |

Numbers that line up (dates, counts, refs) use `font-variant-numeric: tabular-nums`.

## 5. Shape and size

| Thing | Value |
|---|---|
| Cards | radius 16, 1 px `--graphite-200`, padding 16–20 |
| Fields | 40 px high, radius 10 |
| Buttons | 40 px high, radius 999. Create adds `box-shadow: 0 6px 16px rgba(0,15,71,.28)` |
| Pills, chips, tags | radius 999; chips 24–26 px high |
| Tiles (file, type, site) | 32 px, radius 9 |
| Popovers, menus, toasts | radius 14, shadow `0 12px 32px rgba(0,15,71,.16)` + 1 px `--graphite-200` ring |
| Tap target | 44 × 44 minimum |

New radius tokens to add when building: `--radius-card: 16px`, `--radius-popover: 14px`, `--radius-field: 10px`, `--radius-tile: 9px`.

## 6. Components (all drawn in the artifact)

- **Buttons:** primary navy pill (New assessment, Create), secondary pill (`--graphite-100` fill: filters, Documents · 3), icon buttons (section 2).
- **Status pills:** Draft (violet), Not started (grey dashed circle), Under review (amber), Archived (outline). Icon + word.
- **Chips:** jurisdiction (blue, globe icon), facility (teal, building icon), division (violet). Plain, no border.
- **New badge:** green tint, green text, 12 / 700.
- **Tag pill:** fixed width so every row matches: 164 px in tables, wider in the documents popover (sized in Build so a long "Site · Assessment" fits). Tag icon first, chevron last; long text ends in … with the full name on hover.
- **Report due cell:** calendar icon + date (always the same style) + a small second line. Late: calendar-x icon, red "N days late". Within 7 days: calendar-clock, amber "in N days". On track: grey "in N days". None: grey "Not set". No coloured fills.
- **Segmented control:** First survey / Resurvey / Follow-up, each with its icon; sits on the "Assessment N" header line.
- **Dashed add row:** full-width, 40–44 px, 1.5 px dashed `--graphite-300`, navy text with a plus.
- **File tiles:** email violet, PDF red, Word blue, text grey; unknown types grey.
- **Fields:** normal, not sure (amber), error (red border + one line under it).
- **Documents popover:** opened from a "Documents · N" button in the client card; rows of file tile, name + size, Tag pill, bin; a dashed "Add documents" row. No caption.
- **Reading status cell** (files being processed): words first, then the indicator at the right edge. Working = status words in 13 px `--graphite-700` + a 16 px spinner; Waiting = "Waiting" in `--graphite-600` (the words need 4.5:1 contrast) + a 16 px hollow circle in `--graphite-400`; Done = 16 px green filled tick only. **Spinner, circle and tick are the same size and sit in the same pixel column.**
- **Failed row:** neutral row and tile; under the file name, a red alert icon + the short error in red 600, then the fix in grey ("Can't read .zip files. Add PDF, Word, Outlook (.msg) or .eml files."); one grey bin (or retry) icon on the right. Only the icon and the short error are red.

## 7. Toasts

Use **Sonner** (`ask-sonner` skill), styled to this system and wrapped in our own `Toast` helper so callers don't depend on Sonner directly.

- Sonner's default behaviour: stacked (newest in front, older ones peek behind and spread on hover), swipe to dismiss, pauses on hover and while the tab is hidden, a loading toast that turns into success or error (`toast.promise`).
- Our styling: white card, radius 14, 1 px `--graphite-200`, the popover shadow, 14 px text with the title in `--graphite-900`; icon only coloured: green tick for success, red alert for errors; an icon-button close.
- Actions are small buttons inside the toast: "Undo" after archive/delete, "View" after create. Errors don't auto-close.
- Every confirmed action gets one (section 2).

## 8. Motion

Built with the `animate` skill, reviewed with `review-animations`. Motion only to give feedback, show where something came from, or bridge a change; under 300 ms for UI; never on things used many times a day. Animate `transform` and `opacity`; with reduced motion, fade only. Use the existing tokens in `motion.css` (`--ease-out`, `--ease-standard`, `--duration-fast` 120, `--duration-base` 180, `--duration-slow` 260) and add `--duration-scroll: 450ms` and `--ease-in-out: cubic-bezier(0.77, 0, 0.175, 1)`.

| Where | What | Timing |
|---|---|---|
| Create with missing fields | Smooth scroll to the first missing field (stops 96 px under the top bar), focus it, border turns red, error line fades in and rises 4 px. No shake. | scroll 450 ms ease-in-out; border 120 ms; line 180 ms ease-out |
| Reading progress bar | One bar for all files; grows with `scaleX`; a faint sweep while working; turns green when full | 400 ms ease-out per step |
| Found so far | Each item replaces its grey placeholder: placeholder fades out, item fades in and rises 4 px; "+ N more" number crossfades | 120 ms / 180 ms ease-out |
| Status words | Words crossfade as they rotate; spinner becomes the tick, drawn in | 120 ms; tick 260 ms |
| Reading done → form | Bar turns green, page blurs (0 → 6 px) behind a small card "All 6 documents read · Preparing the form for you now…"; after ~1.5 s the card and blur fade and the form cards fade-rise in, 40 ms apart, once | 180–260 ms ease-out |
| Documents popover | Scales from 0.97 and fades, origin at the button | 180 ms in, 120 ms out |
| Press feedback | Primary buttons scale to 0.97 while pressed | 120 ms |

Not animated: table rows, row hover actions, sidebar and tabs, filters and sorting, Report due cells.

## 9. How this system grows

- **Plan:** every UI story starts on a design canvas built from this system and the artifact above. New screens reuse these components; anything new is marked "NEW pattern" on the board.
- **Keep the approved boards with the story.** Each story's spec lives in its own folder with its boards beside it: `<specs>/sprint-<n>/<story>/<story>.md` and `<specs>/sprint-<n>/<story>/boards/v1/01-<Screen>.png …`. A later round of changes goes in `boards/v2/` and holds only the boards that changed, under the same numbers (e.g. `v2/05-Clients.png`, `v2/07-ClientDocs.png`); the latest version of each number wins. The spec's **Design references** section lists them, so Build and Check build from the images even after a handoff.
- **Approve:** Jesper approves boards on the canvas before Build.
- **Save:** when a story is committed, approved new patterns are added here (the section they belong to) and to the artifact, in the same story. Changes are versions, nothing here is final: improve a pattern by updating it here and noting why.
- **Changelog:**
  - v2.0 (4 Nov 2026, CP-23): first version from the CP-23 canvas.

## 10. When this file says nothing

Get everything from this file first. Only if it gives no guidance on something, use the old guide, `docs/design-system.md`. Never copy an old rule that this file already decides.
