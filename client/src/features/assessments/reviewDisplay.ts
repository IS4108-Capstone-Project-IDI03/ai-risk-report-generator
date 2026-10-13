// How the review workspace (RV-01) reads a draft: citation numbers, claims,
// pages and the labels of each section's completion and review states, and
// of each finding's review decision and history entry (RV-02).
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
  SourcePassage,
} from './api'

type Draft = ReviewDraft

export const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`

export function describeChanges({ added, changed, removed }: ChangeCounts) {
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

type BadgeLook = { tone: string; icon: string; label: string }

// The same badges as the draft blocks (AIDraftBlock), so a review state reads
// the same in the rail and in the editor (AC6).
export const REVIEW_BADGE: Record<ReviewState, BadgeLook> = {
  not_drafted: { tone: 'neutral', icon: IconRegistry.status.notStarted.icon, label: 'Not drafted' },
  ai_draft: { tone: 'ai', icon: IconRegistry.status.draft.icon, label: 'AI draft' },
  in_review: { tone: 'info', icon: IconRegistry.status.underReview.icon, label: 'In review' },
  reviewed: { tone: 'low', icon: IconRegistry.status.finalised.icon, label: 'Reviewed' },
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

// What a review history entry records, in words.
export function historyLabel(action: ReviewAction, bulk = false) {
  return {
    accept: bulk ? 'Accepted by Bulk accept' : 'Accepted',
    edit: 'Edited',
    reject: 'Rejected',
    restore: 'Restored',
    regenerate: 'Regenerated',
    accept_replacement: 'Replacement accepted',
    discard_replacement: 'Replacement discarded',
  }[action]
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
