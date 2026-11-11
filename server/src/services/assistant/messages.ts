// What MarshBot says (AS-06): the ordered messages built by template from the
// stage, the open items, the areas and the sections. The wording AI may later
// reword each one (wording.service.ts); these words are the fallback.
// Called by brief.service.ts (per viewer) and recheck.service.ts (for wording).
import { longDay } from './dates'
import { actions, message, type MessageInput } from './message-parts'
import { fixSentence, firstName, greeting, sinceLastTime, things, word } from './phrases'
import { STAGE_LABELS } from './stage'
import { stageMessages } from './stage-messages'
import type { BriefItem, BriefMessage } from './types'

export const COVERAGE_FAILED =
  "I couldn't check coverage just now. Everything else above is up to date, and I'll try again in a few minutes."

// Item kinds that reopen a report that was ready to export (stage-messages.ts says them in this order).
const REOPENED = ['out-of-date', 'review-items']

/** Returns the messages for this viewer, in the order MarshBot says them. */
export function buildMessages(input: MessageInput): BriefMessage[] {
  return input.role === 'admin' ? adminMessages(input) : engineerMessages(input)
}

function engineerMessages(input: MessageInput): BriefMessage[] {
  const { stage, facts: f, items } = input
  const first = firstName(input.viewerName)
  const out: BriefMessage[] = []
  const used = new Set<string>()
  // Items not yet said, matching `pick`; taking them marks them said.
  const take = (pick: (i: BriefItem) => boolean) => {
    const found = items.filter((i) => !used.has(i.id) && pick(i))
    found.forEach((i) => used.add(i.id))
    return found
  }
  const reviewed = input.sections.filter((s) => s.state === 'reviewed').length
  const isCoverage = (i: BriefItem) => i.kind.startsWith('coverage-')

  // 1. Greeting, with how many things to fix first.
  const fixNow = take((i) => i.weight === 'fix_now')
  out.push(
    message(
      'greeting',
      greeting(
        stage,
        f,
        first,
        input.now,
        fixNow.length,
        reviewed,
        items.some((i) => REOPENED.includes(i.kind)),
      ),
      stage === 'exported' && f.exportFile ? [{ type: 'file' }] : [],
      stage === 'exported' ? 'success' : 'normal',
    ),
  )

  // 2. What changed since the last visit (AC 9).
  const since = sinceLastTime(input.resolvedSince, input.movedSince ? stage : null)
  if (since) out.push(message('since', since))

  // 3. Fix now, with the rows to act on.
  if (fixNow.length)
    out.push(message('fix-now', fixNow.map(fixSentence).join(' '), [actions(fixNow)]))

  // 4. The stage's own messages.
  out.push(...stageMessages(input, take))

  // 5. Anything else open, then reminders from the engineer's activity.
  const rest = take((i) => (i.weight === 'gap' || i.weight === 'info') && !isCoverage(i))
  if (rest.length) out.push(message('rest', 'Also worth a look:', [actions(rest)]))
  const reminders = take((i) => i.weight === 'reminder')
  if (reminders.length)
    out.push(
      message(
        'reminders',
        `${things(reminders.length, 'small thing')} I noticed while you were away:`,
        [actions(reminders)],
      ),
    )

  // 6. The coverage check, after the rest (AC 7).
  const coverage = take(isCoverage)
  if (input.coverage === 'failed') out.push(message('coverage-failed', COVERAGE_FAILED))
  else if (coverage.length)
    out.push(
      message(
        'coverage',
        'I checked what your observations cover against the checklist. These look thin:',
        [actions(coverage)],
      ),
    )

  // 7. Nothing left to fix or fill: one quiet line.
  if (
    !items.some((i) => i.weight === 'fix_now' || i.weight === 'gap') &&
    input.coverage !== 'running' &&
    // A question still waiting for its answer isn't "everything".
    !out.some((m) => m.tone === 'question')
  )
    out.push(message('done', "That's everything. You're all caught up.", [], 'success'))
  return out
}

// An admin (AC 11): stage and progress only, nothing from the engineer's activity.
function adminMessages(input: MessageInput): BriefMessage[] {
  const { facts: f, sections, stage, today } = input
  const reviewed = sections.filter((s) => s.state === 'reviewed').length
  const progress = [
    sections.length
      ? `${reviewed} of ${sections.length} sections are reviewed`
      : stage === 'capture'
        ? `${f.observations} observation${f.observations === 1 ? '' : 's'} so far`
        : null,
    f.reportDue
      ? `the report ${f.reportDue < today ? 'was' : 'is'} due on ${longDay(f.reportDue)}`
      : null,
  ].filter((p): p is string => !!p)
  const owner = f.engineerName ? `This one is ${f.engineerName}'s. ` : ''
  const commented = [...sections].sort((a, b) => b.openComments - a.openComments)[0]
  const comments = commented?.openComments
    ? ` ${commented.title} has ${word(commented.openComments)} open comment${commented.openComments === 1 ? '' : 's'}.`
    : ''
  const label = stage === 'exported' ? 'exported' : `in ${STAGE_LABELS[stage].toLowerCase()}`
  const text = `Hi ${firstName(input.viewerName)}. ${owner}It's ${label}${progress.length ? `: ${progress.join(', and ')}` : ''}.${comments}`
  return [
    message('admin-greeting', text),
    sections.length
      ? message('admin-lanes', "Here's where each section stands:", [
          { type: 'lanes' },
          { type: 'stage-time' },
        ])
      : message('admin-stages', "Here's the time in each stage so far:", [{ type: 'stage-time' }]),
  ]
}
