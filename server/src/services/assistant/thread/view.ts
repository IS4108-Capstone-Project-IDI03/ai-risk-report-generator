// The conversation as the Overview shows it (AS-06 round 5): the saved turns
// with this session's cards rebuilt from the brief now, the choices offered,
// and the rail's status pill, mood and "At a glance". An admin gets one turn
// built on the fly and nothing saved (AC 11). Called by thread.service.ts.
import type { StoredSession, StoredTurn } from '../../../models/assistant-thread.model'
import { dayOf, daysBetween, longDay, shortDay } from '../dates'
import { firstName } from '../phrases'
import { STAGE_LABELS } from '../stage'
import {
  STAGES,
  type AssistantThread,
  type GlanceFact,
  type Mood,
  type Session,
  type Stage,
  type Turn,
} from '../types'
import { offeredReplies, rebuilt } from './advance'
import { count, pill } from './cards'
import { topicCtx } from './session'
import { tasksLeft } from './tasks'
import { answered, NEXT_VISIT } from './topics-capture'
import { DEFS } from './topics'
import type { Status, ThreadBrief, ThreadState, ThreadViewer, TopicCtx } from './types'

// The browser's turn: what is only kept for the engine is left out.
const shown = ({ items: _items, order: _order, ...turn }: StoredTurn): Turn => turn
const sessionOf = (s: StoredSession, turns: Turn[]): Session => ({
  id: s.id,
  startedAt: s.startedAt,
  stage: s.stage,
  turns,
})

/** Returns the rail's three facts for the stage (the report date amber within 7 days, red when overdue). */
export function glanceOf(brief: ThreadBrief, today: string): GlanceFact[] {
  const f = brief.facts
  const due = f.reportDue
  const left = due ? daysBetween(today, due) : null
  const dueFact: GlanceFact = {
    icon: 'calendar',
    label: 'Report Due',
    value: due ? shortDay(due) : 'Not set',
    tone:
      brief.stage === 'exported' || left === null
        ? due
          ? 'normal'
          : 'amber'
        : left < 0
          ? 'red'
          : left <= 7
            ? 'amber'
            : 'normal',
  }
  const fact = (
    icon: string,
    label: string,
    value: string,
    tone: GlanceFact['tone'] = 'normal',
  ) => ({ icon, label, value, tone })
  const { covered, total } = answered(brief.areas)
  const observations = fact('camera', 'Observations', String(f.observations))
  const checklist = fact(
    'list-checks',
    'Checklist',
    total ? `${covered} of ${total}` : 'Not made',
    total && covered === total ? 'green' : total ? 'normal' : 'amber',
  )
  const reviewed = brief.sections.filter((s) => s.state === 'reviewed').length
  const sections = brief.sections.length || 11
  switch (brief.stage) {
    case 'setup':
      return [
        fact(
          'calendar',
          'Survey',
          f.surveyStart ? shortDay(f.surveyStart) : 'Not set',
          f.surveyStart ? 'normal' : 'amber',
        ),
        dueFact,
        fact('files', 'Documents', String(f.documents ?? 0)),
      ]
    case 'prepare':
      return [
        fact(
          'list-checks',
          'Checklist',
          total ? count(total, 'item') : 'Not made',
          total ? 'normal' : 'amber',
        ),
        fact('files', 'Documents', String(f.documents ?? 0)),
        dueFact,
      ]
    case 'capture':
    case 'ready_for_generation':
      return [observations, checklist, dueFact]
    case 'generate':
      return [
        fact(
          'sparkles',
          'Drafted',
          `${f.draftedParts} of 11`,
          f.draftedParts === 11 ? 'green' : 'normal',
        ),
        observations,
        dueFact,
      ]
    case 'exported': {
      const stale = brief.items.find((i) => i.id === 'exported.stale' && !i.resolvedAt)
      const changed = stale ? String(stale.facts.changed).split(',').filter(Boolean).length : 0
      return [
        fact('stamp', 'Exported', f.exportDay ? shortDay(f.exportDay) : 'Yes'),
        fact(
          'pen',
          'Changed Since',
          changed ? count(changed, 'section') : 'Nothing',
          changed ? 'amber' : 'normal',
        ),
        dueFact,
      ]
    }
    default:
      return [
        fact(
          'user-search',
          'Reviewed',
          `${reviewed} of ${sections}`,
          reviewed === sections ? 'green' : 'normal',
        ),
        fact(
          'message-square',
          'Open Comments',
          String(brief.sections.reduce((n, s) => n + s.openComments, 0)),
        ),
        dueFact,
      ]
  }
}

// The pill under MarshBot's name: tasks to fix first, then what the newest turn waits on.
function statusOf(
  session: StoredSession,
  turns: StoredTurn[],
  ctx: TopicCtx,
  thinking: boolean,
): Status {
  const tasks = [...new Set(turns.filter((t) => t.topic === 'todo').flatMap((t) => t.items ?? []))]
  const left = tasksLeft(ctx, tasks)
  if (left) return { text: `${count(left, 'thing')} to fix`, tone: 'red', icon: 'circle-alert' }
  const last = turns.filter((t) => t.who === 'bot').at(-1)
  if (last?.topic === 'ack') {
    const done = [...turns].reverse().find((t) => t.topic === 'todo')?.items?.length ?? 0
    return {
      text: done === 2 ? 'Both done' : done > 2 ? `All ${done} done` : 'Done',
      tone: 'green',
      icon: 'circle-check',
    }
  }
  const w = session.waiting
  if (thinking && w?.topic === 'gaps')
    return { text: 'Reading your notes', tone: 'blue', icon: 'clock' }
  if (w?.topic === 'gaps-failed') return { text: 'Checking again', tone: 'blue', icon: 'clock' }
  // Only from the same kind of topic as the turn that waits: a pill never asks a question the choices can't answer.
  const built = w && DEFS[w.topic]?.build(ctx, w.items)
  if (built && (built.kind === 'question') === (w.kind === 'question')) return built.status
  const f = ctx.facts
  if (ctx.brief.stage === 'capture' && f.anotherVisit && f.surveyEnd && f.surveyEnd >= ctx.today)
    return NEXT_VISIT
  return { text: 'All caught up', tone: 'green', icon: 'circle-check' }
}

// Concerned while tasks are open or a check failed; pleased just after good news.
function moodOf(
  status: Status,
  waiting: StoredSession['waiting'],
  last: Turn | undefined,
  thinking: boolean,
): Mood {
  if (status.tone === 'red' || waiting?.topic === 'gaps-failed') return 'concerned'
  if (last?.mood === 'pleased') return 'pleased'
  return thinking ? 'thinking' : 'idle'
}

type ViewInput = {
  brief: ThreadBrief
  viewer: ThreadViewer
  now: Date
  // Bot turns the wording AI is writing now (thread.service.ts): hidden, with the typing dots.
  writing?: ReadonlySet<string>
  // An archived assessment: read only, nothing to answer.
  archived?: boolean
}

// The rail's facts every view shares. `updatedAt` is the later of the brief and the
// newest turn, so a reply that changes only the conversation still reads as newer.
function railOf(brief: ThreadBrief, lastTurnAt: string | null = null) {
  const f = brief.facts
  return {
    reference: brief.reference,
    engineerName: f.engineerName,
    stage: brief.stage,
    stageDates: f.stageDates,
    surveyStart: f.surveyStart,
    surveyEnd: f.surveyEnd,
    reportDue: f.reportDue,
    client: f.client,
    updatedAt: [brief.updatedAt.toISOString(), lastTurnAt ?? ''].sort().at(-1)!,
  }
}

/** Returns the engineer's conversation as GET .../assistant sends it. */
export function viewThread(
  state: ThreadState,
  { brief, viewer, now, writing = new Set(), archived = false }: ViewInput,
): AssistantThread {
  const session = state.session!
  const ctx = topicCtx(brief, viewer, now, session, state.earlier.length > 0)
  const pending = session.turns.some((t) => writing.has(t.id))
  const turns = session.turns.filter((t) => !writing.has(t.id)).map((t) => rebuilt(t, ctx))
  const thinking =
    !archived && (pending || (session.waiting?.topic === 'gaps' && !session.waiting.turnId))
  const status: Status = archived
    ? { text: 'Archived', tone: 'blue', icon: 'archive' }
    : statusOf(session, turns, ctx, thinking)
  const last = turns.filter((t) => t.who === 'bot').at(-1)
  return {
    ...railOf(brief, session.turns.at(-1)?.at ?? null),
    viewer: 'engineer',
    mood: archived ? 'idle' : moodOf(status, session.waiting, last, thinking),
    status,
    glance: glanceOf(brief, ctx.today),
    earlier: state.earlier.map((s) => sessionOf(s, s.turns.map(shown))),
    session: sessionOf(session, turns.map(shown)),
    // Nothing to answer while the next turn is still being written, or once archived.
    replies: pending || archived ? [] : offeredReplies(session, ctx),
    thinking,
  }
}

/** Returns an admin's view (AC 11, S9): one turn of stage and progress, nothing saved, no replies. */
export function adminThread(brief: ThreadBrief, viewerName: string, now: Date): AssistantThread {
  const f = brief.facts
  const today = dayOf(now)
  const sections = brief.sections
  const reviewed = sections.filter((s) => s.state === 'reviewed').length
  const progress = [
    sections.length
      ? `${reviewed} of ${sections.length} sections are reviewed`
      : brief.stage === 'capture'
        ? `${count(f.observations, 'observation')} so far`
        : '',
    f.reportDue
      ? `the report ${f.reportDue < today ? 'was' : 'is'} due on ${longDay(f.reportDue)}`
      : '',
  ].filter(Boolean)
  const commented = [...sections].sort((a, b) => b.openComments - a.openComments)[0]
  const owner = f.engineerName ? firstName(f.engineerName) : 'The engineer'
  const whose = f.engineerName ? ` This one is ${f.engineerName}'s.` : ''
  const where =
    brief.stage === 'exported' ? "It's exported" : `It's in the ${STAGE_LABELS[brief.stage]} stage`
  const text = `Hi ${firstName(viewerName)}!${whose} ${where}${progress.length ? `: ${progress.join(', and ')}` : ''}.${
    commented?.openComments
      ? ` ${commented.title} has ${count(commented.openComments, 'open comment')}.`
      : ''
  }`
  const id = 'admin-1'
  // Days in each stage reached so far; the current one runs to today.
  const reached = STAGES.filter((s) => f.stageDates[s])
  const spans = reached.map((s, n) => {
    const from = dayOf(new Date(f.stageDates[s]!))
    const to = reached[n + 1] ? dayOf(new Date(f.stageDates[reached[n + 1]]!)) : today
    return {
      label: STAGE_LABELS[s],
      days: Math.max(0, daysBetween(from, to)),
      now: s === brief.stage,
    }
  })
  const lane = (state: 'reviewed' | 'decisions' | 'not_started') =>
    sections
      .filter((s) => s.state === state)
      .map((s) => ({
        no: s.sectionId,
        title: s.title,
        // As on the admin board: reviewed shows its day, not started its drafted day.
        date:
          !s.date || state === 'decisions'
            ? null
            : state === 'reviewed'
              ? shortDay(s.date)
              : `Drafted ${shortDay(s.date)}`,
        comments: s.openComments,
      }))
  const turn: Turn = {
    id,
    who: 'bot',
    at: now.toISOString(),
    topic: 'admin',
    mood: 'idle',
    says: [{ text, tone: 'normal' }],
    cards: [
      // No lanes card when no section is open: the words and the stage times say it.
      ...(sections.some((s) => s.state !== 'reviewed')
        ? [
            {
              type: 'lanes' as const,
              id: `${id}-lanes`,
              title: 'Sections',
              note: `${reviewed} of ${sections.length} reviewed`,
              // Only lanes with a section in them (round 6).
              lanes: [
                { state: 'wait' as const, label: 'Decisions to Make', items: lane('decisions') },
                { state: 'new' as const, label: 'Not Started', items: lane('not_started') },
                { state: 'ok' as const, label: 'Reviewed', items: lane('reviewed') },
              ].filter((l) => l.items.length),
            },
          ]
        : []),
      {
        type: 'stage-time',
        id: `${id}-stage-time`,
        title: 'Time in Each Stage',
        note: `${count(
          spans.reduce((n, s) => n + s.days, 0),
          'day',
        )} so far`,
        spans,
      },
    ],
    program: null,
  }
  return {
    ...railOf(brief),
    viewer: 'admin',
    mood: 'idle',
    status: {
      text: pill(`${owner}'s assessment`, `${owner.slice(0, 16)}'s`),
      tone: 'blue',
      icon: 'user',
    },
    glance: glanceOf(brief, today),
    earlier: [],
    session: {
      id: 'admin',
      startedAt: now.toISOString(),
      stage: brief.stage as Stage,
      turns: [turn],
    },
    replies: [],
    thinking: false,
  }
}
