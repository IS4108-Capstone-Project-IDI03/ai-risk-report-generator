// MarshBot's template words (AS-06): number words, the greeting, and one
// sentence per Fix now item. Called by messages.ts. Plain, short English:
// no repeated status words, nothing cute or edgy.
import { daysBetween, longDay, partOfDay } from './dates'
import { listed } from './item'
import { STAGE_LABELS } from './stage'
import type { BriefItem, Stage } from './types'

const WORDS = ['no', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine']

/** Returns "two" for 2, or the digits from 10 up. */
export const word = (n: number) => WORDS[n] ?? String(n)
/** Returns "Two things" or "One thing". */
export const things = (n: number, what = 'thing') => {
  const w = word(n)
  return `${w[0].toUpperCase()}${w.slice(1)} ${what}${n === 1 ? '' : 's'}`
}
/** Returns the first word of a name. */
export const firstName = (name: string) => name.trim().split(/\s+/)[0] ?? name

// The facts the greeting and questions are written from (saved on the brief by recheck.service.ts).
export type BriefFacts = {
  site: string
  client: { id: string | null; name: string; reference: string }
  engineerName: string | null
  observations: number
  surveyStart: string | null
  surveyEnd: string | null
  reportDue: string | null
  anotherVisit: boolean
  allDrafted: boolean
  draftedParts: number
  stageDates: Record<Stage, string | null>
  exportedAt: string | null
  exportDay: string | null
  exportFile: { fileName: string; pages: number | null } | null
  hasChecklist: boolean
  evidenceFingerprint: string
  captureStarted: boolean
  categorisedObservations: number
}

const days = (n: number) => `${word(n)} day${n === 1 ? '' : 's'}`

/**
 * Returns the engineer's greeting line for the stage, with how many things to
 * fix first. `reopened`: review work came back after it was ready to export.
 */
export function greeting(
  stage: Stage,
  f: BriefFacts,
  first: string,
  now: Date,
  fixNow: number,
  reviewed: number,
  reopened = false,
): string {
  const hello = `${partOfDay(now)}, ${first}.`
  const fix = fixNow ? ` ${things(fixNow)} to fix first.` : ''
  const n = f.observations
  const line: Record<Stage, string> = {
    setup: `${f.site} is new, so let's get it ready.`,
    prepare: f.surveyStart
      ? `${f.site} is in Prepare, with the survey on ${longDay(f.surveyStart)}.`
      : `${f.site} is in Prepare.`,
    capture: n
      ? `${f.site} is in Capture, with ${n} observation${n === 1 ? '' : 's'} so far.`
      : `${f.site} is in Capture. Nothing is recorded yet.`,
    ready_for_generation: `Capture on ${f.site} is done, so it's ready for generation.`,
    generate: `${f.site} is in Generate, with ${f.draftedParts} of 11 parts drafted.`,
    review: f.allDrafted
      ? `Every part of the report is drafted, so we're into review. ${reviewed} of 11 sections are reviewed.`
      : `${f.site} is in Review. ${reviewed} of 11 sections are reviewed.`,
    ready_to_export: reopened
      ? `${f.site} was ready to export, but some of it needs another look.`
      : 'The report is reviewed and ready to export.',
    exported: '',
  }
  if (stage === 'exported') return `Nice work, ${first}. ${exportedLine(f)}${fix}`
  return `${hello} ${line[stage]}${fix}`
}

// "The report went out on 9 Dec 2026, nine days before it was due."
function exportedLine(f: BriefFacts): string {
  if (!f.exportDay) return 'The report went out.'
  const out = `The report went out on ${longDay(f.exportDay)}`
  if (!f.reportDue) return `${out}.`
  const early = daysBetween(f.exportDay, f.reportDue)
  if (early === 0) return `${out}, on the day it was due.`
  return early > 0
    ? `${out}, ${days(early)} before it was due.`
    : `${out}, ${days(-early)} after it was due.`
}

/** Returns the line for "since you were last here": what got sorted, and a stage move. */
export function sinceLastTime(resolved: BriefItem[], movedTo: Stage | null): string | null {
  const names = [...new Set(resolved.map((i) => i.title))]
  const shown = names.length > 3 ? [...names.slice(0, 2), `${word(names.length - 2)} more`] : names
  const sorted = names.length
    ? `Since you were last here, ${listed(shown)} ${names.length === 1 ? 'is' : 'are'} sorted.`
    : ''
  const moved = movedTo
    ? `${sorted ? ' It' : 'Since you were last here, it'} moved on to ${STAGE_LABELS[movedTo]}.`
    : ''
  return sorted || moved ? `${sorted}${moved}` : null
}

/** Returns one plain sentence for a Fix now item: its fact, with what to do where that helps. */
export function fixSentence(item: BriefItem): string {
  const proposed = Number(item.facts.proposed ?? 0)
  if (item.id.startsWith('walk.ready:'))
    return `${item.title} is ready to review as ${proposed} proposed observation${proposed === 1 ? '' : 's'}; create the ones you're happy with.`
  const retry = ['failed-recording', 'failed-page', 'site-walks'].includes(item.kind)
  return retry ? `${item.fact} A retry usually sorts that out.` : item.fact
}
