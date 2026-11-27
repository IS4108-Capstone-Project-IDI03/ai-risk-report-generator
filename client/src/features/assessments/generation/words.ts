// The words Generation shows (GN-13): the checkpoint header's title, line and button for each
// checkpoint, the reason under a flagged row, and the line under each step's name.
// Used by screens/DraftingSteps.tsx and components/DraftingPartRow.tsx. Wording from the
// spec's "The checkpoint header" table; the three cases it has no board for are marked.
import { plural } from '../reviewDisplay'
import type { GenerationDto, GenerationPart, OutOfDate } from './types'

/** Returns parts as the report names them, in number order: "Section 3", "Sections 4 and 5",
    "Sections 6 to 12", "Section 3 and Sections 6 to 12", "Sections 2, 4 and 5". */
// must match server/src/services/generation/words.ts
export function sectionList(ids: string[]): string {
  const numbers = [...new Set(ids.map(Number))].sort((a, b) => a - b)
  // a. Runs of neighbours: 6, 7, 8 is one run.
  const runs: number[][] = []
  for (const n of numbers) {
    const last = runs.at(-1)
    if (last && n === last.at(-1)! + 1) last.push(n)
    else runs.push([n])
  }
  // b. Ranges only when every run reads well as one: never "Sections 4 to 5".
  const ranges =
    runs.length <= 2 &&
    runs.every((r) => r.length === 1 || r.length >= 3) &&
    runs.some((r) => r.length >= 3)
  if (ranges)
    return runs
      .map((r) => (r.length === 1 ? `Section ${r[0]}` : `Sections ${r[0]} to ${r.at(-1)}`))
      .join(' and ')
  // c. The plain numbers.
  if (numbers.length === 1) return `Section ${numbers[0]}`
  return `Sections ${numbers.slice(0, -1).join(', ')} and ${numbers.at(-1)}`
}

// The sections Section 2 summarises that changed: "Section 7", or "Sections 7 and 11"
// when the gateway names them all, so Generation and Export list the same ones.
function changedSections(o: Extract<OutOfDate, { why: 'section' }>): string {
  return sectionList(o.sections?.length ? o.sections : [o.section])
}

// What changed, as a phrase after "Section 7's".
const WHAT = { observations: 'observations', figures: 'figures', scope: 'site details' } as const

/** Returns the short reason under an out-of-date row: "Observations changed". */
export function outOfDateReason(o: OutOfDate): string {
  if (o.why === 'section') return `Needs redrafting because ${changedSections(o)} changed`
  const what = WHAT[o.why]
  return `${what[0].toUpperCase()}${what.slice(1)} changed`
}

/** Returns "Drafted today, 2:14 pm" (yesterday, or "12 Nov", on other days). */
export function draftedWhen(iso: string, now = new Date()): string {
  const at = new Date(iso)
  const yesterday = new Date(now)
  yesterday.setDate(now.getDate() - 1)
  const day =
    at.toDateString() === now.toDateString()
      ? 'today'
      : at.toDateString() === yesterday.toDateString()
        ? 'yesterday'
        : at.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
  const time = at.toLocaleTimeString('en-GB', { hour: 'numeric', minute: '2-digit', hour12: true })
  return `Drafted ${day}, ${time}`
}

// The engineer's three tasks in step 2, in order (must match GenerationTask['id'] in types.ts).
export const TASKS = {
  ofi: { icon: 'lightbulb', title: 'Accept at least 1 OFI' },
  scores: { icon: 'gauge', title: 'Enter the scores' },
  losses: { icon: 'coins', title: 'Enter the loss estimates' },
} as const

/** The line under step 3's name. Section 2 is drafted last: it summarises the others. */
export const STEP_THREE_LINE = 'Sections 4 and 5, then Section 2'

export type HeaderAction =
  // Starts the drafting run the checkpoint offers.
  | { kind: 'start'; label: string; icon: string }
  // The start button, greyed out while recordings are transcribed.
  | { kind: 'greyed'; label: string; icon: string }
  | { kind: 'review' }
  | { kind: 'observations' }
  // An admin's view: the chip where a start button would be.
  | { kind: 'view_only' }

export type HeaderWords = {
  tone: 'ai' | 'you' | 'warn' | 'bad' | 'ok'
  icon: string
  busy: boolean
  title: string
  line: string
  action: HeaderAction | null
}

const VIEW_ONLY_NOTE = 'Only the assigned engineer can start drafting.'

/** Returns what the checkpoint header says and offers for the drafting state `g`; `phone`
    picks the shorter lines boards 12 and 13 use at phone width. */
export function headerWords(g: GenerationDto, phone = false): HeaderWords {
  const words = checkpointWords(g, phone)
  // An admin can't start drafting: no start button, a View only chip, and the line says why.
  if (g.canStart || !words.action || !['start', 'greyed'].includes(words.action.kind))
    return { ...words, line: [words.line, words.note].filter(Boolean).join(' ') }
  return { ...words, line: `${words.line} ${VIEW_ONLY_NOTE}`, action: { kind: 'view_only' } }
}

// The words for each checkpoint, worded with Impeccable clarify: each line reads as one
// flowing sentence where it can, never a clipped one tacked on ("Then you can draft.").
// Lines that speak to the engineer ("your input") have a
// viewer's version for an admin watching someone else's assessment (`!g.canStart`).
// `note` is a sentence only someone who can start drafting needs.
function checkpointWords(g: GenerationDto, phone: boolean): HeaderWords & { note?: string } {
  const part = (id: string) => g.parts.find((p) => p.id === id) as GenerationPart
  const you = g.canStart
  const c = g.checkpoint
  switch (c.kind) {
    case 'needs_observations': {
      const n = c.sections.length
      return {
        tone: 'warn',
        icon: 'circle-alert',
        busy: false,
        title: `${plural(n, 'section')} ${n === 1 ? 'needs' : 'need'} observations`,
        line: you
          ? `Add at least 1 observation to ${sectionList(c.sections)}, then you can start drafting.`
          : `Drafting can start once ${sectionList(c.sections)} ${n === 1 ? 'has' : 'have'} at least 1 observation.`,
        action: { kind: 'observations' },
      }
    }
    case 'transcribing': {
      const one = c.recordings === 1
      return {
        tone: 'ai',
        icon: 'mic',
        busy: true,
        title: `Transcribing ${plural(c.recordings, 'recording')}`,
        line: `${you ? 'You can start drafting' : 'Drafting can start'} once ${one ? 'it finishes' : 'they finish'}, so ${one ? 'its' : 'their'} observations are included.`,
        action: {
          kind: 'greyed',
          label: `Draft ${plural(c.parts.length, 'section')}`,
          icon: 'sparkles',
        },
      }
    }
    case 'ready': {
      const start = {
        kind: 'start',
        label: `Draft ${plural(c.parts.length, 'section')}`,
        icon: 'sparkles',
      } as const
      if (c.step === 1)
        return {
          tone: 'ai',
          icon: 'sparkles',
          busy: false,
          title: 'Ready to draft from observations',
          line: `Each of the ${c.parts.length} sections has at least 1 observation.`,
          note: phone
            ? 'Drafting takes a few minutes.'
            : 'Drafting runs in the background and takes a few minutes.',
          action: start,
        }
      return {
        tone: 'ai',
        icon: 'sparkles',
        busy: false,
        title: 'Ready to draft from your input',
        line: readyFromInput(c.parts, part, you),
        action: start,
      }
    }
    case 'drafting':
      return {
        tone: 'ai',
        icon: 'sparkles',
        busy: true,
        title: `Drafting ${plural(c.parts.length, 'section')}`,
        line:
          c.parts.includes('2') && c.parts.length > 1
            ? 'Drafting takes a few minutes, and Section 2 is drafted last because it summarises the other sections.'
            : !you
              ? 'Drafting takes a few minutes, and this page updates as each section is drafted.'
              : phone
                ? "Drafting takes a few minutes, and the bell will tell you when it's done."
                : "Drafting takes a few minutes, so you can leave this page and the bell will tell you when it's done.",
        action: null,
      }
    case 'failed':
      return {
        tone: 'bad',
        icon: 'circle-alert',
        busy: false,
        title:
          c.failed.length === 1
            ? `Section ${c.failed[0]} was not drafted`
            : `${sectionList(c.failed)} were not drafted`,
        line: failedLine(g, c.failed, part),
        action: { kind: 'start', label: 'Try again', icon: 'rotate-ccw' },
      }
    case 'input_needed':
      return you
        ? {
            tone: 'you',
            icon: 'user',
            busy: false,
            title: 'Your input is needed',
            line: 'Accept at least 1 OFI and enter the figures for Sections 4 and 5. The last 3 sections are drafted from them.',
            action: { kind: 'review' },
          }
        : {
            tone: 'you',
            icon: 'user',
            busy: false,
            title: "Waiting for the engineer's input",
            line: 'The assigned engineer accepts at least 1 OFI and enters the figures for Sections 4 and 5. The last 3 sections are drafted from them.',
            action: { kind: 'review' },
          }
    case 'drafted':
      return {
        tone: 'ok',
        icon: 'file-text',
        busy: false,
        title: 'Report drafted',
        line: you
          ? `All ${g.parts.length} sections are drafted and ready for you to review before you export the report.`
          : `All ${g.parts.length} sections are drafted and ready for the assigned engineer to review before the report is exported.`,
        action: { kind: 'review' },
      }
    case 'out_of_date': {
      const n = c.parts.length
      return {
        tone: 'warn',
        icon: 'repeat',
        busy: false,
        title: `${plural(n, 'section')} ${n === 1 ? 'is' : 'are'} out of date`,
        line: outOfDateLine(c.parts, part),
        note: 'Redrafting keeps the findings you accepted.',
        action: { kind: 'start', label: `Redraft ${plural(n, 'section')}`, icon: 'sparkles' },
      }
    }
  }
}

// Ready for step 3. With a section out of date: "Section 7 is also redrafted, because its
// observations changed after it was drafted." ("Also", not "first": Sections 4 and 5 don't read
// Section 7, so they draft alongside it; only Section 2 waits for the rest.) Without (no board; worded with clarify): what the
// engineer's input unlocks, and that Section 2 comes last.
function readyFromInput(parts: string[], part: (id: string) => GenerationPart, you: boolean) {
  const stale = parts.filter((id) => part(id).outOfDate)
  if (stale.length === 1) {
    const o = part(stale[0]).outOfDate as OutOfDate
    const what = o.why === 'section' ? 'inputs' : WHAT[o.why]
    return `Section ${stale[0]} is also redrafted, because its ${what} changed after it was drafted.`
  }
  if (stale.length > 1)
    return `${sectionList(stale)} are also redrafted, because their inputs changed after they were drafted.`
  const rest = parts.filter((id) => id !== '2')
  const input = you ? 'Your input' : "The engineer's input"
  return parts.includes('2') && rest.length
    ? `${input} is in, so ${sectionList(rest)} can be drafted, then Section 2.`
    : `${input} is in, so ${sectionList(parts)} can be drafted.`
}

// A failed drafting run: how often it was tried, and what did get drafted in that step.
// Several failed, or a failure in step 3, have no board; worded with clarify in the same voice.
function failedLine(g: GenerationDto, failed: string[], part: (id: string) => GenerationPart) {
  const attempts = Math.max(...failed.map((id) => part(id).attempts))
  const tried = `${failed.length === 1 ? 'Drafting' : 'Each'} failed ${plural(attempts, 'time')}`
  const rows = part(failed[0]).step === 1 ? g.steps.one.parts : g.steps.three.parts
  const others = rows.filter((id) => !failed.includes(id) && part(id).drafted)
  if (!others.length) return `${tried}.`
  // One other section is named: "The other 1 section" reads badly.
  if (others.length === 1)
    return `${tried}, but Section ${others[0]} is drafted and ready in Review.`
  return `${tried}, but the other ${others.length} sections are drafted and ready in Review.`
}

// Why the drafted report is out of date: "Section 7's observations changed, so Section 2 needs
// redrafting too." Section 2 is out of date because a section it summarises changed.
function outOfDateLine(parts: string[], part: (id: string) => GenerationPart) {
  const causes = parts.filter((id) => part(id).outOfDate?.why !== 'section')
  const followers = parts.filter((id) => part(id).outOfDate?.why === 'section')
  if (!causes.length) {
    const o = part(followers[0]).outOfDate as Extract<OutOfDate, { why: 'section' }>
    return `Section ${followers[0]} needs redrafting because ${changedSections(o)} changed.`
  }
  const one = part(causes[0]).outOfDate
  const cause =
    causes.length === 1 && one && one.why !== 'section'
      ? `Section ${causes[0]}'s ${WHAT[one.why]} changed`
      : `The inputs of ${sectionList(causes)} changed`
  return followers.length
    ? `${cause}, so ${sectionList(followers)} needs redrafting too.`
    : `${cause}.`
}
