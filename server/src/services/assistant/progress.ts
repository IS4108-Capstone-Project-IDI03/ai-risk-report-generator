// The two progress pictures on MarshBot's brief (AS-06): the checklist by area
// (health bars, board 01) and the report outline (board 02, and the admin's
// lanes, board 07). Called by context.ts and recheck.service.ts.
import type { ChecklistDto } from '../checklist.service'
import { SUMMARISED_SECTIONS } from '../summary.service'
import type { CheckContext } from './context'
import { isoDay } from './dates'
import { ASSISTANT } from './settings'
import type { AreaHealth, SectionState } from './types'

/**
 * Returns each checklist area's answered count, worst first (lowest share
 * answered, then checklist order). Thin comes from the rules only: under
 * `thinShare` answered. The coverage check's results get their own message
 * (checks/coverage-gaps.ts); without that split, it turned nearly-done areas amber (#52).
 */
export function areaHealth(checklist: ChecklistDto | null): AreaHealth[] {
  if (!checklist) return []
  const active = checklist.items.filter((i) => i.status === 'active')
  const areas = checklist.areas.flatMap(({ id, title }) => {
    const items = active.filter((i) => i.area === id)
    if (!items.length) return []
    const covered = items.filter((i) => i.check).length
    return [
      {
        area: title,
        total: items.length,
        covered,
        thin: covered / items.length < ASSISTANT.thinShare,
        open: items.filter((i) => !i.check).map((i) => ({ id: i.id, text: i.text })),
      },
    ]
  })
  // A stable sort keeps checklist order between equal shares.
  return areas.sort((a, b) => a.covered / a.total - b.covered / b.total)
}

// The report parts MarshBot follows: the Executive Summary (2) and Sections 3 to 12.
export const PARTS = ['2', ...SUMMARISED_SECTIONS.map((s) => s.id)]

/** Returns a report part's title: Executive Summary for part 2, else its section's title. */
export function partTitle(id: string): string {
  if (id === '2') return 'Executive Summary'
  return SUMMARISED_SECTIONS.find((s) => s.id === id)?.title ?? `Section ${id}`
}

const at = (date: Date | string | null | undefined) => (date ? isoDay(new Date(date)) : null)

/**
 * Returns Sections 2 to 12 with one state each: reviewed (with its last
 * decision's date), decisions to make, or not started (with its drafted date
 * once drafted, as board 07 shows it); empty before anything is drafted.
 */
export function sectionStates(ctx: CheckContext): SectionState[] {
  if (!ctx.draftedParts.length) return []
  const comments = (id: string) =>
    ctx.threads.filter((t) => t.status === 'open' && t.anchor.sectionId === id).length
  const summary = ctx.summary?.executiveSummary
  const ofis = ctx.ofis
  const parts: SectionState[] = [
    {
      sectionId: '2',
      title: 'Executive Summary',
      // The summary has no findings to decide: drafted and up to date is reviewed.
      state: !summary?.draft
        ? 'not_started'
        : summary.staleSections.length
          ? 'decisions'
          : 'reviewed',
      date: at(summary?.draft?.createdAt),
      openComments: comments('2'),
    },
    {
      sectionId: '3',
      title: SUMMARISED_SECTIONS[0].title,
      state: ofis?.accepted.length ? 'reviewed' : 'not_started',
      date: null,
      openComments: comments('3'),
    },
  ]
  for (const { id, title } of SUMMARISED_SECTIONS.slice(1)) {
    const s = ctx.workspace?.sections.find((w) => w.id === id)
    const open = s
      ? s.findings.pending +
        s.review.unsupportedStatements +
        s.review.withdrawnSources +
        s.review.changesSinceDraft +
        (s.replacement ? 1 : 0)
      : 0
    const decided = s ? s.findings.total - s.findings.pending : 0
    const state: SectionState['state'] =
      !s || s.completion.state === 'not_started'
        ? 'not_started'
        : open === 0
          ? 'reviewed'
          : decided === 0 && s.findings.total > 0 && open === s.findings.pending
            ? 'not_started'
            : 'decisions'
    parts.push({
      sectionId: id,
      title,
      state,
      date:
        state === 'reviewed'
          ? at(s?.history[0]?.at ?? s?.draft?.createdAt)
          : at(s?.draft?.createdAt),
      openComments: comments(id),
    })
  }
  return parts
}
