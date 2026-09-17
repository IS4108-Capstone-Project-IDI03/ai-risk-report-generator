# Marsh AI Risk Report design system

This is the app's UI foundation, migrated from the supplied prototype into normal React/TypeScript modules. It is a design reference, not a statement of verified Marsh brand approval. The engineer reviews evidence, edits AI-generated prose, resolves uncertainties, and controls finalisation.

## Source of truth and dependencies

- Shared tokens and components: `client/src/design-system/`.
- Screens and sample data: `client/src/features/auth/` and `client/src/features/assessments/`.
- Future implementation rules: [UI conventions](areas/ui.md).
- IBM Plex Sans, Serif and Mono remain Google Fonts substitutes. System fallback stacks are retained. No licensed brand font files were supplied.
- Marsh is rendered as plain text. The export described logo assets that were absent from the supplied folder; this migration does not invent or reference missing assets.
- Lucide masks remain pinned to `lucide-static@0.451.0` on unpkg. Fonts and icons need external network access; the app's demo behaviour does not need a backend.
- Token CSS and the detailed workflow take precedence over contradictory prose in the old guide. Palette, spacing, typography, elevation and motion token values are unchanged.

## Design principles

1. **Provenance before polish.** Nothing generated appears without a route to its source. The violet AI hue exists for this and nothing else.
2. **The engineer signs it.** AI states are visibly provisional; once a human edits or accepts a passage, the chrome goes neutral — the words are now theirs.
3. **Dense, not cramped.** Control heights of 32/40/46px, 6–10px table rows, 16px gutters. Report prose gets room: serif, 15/24, 68ch.
4. **Quiet by default.** Colour carries meaning only. A screen with no problems has almost no colour in it.

## Content fundamentals

**Voice: a careful colleague, writing for the record.** Short declaratives. No marketing register, no encouragement, no personality.

- **Person.** Address the engineer as _you_ ("Your sign-off is recorded"). The system is _it_, never _I_ — it does not say "I found 4 sources", it says "Drafted from 4 sources". Never attribute judgement to the AI; it drafts, cites and flags. It does not "think", "believe" or "recommend" — recommendations belong to the engineer.
- **Casing.** Sentence case everywhere: buttons, headings, table headers, menu items. The only uppercase is the 11px structural label (`EVIDENCE`, `SECTIONS`, `STATUS`), letterspaced 0.08em.
- **Buttons are verbs.** "Generate draft", "Accept", "Resolve", "Finalise and issue". Never "OK", "Submit", or "Click here".
- **Numbers are exact and unrounded.** "24 evidence items", "6 of 6 sections reviewed", "£1.4m estimated BI exposure". Confidence is never a percentage — the platform does not claim that precision, so it is High / Medium / Low with a three-bar meter.
- **Errors state cause, then next step.** "Standards library sync failed at 09:12. Retry, or continue with the cached copy from 08 Apr." Never "Oops" or "Something went wrong".
- **Empty states state the cause, then the trigger.** "No reports assigned — reports appear here once a survey is scheduled to you."
- **Dates and clauses are literal.** `11 Apr 09:22`, `FM Global 2-0 §2.4.1`, `RPT-2026-0411` — always in mono.
- **Quotations are verbatim.** Evidence excerpts are quoted exactly, never paraphrased, and sit behind a 2px left rule.
- **No emoji. Ever.** Not in UI, not in notifications, not in exported reports.

Sample microcopy, in register:

> First draft generated 11 Apr, 14:02. Drafted from 12 site observations, 4 past reports and 8 external standards. Every passage below is attributed — review before sign-off.

> 3 findings unresolved. Sections with open uncertainties cannot be finalised.

## Visual foundations

**Colour.** Three families and one signal hue.

- _Graphite_ (12 steps, `--graphite-0…900`) — cool, low-chroma neutrals; text, surfaces and borders. Page is `#f7f9fc`, cards are white.
- _Marsh navy_ (`--marsh-navy #000f47`, from the official logo) — app sidebar and any surface carrying the wordmark.
- _Ink blue_ (`--ink-50…800`) — the primary action colour (`--ink-600 #2c5488`), link colour and focus ring.
- _Oxblood_ (`--oxblood-600 #9e3e3b`) — accent. Used sparingly: the 2px rule under a report title, high-severity emphasis, print marks. Never a button fill except `danger`.
- The palette works in three tiers. **Text** (`--status-*-fg`, the 600 steps) is the darkest and must hold 4.5:1 on its own background. **Fills** (the 50 and 100 steps) carry the saturation — badge, callout and chip grounds. **Glyphs** (`--icon-draft`, `--icon-review`, `--icon-signoff`, `--icon-final`) are the brightest tier, chosen for vividness at 12–18px and never used for text. Brightening the system means lifting fills and glyphs, not text.
- _Severity_ is a fixed four-step scale (critical / high / moderate / low) with paired fg+bg tokens. These colours are semantic and are never used decoratively.
- _AI violet_ (`--ai-fg #6258a3`) appears only where content is machine-generated. If violet is on screen, something needs a human's eyes.

**Type.** IBM Plex Sans is the interface face, IBM Plex Serif marks report prose, and IBM Plex Mono marks identifiers, dates, clauses and figures. The actual token ladder is eyebrow 12/16, page title 25/32 bold, meta 14/20, heading 3 at 17/26, body 15/24, caption 13/19. Display is 35/41 semibold; metrics are 30/34 (large) and 20/26 (medium), both bold. Prose is capped at 68ch.

**Preserved screen exceptions.** Sign-in uses a 32/38 title, 19/26 wordmark and a 448px card. Workflow titles scale from 23–32px; card headings use 19/28; some structural labels use 11px or 13px. These are deliberate matches to the supplied screens, not changes to the shared type tokens. The workflow has some 36px navigation buttons and 44px severity selectors; new controls should use the shared size variants. Modal blur is 2px. Cards and focus styling follow the actual CSS when the old guide differs.

**Control heights are a closed set.** Every interactive control — Button, IconButton, Input, Select — takes its height from `--control-height-sm` (32px), `--control-height-md` (40px, the default) or `--control-height-lg` (46px). Never set a height on a control directly. **Controls sitting in the same row share one step**: a filter toolbar of inputs and selects at `md` takes `md` buttons, not `sm`. `sm` is for controls inside a denser container — card headers, table rows, the evidence panel — where the whole cluster steps down together. **Chips are the one documented exception**: Badge and Tag are labels, not typed inputs, so they use `--chip-height-sm` (24px, Badge) and `--chip-height-md` (32px, Tag) — Tag matches the `sm` control step so a filter row still aligns. Chips never wrap; a label too long for its row is shortened, not wrapped.

**Spacing & layout.** A 2/4/6/8/12/16/20/24/32/40/48/64 scale. Fixed chrome: 264px sidebar, 56px top bar, 52px toolbar, 344px right inspector; content between them scrolls independently. Three-pane layouts (rail · draft · evidence) are the platform's signature arrangement.

**Corners.** Tight: 2/3/5/8px, pill only for dots, toggles and avatars. 8px is the largest radius in the system — nothing is soft or app-store-rounded.

**Cards.** White, 1px `--border-default`, 8px radius, `--shadow-sm` (a 1px hairline, not a glow). Optional header with a 1px subtle divider and a sunken footer. AI cards swap the border and header tint to violet; nothing else changes.

**Shadows.** Four steps only — `sm` cards, `md` popovers, `lg` toasts and drawers, `overlay` modals. All are cool-black at low alpha, tightly offset. No coloured shadows, no glows.

**Borders over shadows.** Structure is drawn with 1px lines, not elevation. Elevation is reserved for things that float above the page.

**Backgrounds.** Flat colour only. No gradients, no photography, no illustration, no texture, no patterns. The one "image" in the product is evidence — site photographs, shown in their own frames at their real aspect ratio, never cropped into decoration and never tinted.

**Transparency & blur.** Almost never. Two exceptions: the modal scrim (ink at 44% with a 2px blur, so the locked-out content stays legible as context) and the 10%-white active fill in the dark sidebar.

**Motion.** 80ms hover tints, 120ms control states, 180ms panels and tabs, 260ms progress and drawers, all on `cubic-bezier(.2,0,.2,1)`. Fades and width/position changes only — no bounce, no spring, no scale-in, no skeleton shimmer beyond a plain opacity pulse. Motion confirms that something happened; it never performs.

**Hover.** Surfaces tint one step (`--surface-hover`), borders go one step stronger, icon colour lifts from muted to body. Never a lift, scale or shadow change.
**Press.** Fills darken one step (`--action-primary-active`); nothing shrinks or translates.
**Focus.** 1px `--border-focus` plus a 3px `--focus-ring` at 32% ink. Always visible, never suppressed.
**Selected.** `--surface-selected` (ink-50) fill with a 2px ink left rule in rails, or a 2px underline in tabs.
**Disabled.** 45% opacity and a sunken fill; never a greyed-out colour swap.

**Data display.** Table headers are 11px uppercase muted on a sunken row; body rows 10px/12px padding (6px dense); numeric and identifier columns right-align in mono. Progress is a 4px determinate bar — indeterminate spinners appear only inside a loading button.

## Iconography

- **Lucide**, linked from CDN (`lucide-static@0.451.0`), rendered through the `Icon` component as a CSS mask so every glyph inherits `currentColor`. 1.5–2px stroke, rounded caps — it matches the system's line-drawn structure.
- **This is a flagged substitution.** No icon set was supplied. If Marsh has a licensed or in-house set, add the SVGs as client assets and repoint `Icon.tsx` at them; the API doesn't change.
- **Sizes:** 12–13px inside badges, 14px in dense tables and rails, 15–16px default and in nav, 18px for standalone marks. Never larger — this system has no hero icons.
- **No hand-drawn SVG.** If a glyph is missing, pick the nearest Lucide name rather than authoring a path.
- **No emoji, ever.** No Unicode glyphs used as icons either — the only non-Lucide marks are the superscript reference numerals in report prose (mono, violet) and the `§` in clause references.
- **Report status glyphs** are fixed — the same glyph and colour represent a state everywhere it appears: `sparkles` violet = Draft (AI-generated, unreviewed) · `user-round-search` ink = In review · `stamp` amber = Awaiting sign-off · `circle-check` green = Finalised. Status text always accompanies the glyph; the icon never stands alone.
- **The vocabulary is a registry, not a habit.** `components/core/IconRegistry.tsx` names every glyph the platform uses, grouped by meaning: `action` (button verbs), `status` (report lifecycle — glyph + colour + label), `severity` (risk scale), `evidence` (provenance kinds), `category` (observation disciplines), `object` (nouns in nav and headers). Screens reference semantic keys — `IconRegistry.action.generate`, or `IconRegistry.resolve("action.generate")` for a dotted path — never raw Lucide names, so replacing the icon set is a one-file change. Adding a glyph means adding it to the registry first.
- **Recurring glyphs:** `sparkles` AI-generated · `link` evidence · `book-marked` external standard · `file-text` internal report · `camera`/`image` site observation · `triangle-alert` uncertainty · `shield-alert` finding · `stamp` finalise/sign-off · `inbox` queue · `history` version history.

## Migrated inventory

All 29 shared exports have a typed source module under `design-system/components` and a public export in `design-system/index.ts`.

| Group      | Exports                                                     |
| ---------- | ----------------------------------------------------------- |
| Core       | Icon, IconRegistry, Button, IconButton                      |
| Forms      | Input, Textarea, Select, Checkbox, Radio, Switch            |
| Display    | Card, Badge, Tag, Table, StatusIcon, PageHeader, MetricStat |
| Navigation | SideNav, Tabs, Breadcrumb                                   |
| Feedback   | Callout, Dialog, Toast, EmptyState, ProgressBar, Tooltip    |
| AI         | AIDraftBlock, EvidenceCitation, ConfidenceIndicator         |

The seven token stylesheets are fonts, colors, typography, spacing, elevation, motion and base. `styles.css` imports them and supplies shared accessibility/layout styles.

| Prototype content                                          | Migrated destination / treatment                                               |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------ |
| Sign in; request access                                    | Auth feature, with demo entry to dashboard                                     |
| Engineer dashboard                                         | Dashboard screen with sample records and filters                               |
| Create assessment                                          | CreateAssessment screen                                                        |
| Site observation                                           | SiteObservation screen, simulated voice/photo capture                          |
| Assessment overview                                        | Overview screen                                                                |
| Observation list                                           | Observations screen                                                            |
| Report generation                                          | Generation screen with simulated progress and retry states                     |
| Draft review and evidence                                  | Review screen and EvidencePanel                                                |
| Validation and export                                      | ValidationExport screen with checklist and simulated export                    |
| Older bundled queue/editor/finalisation demos              | Consolidated into the detailed workflow; no duplicate runtime/screens retained |
| Pin and numbered annotations                               | Design rationale below; annotation-only badge omitted from product UI          |
| Export runtime, bundle, manifest, lint metadata, thumbnail | Replaced by typed modules and this inventory; removed                          |

## Runtime behaviour

Sign-in accepts a syntactically valid email and any non-empty sample password. It grants access only to this in-memory demo. Passwords are never stored or sent. Request access validates the displayed fields and reports a simulation; SSO and password reset explicitly report that they are disconnected. The remember checkbox does not persist a session. Sign-out and refresh discard all demo changes.

The workflow fills the viewport without a demo banner. The mobile drawer has no additional heading bar; its close button sits on the navy surface. Below 1080px, tables and the review workspace stack; below 760px, navigation becomes a modal drawer. Desktop chrome retains the 264px sidebar and 344px evidence inspector. There is no URL routing or deep-link persistence in this pass.

Only the sample Tilbury assessment has a complete workspace. Other sample records, history and later observation pages explicitly explain their demo limits. New assessments appear in memory. Voice produces a sample transcript and photos add placeholders. Generation uses timers. Review decisions and prose edits update the same state used by validation. Export requires all included sections reviewed and all review items resolved, then opens a simulated confirmation; it generates no file, sends nothing and records no real sign-off.

Native form inputs provide keyboard and label activation. Tabs support arrow/Home/End keys. Native modal dialogs provide focus containment and Escape handling; focus returns to the opener. Reduced motion is respected globally.

## Using the system

```tsx
import { Button, Card, PageHeader } from "../../design-system";

export function ExampleScreen() {
  return (
    <Card>
      <PageHeader title="Assessment" />
      <Button
        variant="primary"
        onClick={() => {
          /* feature action */
        }}
      >
        Generate draft
      </Button>
    </Card>
  );
}
```

Global styles import the design-system stylesheet once. New screens reuse semantic tokens and shared components; sample data and workflow decisions stay in their feature folder.

## Workflow design annotations

These notes preserve the original design intent. References to recording, attachments, sign-off and export describe the intended product; the current UI simulates those services.

### Assessments dashboard

The engineer's home. Every assessment assigned to them, with the work outstanding on each.

- **1. Two entry points, one primary.** New assessment is the only primary button on the screen. Site observation sits beside it as a secondary action because engineers often open the phone companion before any desk work exists.
- **2. Filters narrow, they do not hide.** Search matches site, client and report ID as you type. The result count next to the filters always states what is being shown, so a filtered list is never mistaken for an empty queue.
- **22. Outstanding items are the sort signal.** The last column counts unresolved uncertainties rather than progress. It is the number that decides which assessment an engineer opens next. Click any row to open RPT-2026-0411.

### Create assessment

Four decisions: where, what kind, against which standards, and who signs it.

- **3. Site before everything.** Site and client are the only required fields. Everything else can be completed after the visit, so an engineer standing in a car park can open an assessment in seconds.
- **4. Standards are a closed drafting set.** Only clauses from the selected standards can be cited in the generated report. Choosing the set here is what makes every later citation traceable to a document the engineer approved.
- **5. The first engineer is the lead.** The lead engineer badge follows the first person selected. Sign-off is recorded against that name at export.
- **6. Validation states cause, then next step.** Submitting with an empty site or client shows one callout naming both fields and colours their borders, rather than a modal. Correct them and create again.

### Site observation

Captured on site or at the desk. Everything here becomes citable evidence.

- **8. One observation, three input modes.** Note, voice and photo are modes of the same record, not three separate records. Whichever mode you use, the observation detail below is the same, so nothing reaches the report uncategorised.
- **23. Voice is transcribed, never interpreted.** Stopping a recording produces a verbatim transcript in violet AI chrome. Edit as text note converts it into your own words and the violet chrome disappears — the words are then yours.
- **24. Metadata is mandatory, not optional.** Location, risk category and severity are what let a generated passage cite this observation. Severity uses the same four-step scale as the report, so field grading and report grading never diverge.
- **25. Targets sized for gloves.** Every control on the phone is at least 44px tall, and Save observation is a full-width large button pinned above the home indicator.

### Report generation

Section-by-section drafting, with every failure visible while it happens.

- **7. Tabs are the assessment, not the app.** Generation, review and export are stages of one report, so they are tabs inside the assessment rather than separate destinations in the sidebar.
- **9. Stopping is always available.** Stop generation asks for confirmation and names what will be kept. Sections already drafted are never discarded — drafting resumes from the first section that did not complete.
- **10. Insufficient evidence is not an error.** The section states what is missing and offers the two real routes out: capture the evidence on the phone, or write the section yourself. It never drafts an unsupported passage to fill the gap.
- **11. Failures name cause and time.** A failed section reports the cause and the timestamp, then offers retry or the cached standards copy. The engineer chooses whether stale standards are acceptable.

### Report review workspace

Sections left, draft centre, provenance right. The engineer signs what is in the middle.

- **12. The rail is the review ledger.** Each section carries its own review glyph — AI draft, edited by you, accepted, needs review — and the bar above counts how many are done. Selecting a section changes the centre and the right pane together.
- **13. Reject removes in one click.** Rejecting drops the section out of the report immediately; the rail marks it Removed and the centre offers Restore this section. Accept and Edit sit in the passage footer, where the words are.
- **14. Unsupported claims are marked, not deleted.** A passage with no source behind it keeps an amber underline and an inline flag until it is resolved. It cannot be accepted away — the resolution happens in the right pane.
- **15. Conflicting sources ask, they do not choose.** Where two sources disagree the draft shows the conflict and names both figures in the evidence list. The engineer picks which one stands, and the sentence rewrites.
- **16. Open items sit with the evidence.** Resolution options are in the right pane, beside the sources they concern, rather than in a separate task list. Resolving one updates the draft, the rail and the export checklist at once.
- **17. Citations are two-way.** Superscript markers in the draft are clickable; the matching source highlights in the evidence list. Every generated sentence has a route to what it came from.
- **18. Original observations stay verbatim.** Beneath the sources sit the engineer's own field records — photograph, voice note, written note — quoted exactly as captured, never paraphrased by the system.

### Validation and export

The checks that stand between a draft and an issued report.

- **19. Blocked export explains itself.** The callout names the number of failing checks and the export button is disabled rather than hidden, so the engineer can see what the button will do once the checks pass.
- **20. Every outstanding item is one click from its section.** Go to section switches to the review tab and selects that section, with its open item already showing in the right pane.
- **21. Format and content are separate decisions.** DOCX for client review cycles, PDF for issue. Citations and the photograph appendix are independent of format, so a client-facing DOCX can carry the full evidence trail.
- **26. Resolve everything to unblock.** Accept or edit all seven sections and resolve the three review items, and the callout turns to Ready to export with the button enabled.
