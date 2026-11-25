// The assessment's next step and gaps as one small read-only answer (AS-06, for the mobile
// app's Overview card): its stage, the three "At a glance" facts, the one next step, the
// open items most urgent first, and the checklist areas that need more. Built from the
// stored brief by pure functions, so it records nothing, starts no check and calls no AI.
// Called by brief.service.ts (getSummary) for GET .../assistant/summary. Types must match
// the mobile app's src/features/overview/api.ts.
import { dayOf } from './dates'
import { STAGE_LABELS, stageIndex } from './stage'
import { glanceOf } from './thread/view'
import type { ThreadBrief } from './thread/types'
import type { BriefItem, GlanceFact, ItemLink, ItemWeight, Stage } from './types'

export type SummaryItem = {
  id: string
  weight: Exclude<ItemWeight, 'info'>
  icon: string
  title: string
  detail: string | null
  link: ItemLink | null
}

export type AssistantSummary = {
  reference: string
  stage: Stage
  stageLabel: string
  // 0 (Setup) to 7 (Exported).
  stageIndex: number
  glance: GlanceFact[]
  next: { text: string; link: ItemLink | null; label: string | null }
  items: SummaryItem[]
  areas: { area: string; covered: number; total: number; link: ItemLink }[]
  updatedAt: string
}

// What each stage's own next move is, when nothing is open. A link to 'overview' means the move
// is made by answering MarshBot in the browser's chat, which the phone does not offer.
const STAGE_NEXT: Record<Stage, { text: string; link: ItemLink | null }> = {
  setup: {
    text: "Confirm the assessment's details, then move on to Prepare.",
    link: { tab: 'overview' },
  },
  prepare: { text: 'Read the checklist before the survey.', link: { tab: 'checklist' } },
  capture: {
    text: 'Capture your observations on site. When you are done, tell MarshBot you are ready to generate.',
    link: { tab: 'observations' },
  },
  ready_for_generation: { text: 'Start generating the report draft.', link: { tab: 'generate' } },
  generate: { text: 'Wait for the draft, then start your review.', link: { tab: 'generate' } },
  review: { text: "Review each section's findings.", link: { tab: 'review' } },
  ready_to_export: { text: 'Export the finished report.', link: { tab: 'export' } },
  exported: { text: 'The report is exported. Nothing more to do.', link: null },
}

const LABELS: Record<ItemLink['tab'], string> = {
  overview: 'Open Overview',
  checklist: 'Open checklist',
  observations: 'Open observations',
  generate: 'Open Generation',
  review: 'Open Review',
  export: 'Open Export',
}
const ORDER: Record<SummaryItem['weight'], number> = { fix_now: 0, gap: 1, reminder: 2 }

/**
 * Returns the summary for a stored brief. `dismissed` are this viewer's dismissals: an item
 * stays out while its fingerprint is unchanged (as the thread treats them, AS-06 AC6).
 */
export function summaryOf(
  brief: ThreadBrief,
  dismissed: { itemId: string; fingerprint: string }[],
  now: Date,
): AssistantSummary {
  const open = brief.items
    .filter(
      (i): i is BriefItem & { weight: SummaryItem['weight'] } =>
        !i.resolvedAt &&
        i.weight !== 'info' &&
        !dismissed.some((d) => d.itemId === i.id && d.fingerprint === i.fingerprint),
    )
    // Most urgent first; the order the checks raised them in settles ties.
    .sort((a, b) => ORDER[a.weight] - ORDER[b.weight])
  const first = open[0]
  const move = STAGE_NEXT[brief.stage]
  const link = first ? first.link : move.link
  return {
    reference: brief.reference,
    stage: brief.stage,
    stageLabel: STAGE_LABELS[brief.stage],
    stageIndex: stageIndex(brief.stage),
    glance: glanceOf(brief, dayOf(now)),
    next: {
      text: first ? first.fact : move.text,
      link,
      label: link ? LABELS[link.tab] : null,
    },
    items: open.map((i) => ({
      id: i.id,
      weight: i.weight,
      icon: i.icon,
      title: i.title,
      detail: i.detail,
      link: i.link,
    })),
    areas: brief.areas
      .filter((a) => a.thin)
      .map((a) => ({
        area: a.area,
        covered: a.covered,
        total: a.total,
        link: { tab: 'checklist' as const, params: { area: a.area } },
      })),
    updatedAt: brief.updatedAt.toISOString(),
  }
}
