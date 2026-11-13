// The "To do" topic (AS-06 round 5, canvas C1-C3, C2b, C11): Fix now items
// as rows that change in place (Review, Try again, Transcribing, Done, Open),
// and MarshBot's words when they are done or a retry fails again.
// Called by topics.ts and advance.ts.
import { count, lowerFirst, opens, row, upperFirst } from './cards'
import type { Built, TopicCtx } from './types'
import type { BriefItem, CardRow, ItemLink } from '../types'

/** Returns whether an item belongs in "To do": Fix now, but never the report date (the greeting says that). */
export const isTask = (i: BriefItem) => i.weight === 'fix_now' && i.kind !== 'report-due'

type Live = { item: BriefItem | null; state: 'open' | 'busy' | 'done' }

/**
 * Returns where a task stands now: open, busy (transcribing or being read
 * again after a retry) or done (resolved, or gone from the brief).
 */
export function liveOf(ctx: TopicCtx, id: string): Live {
  const open = ctx.brief.items.find((i) => i.id === id && !i.resolvedAt)
  if (open) return { item: open, state: open.facts.status === 'busy' ? 'busy' : 'open' }
  const item = ctx.brief.items.find((i) => i.id === id) ?? null
  // A failed site walk retried is read again under its own id.
  const walk = id.startsWith('walk.failed:') && id.slice('walk.failed:'.length)
  if (walk && ctx.open.some((i) => i.id === `walk.reading:${walk}`)) return { item, state: 'busy' }
  return { item, state: 'done' }
}

const done = (label = 'Done'): CardRow['end'] => ({ type: 'status', status: 'done', label })
const busy = (label: string): CardRow['end'] => ({ type: 'status', status: 'busy', label })
const button = (
  label: string,
  link: ItemLink | null,
  icon: string | null = null,
  action: BriefItem['action'] = null,
  actionTarget: string | null = null,
): CardRow['end'] => ({ type: 'button', label, icon, link, action, actionTarget })

// One task's row now. A retry is offered once: after a second failure the button is Open.
function taskRow(ctx: TopicCtx, id: string): CardRow | null {
  const { item, state } = liveOf(ctx, id)
  // shortcut: a task resolved so long ago that the brief no longer keeps it drops off its card; keepResolved (50) makes that rare.
  if (!item) return null
  const media = item.kind === 'failed-recording' || item.kind === 'failed-page'
  const page = item.kind === 'failed-page'
  if (state === 'done') {
    const walk = id.startsWith('walk.ready:') ? id.slice('walk.ready:'.length) : null
    const made = walk ? (ctx.facts.walkObservations?.[walk] ?? Number(item.facts.proposed ?? 0)) : 0
    const detail = walk
      ? `${count(made, 'observation')} created`
      : media
        ? page
          ? 'Page read'
          : 'Recording transcribed'
        : 'Sorted'
    return row(id, item.icon, 'green', item.title, detail, done())
  }
  if (state === 'busy')
    return row(
      id,
      item.icon,
      'neutral',
      item.title,
      String(item.facts.recording ?? item.facts.page ?? 'Being read'),
      busy(media ? 'Transcribing' : 'Reading'),
    )
  if (media) {
    const again = Number(item.facts.attempts ?? 1) > 1
    const [obs, mediaId] = (item.actionTarget ?? '').split(':')
    return again
      ? row(
          id,
          item.icon,
          'red',
          item.title,
          page ? "Still couldn't read" : "Still couldn't transcribe",
          button('Open', { tab: 'observations', params: { obs, media: mediaId } }),
          { bad: true },
        )
      : row(
          id,
          item.icon,
          'red',
          item.title,
          page ? "Couldn't read" : "Couldn't transcribe",
          button('Try Again', null, 'rotate-ccw', item.action, item.actionTarget),
          { bad: true },
        )
  }
  if (id.startsWith('walk.ready:'))
    return row(
      id,
      item.icon,
      'violet',
      item.title,
      `${count(Number(item.facts.proposed ?? 0), 'proposed observation')}`,
      button('Review', item.link),
    )
  if (id.startsWith('walk.failed:'))
    return row(id, item.icon, 'red', item.title, "Couldn't be read", button('Open', item.link), {
      bad: true,
    })
  return row(
    id,
    item.icon,
    'amber',
    item.title,
    item.detail,
    item.link ? opens(item.link) : { type: 'tick' },
  )
}

/**
 * Returns the items grouped by kind and place, so two failed recordings from
 * one place are said once with their count (without this, the same sentence
 * came twice).
 */
export function byPlace(items: BriefItem[]): { item: BriefItem; n: number }[] {
  const groups = new Map<string, { item: BriefItem; n: number }>()
  for (const item of items) {
    const key = `${item.kind}|${item.title}`
    const found = groups.get(key)
    if (found) found.n++
    else groups.set(key, { item, n: 1 })
  }
  return [...groups.values()]
}

// The sentence that says what a task (or `n` alike from one place) is and what to do.
function taskSentence({ item, n }: { item: BriefItem; n: number }): string {
  const what = (one: string, many: string) => (n === 1 ? `A ${one}` : `${n} ${many}`)
  if (item.id.startsWith('walk.ready:'))
    return `Your ${lowerFirst(item.title)} has finished processing, and I've turned it into ${count(Number(item.facts.proposed ?? 0), 'proposed observation')} for you to review.`
  if (item.kind === 'failed-recording')
    return `${what('recording', 'recordings')} from ${item.title} couldn't be transcribed. That's usually a hiccup on our side, so give ${n === 1 ? 'it' : 'them'} another try and I'll tell you how it goes.`
  if (item.kind === 'failed-page')
    return `${what('handwritten page', 'handwritten pages')} from ${item.title} couldn't be read. Give ${n === 1 ? 'it' : 'them'} another try and I'll tell you how it goes.`
  return item.fact
}

/**
 * Returns the "To do" topic for these items (the open tasks when none are
 * given), or null when there are none. `fresh` items are new mid-session.
 */
export function todoTopic(ctx: TopicCtx, items?: string[], fresh = false): Built | null {
  const ids = items ?? ctx.open.filter(isTask).map((i) => i.id)
  const rows = ids.flatMap((id) => taskRow(ctx, id) ?? [])
  if (!rows.length) return null
  const n = ids.length
  const lead = fresh
    ? `Something new came up that I need you to sort out first.`
    : `Before we look at what the report still needs, there${n === 1 ? "'s 1 thing" : ` are ${n} things`} I need you to sort out first.`
  const said = byPlace(ids.flatMap((id) => ctx.brief.items.find((i) => i.id === id) ?? [])).map(
    taskSentence,
  )
  const left = rows.filter((r) => r.end.type !== 'status' || r.end.status !== 'done').length
  return {
    kind: 'tasks',
    says: [
      { text: lead, tone: 'lead' },
      { text: said.join(' '), tone: 'normal' },
    ],
    cards: [
      {
        type: 'tasks',
        id: 'todo',
        title: 'To Do',
        done: rows.length - left,
        total: rows.length,
        rows,
      },
    ],
    items: ids,
    mood: 'concerned',
    status: { text: `${count(left, 'thing')} to fix`, tone: 'red', icon: 'circle-alert' },
  }
}

/** Returns how many of these tasks are still open or busy. */
export const tasksLeft = (ctx: TopicCtx, ids: string[]) =>
  ids.filter((id) => liveOf(ctx, id).state !== 'done').length

/** Returns MarshBot's "Nice work" for tasks that are all done (canvas C3). */
export function ackWords(ctx: TopicCtx, ids: string[]): string {
  const clauses = ids.flatMap((id) => {
    const item = ctx.brief.items.find((i) => i.id === id)
    if (!item) return []
    const walk = id.startsWith('walk.ready:') ? id.slice('walk.ready:'.length) : null
    if (walk) {
      const made = ctx.facts.walkObservations?.[walk] ?? Number(item.facts.proposed ?? 0)
      return [`the ${lowerFirst(item.title)} is in with ${count(made, 'new observation')}`]
    }
    return [`${item.title} came through`]
  })
  // Two recordings from one place come through as one clause.
  const unique = [...new Set(clauses)]
  const joined =
    unique.length > 1 ? `${unique.slice(0, -1).join(', ')}, and ${unique.at(-1)}` : unique[0]
  return joined ? `Nice work, ${ctx.first}! ${upperFirst(joined)}.` : `Nice work, ${ctx.first}!`
}

/** Returns MarshBot's words when retried recordings or pages fail again, said once per place (canvas C2b). */
export function sorryWords(ctx: TopicCtx, items: BriefItem[]): string {
  const said = byPlace(items).map(({ item, n }) =>
    item.kind === 'failed-page'
      ? `${n === 1 ? 'The page' : `${n} pages`} from ${item.title} still couldn't be read. Have a look at ${n === 1 ? 'the page itself' : 'the pages themselves'}. If ${n === 1 ? "it's" : "they're"} hard to read, you can type the note in instead.`
      : `${n === 1 ? `${item.title}` : `${n} recordings from ${item.title}`} still wouldn't transcribe. Have a look at ${n === 1 ? 'the recording itself' : 'the recordings themselves'}. If the audio is too noisy, you can type the note in instead.`,
  )
  return `Sorry, ${ctx.first}. ${said.join(' ')}`
}
