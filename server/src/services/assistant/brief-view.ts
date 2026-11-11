// The brief as one viewer sees it (AS-06): the stored brief, less what they
// dismissed, with the messages built for them and the AI's wording attached.
// An admin (or anyone but the assigned engineer) gets stage and progress only
// (AC 11). Called by brief.service.ts and recheck.service.ts.
import type { IAssistantBrief } from '../../models/assistant-brief.model'
import { buildMessages } from './messages'
import type { BriefFacts } from './phrases'
import { ASSISTANT } from './settings'
import { dayOf } from './dates'
import type { AssistantBrief, BriefItem, Mood } from './types'

export type StoredBrief = IAssistantBrief & { _id: unknown }
export type Viewer = {
  role: 'engineer' | 'admin'
  name: string
  lastOpenedAt: Date | null
  dismissed: { itemId: string; fingerprint: string }[]
  exportAgain: string | null
}

// Messages that only restate where things stand. Right after a quick reply they
// would repeat MarshBot's own answer (#53, board 05), so they wait for the next visit.
const RESTATING = ['greeting', 'since', 'visit-set', 'done']

const open = (brief: StoredBrief) => brief.items.filter((i) => !i.resolvedAt)

/** Returns the open items this viewer sees: none for an admin, and none they dismissed while unchanged. */
export function visibleItems(brief: StoredBrief, viewer: Viewer): BriefItem[] {
  if (viewer.role === 'admin') return []
  return open(brief).filter(
    (i) => !viewer.dismissed.some((d) => d.itemId === i.id && d.fingerprint === i.fingerprint),
  )
}

// Concerned while anything is Fix now, thinking while coverage is checked,
// pleased just after something is done or when nothing is left, else idle.
function moodOf(brief: StoredBrief, now: Date): Mood {
  const items = open(brief)
  if (items.some((i) => i.weight === 'fix_now')) return 'concerned'
  if (brief.coverage.status === 'running') return 'thinking'
  const justDone = brief.items.some(
    (i) => i.resolvedAt && now.getTime() - Date.parse(i.resolvedAt) < ASSISTANT.pleasedMs,
  )
  if (justDone || brief.stage === 'exported' || !items.some((i) => i.weight === 'gap'))
    return 'pleased'
  return 'idle'
}

/** Returns the brief for this viewer, as GET .../assistant sends it. */
export function viewBrief(brief: StoredBrief, viewer: Viewer, now = new Date()): AssistantBrief {
  const f = brief.facts as BriefFacts
  const items = visibleItems(brief, viewer)
  const since = viewer.lastOpenedAt?.getTime() ?? Infinity
  const entered = f.stageDates[brief.stage]
  // The exchange just now is part of this visit (`sameVisitMs`, as recordOpen counts one).
  const lastSaid = Date.parse(brief.thread.at(-1)?.at ?? '')
  const justReplied = viewer.role === 'engineer' && now.getTime() - lastSaid < ASSISTANT.sameVisitMs
  const messages = buildMessages({
    role: viewer.role,
    viewerName: viewer.name,
    stage: brief.stage,
    facts: f,
    items,
    resolvedSince:
      viewer.role === 'admin'
        ? []
        : brief.items.filter(
            (i) =>
              i.resolvedAt &&
              Date.parse(i.resolvedAt) > since &&
              (i.weight === 'fix_now' || i.weight === 'gap'),
          ),
    movedSince: brief.stage !== 'setup' && !!entered && Date.parse(entered) > since,
    areas: brief.areas,
    sections: brief.sections,
    coverage: brief.coverage.status,
    exportAgain: viewer.exportAgain,
    today: dayOf(now),
    now,
  })
    .filter((m) => !justReplied || !RESTATING.includes(m.id.replace(/-[0-9a-f]{8}$/, '')))
    .map((m) => ({
      ...m,
      program: viewer.role === 'engineer' ? (brief.wording.programs[m.id] ?? null) : null,
    }))
  return {
    reference: brief.reference,
    viewer: viewer.role,
    engineerName: f.engineerName,
    stage: brief.stage,
    stageDates: f.stageDates,
    surveyStart: f.surveyStart,
    surveyEnd: f.surveyEnd,
    reportDue: f.reportDue,
    client: f.client,
    mood: moodOf(brief, now),
    items,
    areas: brief.areas,
    sections: brief.sections,
    export: f.exportFile && f.exportedAt ? { ...f.exportFile, exportedAt: f.exportedAt } : null,
    coverage: {
      status: brief.coverage.status,
      checkedAt: brief.coverage.checkedAt?.toISOString() ?? null,
    },
    thread: viewer.role === 'engineer' ? brief.thread : [],
    messages,
    lastOpenedAt: viewer.lastOpenedAt?.toISOString() ?? null,
    updatedAt: brief.updatedAt.toISOString(),
  }
}
