// MarshBot's saved conversation (AS-06 rounds 5-6): loads the engineer's thread,
// runs the engine (thread/advance.ts) for an open, a change or a reply, saves
// what changed, then has the wording AI write the new turns once, outside the lock.
// Called by brief.service.ts (GET), replies.service.ts and recheck.service.ts
// (after a re-check). Calls thread/, wording.service.ts and bus.ts.
import type { Types } from 'mongoose'
import { AssessmentModel } from '../../models/assessment.model'
import { AssistantBriefModel } from '../../models/assistant-brief.model'
import {
  AssistantThreadModel,
  type IAssistantThread,
  type StoredTurn,
} from '../../models/assistant-thread.model'
import { AssistantViewerModel } from '../../models/assistant-viewer.model'
import { inBackground } from './background'
import { isWatched, publishBriefChanged } from './bus'
import { oneAtATime } from './lock'
import { firstName } from './phrases'
import { PARTS, partTitle } from './progress'
import { ASSISTANT } from './settings'
import { advance, offeredReplies } from './thread/advance'
import { topicCtx } from './thread/session'
import type { Event, ThreadBrief, ThreadState, ThreadViewer } from './thread/types'
import { adminThread, viewThread } from './thread/view'
import type { AssistantThread, Reply } from './types'
import { wordTurns } from './wording.service'

export type Loaded = {
  thread: ThreadState
  brief: ThreadBrief
  viewer: ThreadViewer
  engineer: { _id: Types.ObjectId; name: string }
  assessment: Types.ObjectId
  openedAt: Date | null
  archived: boolean
}

// The engineer's thread, the stored brief and what MarshBot knows of the engineer; null without either.
async function load(reference: string, brief?: ThreadBrief): Promise<Loaded | null> {
  const assessment = await AssessmentModel.findOne({ reference }, 'engineer archivedAt')
    .populate<{ engineer: { _id: Types.ObjectId; name: string } | null }>('engineer', 'name')
    .lean()
  const engineer = assessment?.engineer
  if (!assessment || !engineer) return null
  const [stored, saved, v] = await Promise.all([
    AssistantThreadModel.findOne({
      assessment: assessment._id,
      user: engineer._id,
    }).lean<IAssistantThread>(),
    brief ? null : AssistantBriefModel.findOne({ assessment: assessment._id }).lean<ThreadBrief>(),
    AssistantViewerModel.findOne({ assessment: assessment._id, user: engineer._id }).lean(),
  ])
  const b = brief ?? saved
  if (!b) return null
  return {
    thread: { earlier: stored?.earlier ?? [], session: stored?.session ?? null },
    brief: b,
    viewer: {
      name: engineer.name,
      dismissed: v?.dismissed ?? [],
      exportAgain: v?.exportAgain ?? null,
    },
    engineer,
    assessment: assessment._id,
    openedAt: v?.openedAt ?? null,
    archived: !!assessment.archivedAt,
  }
}

// The names a program may only repeat: areas, sections and the places items name.
const namesOf = (brief: ThreadBrief) => [
  ...brief.areas.map((a) => a.area),
  ...PARTS.map(partTitle),
  ...brief.items.filter((i) => i.link?.params?.obs || i.link?.params?.walk).map((i) => i.title),
]

type Options = {
  brief?: ThreadBrief
  // A reply's own step, run while the thread is held: given the replies offered
  // now, it checks and applies the reply and returns the brief after it.
  prepare?: (offered: Reply[], loaded: Loaded) => Promise<ThreadBrief>
}

// Bot turns the wording AI is writing now, by id: hidden, with the typing dots.
// Kept in memory on purpose: after a restart nothing is pending, so a turn
// whose wording never landed shows in its template words.
const writing = new Set<string>()
const lockOf = (reference: string) => `thread:${reference}`

/**
 * Advances the assigned engineer's thread for `event`, saves it when anything
 * changed, and returns it loaded; the new bot turns are then worded in the
 * background (thread not held). A 'changed' event only moves a thread whose
 * Overview is open now (a live event stream) and was opened by the engineer
 * in the last 30 minutes: nobody is looking otherwise, and the next open runs
 * the same rules. An archived assessment is never moved. Returns null for an
 * assessment with no engineer or brief.
 */
export function advanceThread(
  reference: string,
  event: Event,
  { brief, prepare }: Options = {},
): Promise<Loaded | null> {
  // One advance per thread at a time: without this, two opens at once would both greet.
  return oneAtATime(lockOf(reference), async () => {
    const now = new Date()
    const loaded = await load(reference, brief)
    if (!loaded || loaded.archived) return loaded
    const recent =
      !!loaded.openedAt && now.getTime() - loaded.openedAt.getTime() < ASSISTANT.sameVisitMs
    if (event.type === 'changed' && (!loaded.thread.session || !recent || !isWatched(reference)))
      return loaded
    if (prepare) {
      const ctx = topicCtx(
        loaded.brief,
        loaded.viewer,
        now,
        loaded.thread.session,
        loaded.thread.earlier.length > 0,
      )
      loaded.brief = await prepare(offeredReplies(loaded.thread.session, ctx), loaded)
    }

    // a. The engine; saved only when something changed (a repeat open writes nothing).
    const result = advance(
      loaded.thread,
      { brief: loaded.brief, viewer: loaded.viewer, now },
      event,
    )
    const before = JSON.stringify([loaded.thread.earlier, loaded.thread.session])
    loaded.thread = { earlier: result.earlier, session: result.session }
    if (!result.added.length && JSON.stringify([result.earlier, result.session]) === before)
      return loaded
    await AssistantThreadModel.updateOne(
      { assessment: loaded.assessment, user: loaded.engineer._id },
      { $set: { reference, earlier: result.earlier, session: result.session } },
      { upsert: true },
    )
    if (!result.added.length) return loaded
    // b. The new bot turns wait for their words, which come after this returns.
    const bots = result.added.filter((t) => t.who === 'bot')
    bots.forEach((t) => writing.add(t.id))
    publishBriefChanged(reference, now.toISOString())
    if (bots.length) inBackground('wording', word(reference, loaded, bots))
    return loaded
  })
}

/**
 * Words the new bot turns once (rule 8) and saves each program on its turn,
 * holding the thread only for that save, so a newer advance is never
 * overwritten. Always ends with a push: without it, an open Overview would
 * keep the typing dots after a failed save. Returns nothing.
 */
async function word(reference: string, loaded: Loaded, bots: StoredTurn[]): Promise<void> {
  try {
    const programs = await wordTurns(
      reference,
      firstName(loaded.viewer.name),
      bots,
      namesOf(loaded.brief),
    )
    if (!Object.keys(programs).length) return
    await oneAtATime(lockOf(reference), async () => {
      const key = { assessment: loaded.assessment, user: loaded.engineer._id }
      const stored = await AssistantThreadModel.findOne(key).lean<IAssistantThread>()
      if (!stored?.session) return
      const turns = stored.session.turns.map((t) =>
        programs[t.id] ? { ...t, program: programs[t.id] } : t,
      )
      await AssistantThreadModel.updateOne(key, { $set: { 'session.turns': turns } })
    })
  } finally {
    bots.forEach((t) => writing.delete(t.id))
    publishBriefChanged(reference, new Date().toISOString())
  }
}

/** Returns the engineer's thread as the Overview shows it, after `event`; throws when there is none. */
export async function engineerThread(
  reference: string,
  event: Event,
  options: Options = {},
): Promise<AssistantThread> {
  const loaded = await advanceThread(reference, event, options)
  if (!loaded) throw new Error(`MarshBot has no thread for ${reference}.`)
  const now = new Date()
  // An archived assessment with no conversation yet: a read-only view, nothing saved (rule g).
  if (!loaded.thread.session)
    return {
      ...adminThread(loaded.brief, loaded.viewer.name, now),
      viewer: 'engineer',
      status: { text: 'Archived', tone: 'blue', icon: 'archive' },
    }
  return viewThread(loaded.thread, {
    brief: loaded.brief,
    viewer: loaded.viewer,
    now,
    writing,
    archived: loaded.archived,
  })
}
