// MarshBot's topics from Ready for generation on (AS-06 rounds 5-6, canvas
// S3-S8, C10): what's in the way of generating, the sections outline while
// drafting and reviewing, reminders, drafts to redo, ready to export and the
// exported file. Each builder returns the topic, or null when it has nothing
// to say. Called by topics.ts.
import { daysBetween, longDay, shortDay } from '../dates'
import { partTitle, PARTS } from '../progress'
import type { BriefItem, Card, OutlineItem, OutlineState, Reply } from '../types'
import { andList, count, itemRow, kinds, opens, pill, row, tick } from './cards'
import { answered } from './topics-capture'
import type { Built, TopicCtx } from './types'

const has = (ctx: TopicCtx, id: string) => ctx.open.find((i) => i.id === id)

export const BLOCKER_KINDS = kinds('thin-sections', 'uncategorised', 'transcribing')

/** Before you generate (S3): what would leave gaps in the draft, what's fine, and Generate anyway. */
export function beforeGenerateTopic(ctx: TopicCtx): Built | null {
  const blockers = ctx.open.filter(BLOCKER_KINDS)
  if (!blockers.length) return null
  const f = ctx.facts
  const { covered, total } = answered(ctx.brief.areas)
  const ticks = [
    tick('Site Walks', `${f.walksReviewed ?? 0} reviewed`),
    ...(blockers.some((i) => i.kind === 'transcribing')
      ? []
      : [tick('Recordings', `${f.recordingsTranscribed ?? 0} transcribed`)]),
    ...(total ? [tick('Checklist', `${covered} of ${total}`)] : []),
  ]
  const n = blockers.length
  const reply: Reply = {
    id: 'generate-anyway',
    label: 'Generate anyway',
    primary: true,
    picksDate: false,
  }
  return {
    kind: 'question',
    says: [
      {
        text: `It's nearly ready for generation, but ${n === 1 ? '1 thing' : `${n} things`} would leave gaps in the draft, so it's worth clearing ${n === 1 ? 'it' : 'them'} first.`,
        tone: 'normal',
      },
    ],
    cards: [
      {
        type: 'rows',
        id: 'before-generate',
        title: 'Before You Generate',
        note: `${ticks.length} of ${ticks.length + n} ready`,
        rows: blockers.map(itemRow),
        ticks,
        cta: null,
      },
    ],
    replies: [reply],
    mood: 'concerned',
    status: { text: `${count(n, 'thing')} to clear`, tone: 'amber', icon: 'circle-alert' },
  }
}

/** Ready to Generate (C10): what makes it ready, as three ticks, then Open Generation. */
export function readyTopic(ctx: TopicCtx): Built | null {
  const blockers = ctx.open.filter(BLOCKER_KINDS)
  const anyway = ctx.said.includes('generate-anyway')
  if (blockers.length && !anyway) return null
  const f = ctx.facts
  const n = f.observations
  const { covered, total } = answered(ctx.brief.areas)
  const uncategorised = blockers.some((i) => i.kind === 'uncategorised')
  const thin = blockers.some((i) => i.kind === 'thin-sections')
  return {
    kind: 'info',
    says: [
      {
        text: anyway
          ? 'Sure. The draft will leave those gaps for now, and you can fill them in later.'
          : `All ${count(n, 'observation')} ${n === 1 ? 'is' : 'are'} categorised and every section has enough to draft from, so you're good to go.`,
        tone: anyway ? 'normal' : 'good',
      },
    ],
    cards: [
      {
        type: 'rows',
        id: 'ready',
        title: 'Ready to Generate',
        note: null,
        rows: [],
        ticks: [
          tick('Observations', uncategorised ? `${n}` : `${n}, all categorised`),
          ...(total ? [tick('Checklist', `${covered} of ${total} answered`)] : []),
          ...(thin ? [] : [tick('Sections', `All ${PARTS.length} have enough to draft`)]),
        ],
        cta: { label: 'Open Generation', link: { tab: 'generate' } },
      },
    ],
    mood: 'pleased',
    status: { text: 'Ready to generate', tone: 'green', icon: 'sparkles' },
  }
}

export const SECTIONS_KINDS = kinds(
  'draft-questions',
  'figures-missing',
  'not-drafted',
  'out-of-date',
  'summary-waiting',
  'no-accepted-ofi',
)
const KEY_LABELS: Partial<Record<OutlineState, string>> = {
  ok: 'Drafted',
  question: 'Questions for You',
  figures: 'Needs Your Figures',
  wait: 'Out of Date',
  new: 'Not Drafted',
}

type Outline = Extract<Card, { type: 'outline' }>

/**
 * Returns one outline card. No row is singled out (`next` null, round 6): a
 * row opens its own section, and the button opens the tab. The key is left
 * out when every row is in the same state.
 */
function outlineCard(
  id: string,
  title: string,
  lead: string,
  items: OutlineItem[],
  labels: Partial<Record<OutlineState, string>>,
  cta: Outline['cta'],
): Outline {
  const present = new Set(items.map((i) => i.state))
  return {
    type: 'outline',
    id,
    title,
    lead,
    items,
    next: null,
    key:
      present.size > 1
        ? (Object.keys(labels) as OutlineState[])
            .filter((s) => present.has(s))
            .map((state) => ({ state, label: labels[state]! }))
        : [],
    cta,
  }
}

/** Sections (S4, S5): all 11 report parts with their drafting state. */
export function sectionsTopic(ctx: TopicCtx): Built {
  const left = String(has(ctx, 'generate.not-drafted')?.facts.left ?? '').split(',')
  const items: OutlineItem[] = PARTS.map((no) => {
    const q = has(ctx, `generate.questions:${no}`)
    const fig = has(ctx, `generate.figures:${no}`)
    const [state, note]: [OutlineState, string | null] = q
      ? ['question', count(Number(q.facts.questions), 'question')]
      : fig
        ? ['figures', no === '4' ? 'Scores' : 'Figures']
        : has(ctx, `generate.out-of-date:${no}`)
          ? ['wait', 'Out of date']
          : left.includes(no)
            ? ['new', null]
            : ['ok', null]
    return {
      no,
      title: partTitle(no),
      state,
      note,
      link: { tab: 'generate', params: { section: no } },
    }
  })
  const n = (s: OutlineState) => items.filter((i) => i.state === s).length
  const ok = n('ok')
  // How many drafted is the greeting's to say; these words say how they stand.
  const clauses = [
    ok ? `${ok} ${ok === 1 ? 'is' : 'are'} clean` : '',
    n('question') ? `${n('question')} came back with questions for you` : '',
    n('figures')
      ? `${n('figures')} ${n('figures') === 1 ? 'is' : 'are'} waiting on figures only you can enter`
      : '',
    n('wait') ? `${n('wait')} ${n('wait') === 1 ? 'is' : 'are'} out of date` : '',
    n('new') ? `${n('new')} ${n('new') === 1 ? 'is' : 'are'} not drafted yet` : '',
  ].filter(Boolean)
  const need = items.length - ok
  return {
    kind: 'info',
    says: [
      {
        text: need
          ? `Of the ${items.length} sections, ${andList(clauses)}.`
          : `All ${items.length} sections are drafted, and every one is clean.`,
        tone: need ? 'normal' : 'good',
      },
    ],
    cards: [
      outlineCard(
        'sections',
        'Sections',
        `${ok} of ${items.length} sections ready`,
        items,
        KEY_LABELS,
        { label: 'Open Generation', link: { tab: 'generate' } },
      ),
    ],
    mood: need ? 'idle' : 'pleased',
    status: need
      ? {
          text: `${count(need, 'section')} to do`,
          tone: 'amber',
          icon: 'sparkles',
        }
      : { text: 'All drafted', tone: 'green', icon: 'sparkles' },
  }
}

export const OUTLINE_KINDS = kinds('review-items')
const REVIEW_LABELS: Partial<Record<OutlineState, string>> = {
  ok: 'Reviewed',
  wait: 'Decisions to Make',
  new: 'Not Started',
}
const REVIEW_STATE = { reviewed: 'ok', decisions: 'wait', not_started: 'new' } as const

/** Returns the review outline items, from the stored section states. */
function reviewItems(ctx: TopicCtx): OutlineItem[] {
  return ctx.brief.sections.map((s) => ({
    no: s.sectionId,
    title: s.title,
    state: REVIEW_STATE[s.state],
    note: s.openComments ? count(s.openComments, 'comment') : null,
    link: { tab: 'review', params: { section: s.sectionId } },
  }))
}

/** Review (S6): every section's review state. After Review only when work reopened. */
export function outlineTopic(ctx: TopicCtx): Built | null {
  const items = reviewItems(ctx)
  const reopened = ctx.brief.stage === 'ready_to_export' || ctx.brief.stage === 'exported'
  if (!items.length || (reopened && !ctx.open.some(OUTLINE_KINDS) && !ctx.rebuild)) return null
  const reviewed = items.filter((i) => i.state === 'ok').length
  const left = items.length - reviewed
  return {
    kind: 'info',
    says: [
      {
        text: reopened
          ? `${ctx.facts.site} was ready to export, but some of it needs another look in review.`
          : `${reviewed} of ${items.length} sections are fully reviewed${left ? `, so ${count(left, 'section')} still ${left === 1 ? 'needs' : 'need'} you` : ''}.`,
        tone: 'normal',
      },
    ],
    cards: [
      outlineCard(
        'outline',
        'Review',
        `${reviewed} of ${items.length} sections reviewed`,
        items,
        REVIEW_LABELS,
        { label: 'Open Review', link: { tab: 'review' } },
      ),
    ],
    mood: 'idle',
    status: left
      ? {
          text: pill(`${count(left, 'section')} to review`, `${left} to review`),
          tone: 'amber',
          icon: 'user-search',
        }
      : { text: 'All reviewed', tone: 'green', icon: 'circle-check' },
  }
}

export const REMINDER_KINDS = (i: BriefItem) => i.weight === 'reminder'
/** While You Were Away: comments, quick decisions and unseen questions. */
export function remindersTopic(ctx: TopicCtx): Built | null {
  const items = ctx.open.filter(REMINDER_KINDS)
  if (!items.length) return null
  const n = items.length
  return {
    kind: 'info',
    says: [
      {
        text: `${n === 1 ? '1 small thing' : `${n} small things`} I noticed while you were away.`,
        tone: 'normal',
      },
    ],
    cards: [
      {
        type: 'rows',
        id: 'reminders',
        title: 'While You Were Away',
        note: null,
        rows: items.map(itemRow),
        ticks: [],
        cta: null,
      },
    ],
    mood: 'idle',
    status: {
      text: pill(`${count(n, 'thing')} to look at`, `${n} to look at`),
      tone: 'amber',
      icon: 'list-checks',
    },
  }
}

export const DRAFT_AGAIN_KINDS = kinds('out-of-date')
/** Draft Again: sections whose drafts are out of date after the report was ready. */
export function draftAgainTopic(ctx: TopicCtx): Built | null {
  const items = ctx.open.filter(DRAFT_AGAIN_KINDS)
  if (!items.length) return null
  return {
    kind: 'info',
    says: [
      {
        text: 'Some drafts are out of date since you reviewed them, so draft them again first.',
        tone: 'normal',
      },
    ],
    cards: [
      {
        type: 'rows',
        id: 'draft-again',
        title: 'Draft Again',
        note: null,
        rows: items.map(itemRow),
        ticks: [],
        cta: null,
      },
    ],
    mood: 'concerned',
    status: {
      text: pill(`${count(items.length, 'draft')} out of date`, `${items.length} to redraft`),
      tone: 'amber',
      icon: 'refresh-cw',
    },
  }
}

/** Ready to export (S7): the whole report ticked, then Export the Report. */
export function exportReadyTopic(ctx: TopicCtx): Built | null {
  if (ctx.open.some((i) => DRAFT_AGAIN_KINDS(i) || OUTLINE_KINDS(i))) return null
  const items = reviewItems(ctx)
  const due = ctx.facts.reportDue
  const ahead = due ? daysBetween(ctx.today, due) : 0
  return {
    kind: 'info',
    says: [
      {
        text: `Everything on ${ctx.facts.site} is reviewed, so the report is ready to export.${ahead > 0 ? ` That's ${count(ahead, 'day')} ahead of the due date. Nice work!` : ''}`,
        tone: 'good',
      },
    ],
    cards: [
      outlineCard(
        'export-ready',
        'Review',
        `${items.filter((i) => i.state === 'ok').length} of ${items.length} sections reviewed`,
        items,
        REVIEW_LABELS,
        { label: 'Export the Report', link: { tab: 'export' } },
      ),
    ],
    mood: 'pleased',
    status: { text: 'Ready to export', tone: 'green', icon: 'stamp' },
  }
}

export const EXPORTED_KINDS = kinds('stale-export')
/** Returns the stale-export item while MarshBot may still ask about it ("Not now" and "Export again" end that). */
export function staleAsk(ctx: TopicCtx): BriefItem | null {
  const stale = has(ctx, 'exported.stale')
  if (!stale) return null
  const dismissed = ctx.viewer.dismissed.some(
    (d) => d.itemId === stale.id && d.fingerprint === stale.fingerprint,
  )
  return dismissed || ctx.viewer.exportAgain === stale.fingerprint ? null : stale
}

/**
 * Exported (S8): with changes since, the "Changed Since Export" card, then
 * the "Exported" file card, then the question as its own bubble; without, the
 * file card alone.
 */
export function exportedTopic(ctx: TopicCtx): Built | null {
  const f = ctx.facts
  if (!f.exportFile || !f.exportDay) return null
  const stale = has(ctx, 'exported.stale')
  const ask = staleAsk(ctx)
  const changed = stale ? String(stale.facts.changed).split(',').filter(Boolean) : []
  const names = changed.map(partTitle)
  const early = f.reportDue ? daysBetween(f.exportDay, f.reportDue) : 0
  const went = `The ${f.site} report went out on ${shortDay(f.exportDay)}`
  const replies: Reply[] = [
    { id: 'not-now', label: 'Not now', primary: false, picksDate: false },
    { id: 'export-again', label: 'Export again', primary: true, picksDate: false },
  ]
  const file: Card = {
    type: 'rows',
    id: 'exported',
    title: 'Exported',
    note: longDay(f.exportDay),
    rows: [
      row(
        'file',
        'file-text',
        'neutral',
        f.exportFile.fileName,
        f.exportFile.pages ? count(f.exportFile.pages, 'page') : null,
        opens({ tab: 'export' }),
      ),
    ],
    ticks: [],
    cta: null,
  }
  const since: Card = {
    type: 'rows',
    id: 'changed',
    title: 'Changed Since Export',
    note: count(changed.length, 'section'),
    rows: changed.map((id) =>
      row(
        `changed:${id}`,
        'pen',
        'amber',
        partTitle(id),
        'Edited after the export',
        opens({ tab: 'review', params: { section: id } }),
      ),
    ),
    ticks: [],
    cta: null,
  }
  return {
    kind: ask ? 'question' : 'info',
    says: ask
      ? [
          {
            text: `${went}. ${changed.length === 1 ? '1 thing has' : `${changed.length} things have`} changed since then: ${andList(names)} ${changed.length === 1 ? 'was' : 'were'} edited after the export, so the copy you sent is a version behind.`,
            tone: 'normal',
          },
        ]
      : [
          {
            text: `${went}${early > 0 ? `, ${count(early, 'day')} before it was due` : ''}.`,
            tone: 'good',
          },
        ],
    cards: changed.length ? [since, file] : [file],
    after: ask ? [{ text: 'Do you want to export the newer one?', tone: 'normal' }] : undefined,
    replies: ask ? replies : undefined,
    mood: ask ? 'concerned' : 'pleased',
    status: ask
      ? { text: '1 question for you', tone: 'blue', icon: 'message-square' }
      : { text: 'Exported', tone: 'green', icon: 'stamp' },
  }
}
