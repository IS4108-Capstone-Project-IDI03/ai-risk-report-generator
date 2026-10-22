import type { ReactNode } from 'react'
// How the review workspace (RV-01) reads a draft: citation numbers, claims,
// pages and the labels of each section's completion and review states, and
// of each finding's review decision and history entry (RV-02), and of each
// entry of a section's version history (RV-06).
import { IconRegistry } from '../../design-system'
import type {
  ChangeCounts,
  FindingCounts,
  FindingState,
  ReviewAction,
  ReviewDraft,
  ReviewSection,
  ReviewState,
  ReviewStatement,
  SectionHistoryEntry,
  SourcePassage,
} from './api'
import { formatDayTime } from './format'

type Draft = ReviewDraft

export const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`

export function describeChanges({ added, changed, removed, figures }: ChangeCounts) {
  const kinds = (
    [
      [added, 'added'],
      [changed, 'changed'],
      [removed, 'removed'],
    ] as const
  ).filter(([n]) => n > 0)
  const words = kinds.map(([n, kind], i) =>
    i === 0 ? `${plural(n, 'observation')} ${kind}` : `${n} ${kind}`,
  )
  // Section 4 or 5's figures (GN-03), after any observation changes.
  if (figures) words.push(words.length ? 'the figures changed' : 'The figures changed')
  return words.length > 1
    ? `${words.slice(0, -1).join(', ')} and ${words.at(-1)}`
    : (words[0] ?? '')
}
// A finding still in the draft: rejected ones are out of it (RV-02 AC5).
export const inDraft = (statement: Pick<ReviewStatement, 'review'>) =>
  statement.review.state !== 'rejected'

// One number per cited source, in the order each is first cited across the
// whole section, so a number in the draft names the same source beside it.
// Rejected findings are out of the draft, so their citations are not numbered.
export function citationNumbers(draft: Draft): Map<string, number> {
  const numbers = new Map<string, number>()
  for (const sub of draft.subsections)
    for (const statement of sub.statements.filter(inDraft))
      for (const id of statement.citations) if (!numbers.has(id)) numbers.set(id, numbers.size + 1)
  return numbers
}

// A finding of the draft, keyed by where it is: `<subsection>.<statement>`,
// as the gateway names it. `number` counts the findings in the draft, so
// "finding 3" is the same in the editor and in the claims beside it.
export type Claim = ReviewStatement & {
  key: string
  number: number
  heading: string
}
// The findings in the draft, rejected ones left out.
export function claimsOf(draft: Draft): Claim[] {
  return draft.subsections
    .flatMap((sub, i) =>
      sub.statements.map((statement, j) => ({
        ...statement,
        key: `${i}.${j}`,
        heading: sub.heading,
      })),
    )
    .filter(inDraft)
    .map((claim, n) => ({ ...claim, number: n + 1 }))
}

// "12" or "12–13"; null when the page is not recorded.
export function pages({ pageStart, pageEnd }: Pick<SourcePassage, 'pageStart' | 'pageEnd'>) {
  if (pageStart == null) return null
  return pageEnd != null && pageEnd !== pageStart ? `${pageStart}–${pageEnd}` : String(pageStart)
}
// "p. 12" or "pp. 12–13", as a citation's locator.
export function pageLocator(passage: Pick<SourcePassage, 'pageStart' | 'pageEnd'>) {
  const range = pages(passage)
  return range && (range.includes('–') ? `pp. ${range}` : `p. ${range}`)
}

// "Partly written · 1 of 2 subsections" (AC5). Tables are not counted.
export function completionLabel({ state, written, total }: ReviewSection['completion']) {
  const label = { not_started: 'Not started', partial: 'Partly written', complete: 'Complete' }[
    state
  ]
  return total ? `${label} · ${written} of ${plural(total, 'subsection')}` : label
}

// The rail's status line. Until Section 4 or 5 is drafted it says how far the figures
// are entered (GN-03): the written-subsections count stays at nothing until then.
export function railStatus(section: Pick<ReviewSection, 'completion' | 'review' | 'figures'>) {
  const f = section.figures
  if (f && f.state !== 'none' && section.review.state === 'not_drafted') {
    if (f.state === 'all') return 'Figures entered · ready to draft'
    return f.total ? `Figures · ${f.entered} of ${f.total} entered` : 'Figures partly entered'
  }
  return completionLabel(section.completion)
}

type BadgeLook = { tone: string; icon: string; label: string }

// The same badges as the draft blocks (AIDraftBlock), so a review state reads
// the same in the rail and in the editor (AC6).
export const REVIEW_BADGE: Record<ReviewState, BadgeLook> = {
  not_drafted: { tone: 'neutral', icon: IconRegistry.status.notStarted.icon, label: 'Not drafted' },
  ai_draft: { tone: 'ai', icon: IconRegistry.status.draft.icon, label: 'AI draft' },
  in_review: { tone: 'info', icon: IconRegistry.status.underReview.icon, label: 'In review' },
  reviewed: { tone: 'low', icon: IconRegistry.status.finalised.icon, label: 'Reviewed' },
  // Changed or written in the document editor (RV-08): the words are the
  // engineer's. As AIDraftBlock's Edited by you.
  edited: {
    tone: 'info',
    icon: IconRegistry.status.edited.icon,
    label: IconRegistry.status.edited.label,
  },
  needs_review: {
    tone: 'moderate',
    icon: IconRegistry.status.flagged.icon,
    label: 'Needs review',
  },
}

// A finding's review decision (RV-02): AI violet until a person decides.
export const FINDING_BADGE: Record<FindingState, BadgeLook> = {
  pending: { tone: 'ai', icon: IconRegistry.status.draft.icon, label: 'Pending review' },
  accepted: { tone: 'low', icon: IconRegistry.action.accept, label: 'Accepted' },
  edited: { tone: 'info', icon: IconRegistry.action.edit, label: 'Edited' },
  rejected: { tone: 'neutral', icon: IconRegistry.action.reject, label: 'Rejected' },
}

// "2 accepted · 1 edited · 1 rejected · 3 pending", leaving out none.
export function findingCountsLabel(counts: FindingCounts) {
  return (['accepted', 'edited', 'rejected', 'pending'] as const)
    .map((state) => `${counts[state]} ${state}`)
    .join(' · ')
}

// What a review history entry records, in words. `inDocument`: made in the
// document editor (RV-08). `restoredFrom`: made by restoring an earlier
// version of the section (RV-06), which it names.
export function historyLabel(
  action: ReviewAction,
  bulk = false,
  inDocument = false,
  restoredFrom: string | null = null,
) {
  if (restoredFrom) {
    const what = restoredLabel(restoredFrom)
    if (action === 'edit') return `Edited by restoring ${what}`
    if (action === 'reject') return `Removed by restoring ${what}`
    if (action === 'restore') return `Brought back by restoring ${what}`
  }
  return {
    accept: bulk ? 'Accepted by Bulk accept' : 'Accepted',
    edit: inDocument ? 'Edited in the document' : 'Edited',
    reject: inDocument ? 'Removed in the document' : 'Rejected',
    restore: 'Restored',
    regenerate: 'Regenerated',
    accept_replacement: 'Replacement accepted',
    discard_replacement: 'Replacement discarded',
  }[action]
}

// An entry of a section's version history by name (RV-06): "Version 3" for a
// version saved in the document editor, else which AI draft it is.
export function versionLabel(entry: Pick<SectionHistoryEntry, 'kind' | 'version' | 'origin'>) {
  if (entry.kind === 'version') return `Version ${entry.version}`
  return entry.origin === 'replacement'
    ? 'Replacement draft'
    : entry.origin === 'redrafted'
      ? 'AI draft, drafted again'
      : 'AI draft'
}

// What a restore restored, in words: "version 3", or "the AI draft of 19 Oct
// 10:42" when the history it is in is at hand to say which.
export function restoredLabel(from: string, entries: readonly SectionHistoryEntry[] = []) {
  if (from.startsWith('version:')) return `version ${from.slice('version:'.length)}`
  const draft = entries.find((e) => e.id === from)
  if (!draft) return 'an AI draft'
  const kind = draft.origin === 'replacement' ? 'replacement draft' : 'AI draft'
  return `the ${kind} of ${formatDayTime(new Date(draft.at))}`
}

// How a history entry came to be the section's text, in words.
export function versionOrigin(
  entry: Pick<SectionHistoryEntry, 'origin' | 'restoredFrom' | 'model'>,
  entries: readonly SectionHistoryEntry[] = [],
) {
  const model = entry.model ?? 'the drafting model'
  return {
    saved: 'Saved in the document',
    restored: `Restored from ${restoredLabel(entry.restoredFrom ?? '', entries)}`,
    drafted: `Drafted by ${model}`,
    redrafted: `Drafted again by ${model}`,
    replacement: `Regenerated by ${model}, then accepted`,
  }[entry.origin]
}

export const severityLabel = (severity: string) =>
  severity.charAt(0).toUpperCase() + severity.slice(1)

// The first `max` characters of a passage, cut at a word, for a list.
export function excerpt(text: string, max = 180) {
  if (text.length <= max) return text
  const cut = text.slice(0, max)
  return `${cut.slice(0, cut.lastIndexOf(' ') > 0 ? cut.lastIndexOf(' ') : max)}…`
}

// What the engineer has picked in the workspace: a citation to open beside
// the draft, and the statement (a Claim key) it belongs to.
export type ReviewFocus = { citation: string | null; statement: string | null }

// A citation in words, for its button's accessible name: "FM Global Data
// Sheet 1-21, p. 12" or "Site observation, Bay 3, Ground".
export function describeCitation(section: ReviewSection, id: string): string {
  const passage = section.sources[id]
  if (passage)
    return [passage.document?.title ?? 'Document not found', pageLocator(passage)]
      .filter(Boolean)
      .join(', ')
  const observation = id.startsWith('O:')
    ? section.observations.find((o) => o.id === id.slice(2))
    : undefined
  if (observation) return ['Site observation', observation.location].filter(Boolean).join(', ')
  return 'Source not found'
}

// The DOM id of a statement in the draft editor, so a claim can scroll to it.
export const statementId = (sectionId: string, claim: string) =>
  `rv-statement-${sectionId}-${claim.replace('.', '-')}`

// Section 3's OFI categories in Marsh's report order (template pp. 8-9). Shared by
// Generation's OFI list and Review's (OfiSuggestions, OfiReviewPanel).
export const OFI_CATEGORIES = ['Management Programs', 'Physical Protection', 'Other']

// Section 6's programs and maturity scale (GN-11), as Marsh's template has them
// (pp. 18-19). Keep in step with rag-service generation/sections.json, section "6".
export const MANAGEMENT_PROGRAMS = [
  'Building Maintenance',
  'Electrical Maintenance',
  'Equipment Maintenance',
  'Fire Protection Impairment Management',
  'Fire Protection System Maintenance & Testing',
  'Hazardous Materials Handling',
  'Housekeeping',
  'Hot Work Permit System',
  'Management of Change',
  'Emergency Response Planning',
  'Self-Inspections',
  'Smoking Controls',
  'Contractor Management',
  'Business Continuity Planning',
  'Environmental, Social & Governance (ESG)',
]
// Lowest first. Each rank's colour is in review.css (.rv-rank-<rank>), as in Marsh's legend.
export const MATURITY_SCALE = [
  { rank: 'Undeveloped', definition: 'Informal actions with little or no systematic procedures.' },
  {
    rank: 'Formalized',
    definition: 'Programs and procedures are established. Full familiarity is uncertain.',
  },
  {
    rank: 'Established',
    definition:
      'Programs and procedures are communicated throughout the organization. Orientation is ongoing.',
  },
  {
    rank: 'Embedded',
    definition:
      'Ownership is established at most or all organizational levels. Training and some exercises is conducted.',
  },
  {
    rank: 'Optimized',
    definition:
      'Full ownership with active program maintenance, testing, exercising and continuous improvement.',
  },
]
const RANKS = new Set(MATURITY_SCALE.map((m) => m.rank))

// A Management Programs row, "<Program>: <Rank>. <comment>", as the draft writes it, and
// as rag-service orchestrator._PROGRAM_ROW reads it (rank ends at a word boundary).
// `rank` is null when the text names no rank of the five (an engineer's edit may not).
export function programRow(text: string) {
  const row = text.match(/^([^:]+):\s*(\w+)\b[.,;:]?\s*(.*)$/s)
  if (!row) return { program: null, rank: null, comment: text }
  const [, program, word, comment] = row
  return RANKS.has(word)
    ? { program: program.trim(), rank: word, comment }
    : // Not a rank: the whole text after the colon, as written.
      { program: program.trim(), rank: null, comment: text.slice(text.indexOf(':') + 1).trim() }
}

// A draft's Management Programs rows sorted into Section 6's table, for MaturityTable.
// A row naming none of the 15 programs, or a second row for one, goes to `unplaced`,
// shown under the table: never dropped, so a flagged or decidable row stays in view.
export function maturityEntries<T>(
  rows: T[],
  textOf: (row: T) => string,
  render: (row: T, comment: string) => ReactNode,
) {
  const entries = new Map<string, { rank: string | null; comment: ReactNode }>()
  const unplaced: ReactNode[] = []
  const programs = new Set(MANAGEMENT_PROGRAMS)
  for (const row of rows) {
    const { program, rank, comment } = programRow(textOf(row))
    if (program && programs.has(program) && !entries.has(program))
      entries.set(program, { rank, comment: render(row, comment) })
    else unplaced.push(render(row, textOf(row)))
  }
  return { entries, unplaced }
}

// How many of Marsh's 12 report sections are drafted, for every "N of 12 sections
// drafted" (Review rail, Generation, Overview). Section 1 is always ready: it is filled
// in from the assessment's details. Section 2 needs its draft, Section 3 an accepted
// OFI, and 4-12 their own drafts (4 and 5 can be drafted only once their figures
// are entered; GN-03).
export const REPORT_SECTIONS = 12
export function reportProgress({
  summaryDrafted,
  ofisAccepted,
  sectionsDrafted,
}: {
  summaryDrafted: boolean
  ofisAccepted: number
  // Drafted sections among 4-12.
  sectionsDrafted: number
}) {
  const done = 1 + Number(summaryDrafted) + Number(ofisAccepted > 0) + sectionsDrafted
  return { done, total: REPORT_SECTIONS, percent: Math.round((done / REPORT_SECTIONS) * 100) }
}
