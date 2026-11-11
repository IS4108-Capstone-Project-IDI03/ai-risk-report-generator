// The messages for an assessment's stage (AS-06 "Items per stage"): its
// questions, next step and gaps, and Capture's checklist by area and
// survey-passed question (AC 4, AC 5). Called by messages.ts.
import { daysBetween, inDays, longDay, weekdayName } from './dates'
import { listed } from './item'
import { actions, link, message, type MessageInput, type Take } from './message-parts'
import { word } from './phrases'
import type { BriefItem, BriefMessage, MessagePart } from './types'

// The messages for the assessment's stage: its questions, next step and gaps.
export function stageMessages(input: MessageInput, take: Take): BriefMessage[] {
  const { stage, facts: f, today } = input
  const out: BriefMessage[] = []
  const gaps = (
    key: string,
    text: string,
    pick: (i: BriefItem) => boolean,
    extra: MessagePart[] = [],
  ) => {
    const found = take((i) => i.weight !== 'reminder' && !i.kind.startsWith('coverage-') && pick(i))
    if (found.length || extra.length)
      out.push(message(key, text, [...(found.length ? [actions(found)] : []), ...extra]))
  }
  if (stage === 'setup') {
    gaps('setup-gaps', 'A few details are still missing:', (i) => i.kind === 'setup-details')
    out.push(
      message(
        'setup-question',
        "Anything more to add, like client documents or details still to come? If not, I'll move this on to Prepare.",
        [
          {
            type: 'replies',
            replies: [
              { id: 'nothing-more', label: 'Nothing more to add', primary: true, picksDate: false },
            ],
          },
        ],
        'question',
      ),
    )
  }
  if (stage === 'setup' || stage === 'prepare') {
    const [read] = take((i) => i.kind === 'checklist-read')
    if (read) {
      const left = daysBetween(today, String(read.facts.survey))
      const when = inDays(left, word)
      out.push(
        read.weight === 'info'
          ? message(
              'checklist-ready',
              `The survey is ${when} and you've read the checklist, so you're set.`,
              [],
              'success',
            )
          : message(
              'checklist-read',
              `The survey is ${when}. Have a read through the checklist before you go.`,
              [link('Open checklist', 'checklist', 'list-checks')],
            ),
      )
    }
    if (stage === 'prepare')
      gaps(
        'prepare-gaps',
        'Before the survey:',
        (i) => i.stage === 'prepare' || i.stage === 'any',
        f.hasChecklist ? [] : [link('Open checklist', 'checklist', 'list-checks')],
      )
    // The survey passed with nothing captured: another visit, or capture is done (AC 5).
    if (!f.captureStarted && f.surveyEnd && f.surveyEnd < today)
      out.push(
        visitQuestion(
          `Nothing is captured from the survey on ${longDay(f.surveyEnd)}. Is that everything, or do you need another visit?`,
        ),
      )
  }
  if (stage === 'capture') out.push(...captureMessages(input, take))
  if (stage === 'ready_for_generation') {
    gaps('ready-gaps', 'Before you generate:', () => true)
    out.push(
      message(
        'generate-question',
        'Ready to generate your report?',
        [link('Open Generation', 'generate', 'sparkles')],
        'question',
      ),
    )
  }
  if (stage === 'generate')
    gaps('generate-gaps', "Here's what's left on Generation:", () => true, [
      link('Open Generation', 'generate', 'sparkles'),
    ])
  if (stage === 'review') {
    const next =
      input.sections.find((s) => s.state === 'decisions') ??
      input.sections.find((s) => s.state === 'not_started' && s.date)
    out.push(
      message('outline', "Here's the report as it stands:", [
        { type: 'outline' },
        ...(next
          ? [link(`Continue ${next.title}`, 'review', 'chevron-right', { section: next.sectionId })]
          : []),
      ]),
    )
    gaps('review-gaps', 'Still open in review:', (i) => i.kind === 'review-items')
  }
  // Once ready to export or exported, work that reopens comes in order: regenerate, then review, then export.
  const reopened = stage === 'ready_to_export' || stage === 'exported'
  if (reopened) {
    gaps(
      'regenerate-gaps',
      'Some drafts are out of date. Draft them again first:',
      (i) => i.kind === 'out-of-date',
    )
    gaps('review-gaps', 'Still open in review:', (i) => i.kind === 'review-items')
  }
  const blocked = out.some(
    (m) => m.id.startsWith('regenerate-gaps') || m.id.startsWith('review-gaps'),
  )
  if (stage === 'ready_to_export' && !blocked)
    out.push(
      message(
        'export-ready',
        "Everything is reviewed, so it's ready to export.",
        [link('Open Export', 'export', 'download')],
        'success',
      ),
    )
  if (stage === 'exported') {
    const [stale] = take((i) => i.kind === 'stale-export')
    if (stale && input.exportAgain === stale.fingerprint)
      out.push(
        message('export-again', 'The newer version is ready to go from the Export tab.', [
          link('Open Export', 'export', 'download'),
        ]),
      )
    else if (stale)
      out.push(
        message(
          'stale-export',
          `One thing has changed since then: ${stale.detail}, so the copy you sent is a version behind. Want to export the newer one?`,
          [
            {
              type: 'replies',
              replies: [
                { id: 'export-again', label: 'Export again', primary: true, picksDate: false },
                { id: 'not-now', label: 'Not now', primary: false, picksDate: false },
              ],
            },
          ],
          'question',
        ),
      )
    gaps('export-gaps', 'Before you export again:', (i) => i.kind !== 'report-due')
  }
  return out
}

// Capture: the checklist by area, other capture gaps, and the survey-passed question (AC 5).
function captureMessages(input: MessageInput, take: Take): BriefMessage[] {
  const { facts: f, today, areas } = input
  const out: BriefMessage[] = []
  // The health bars stand for the area items.
  take((i) => i.kind === 'area-gaps')
  if (areas.length) {
    const thin = areas.filter((a) => a.thin)
    const said = thin
      .slice(0, 3)
      .map((a) =>
        a.covered ? `${a.area} is at ${a.covered} of ${a.total}` : `${a.area} has nothing yet`,
      )
    const push = f.anotherVisit
      ? ''
      : thin.length
        ? ` ${listed(said)}, so cover ${thin.length === 1 ? 'that' : 'those'} if you can.`
        : ' Every area has something recorded.'
    out.push(
      message('health', `Here's the checklist by area.${push}`, [
        { type: 'health', areas: [] },
        link('Add observation', 'observations', 'plus'),
      ]),
    )
  }
  const tidy = take(
    (i) =>
      i.weight === 'gap' &&
      (i.stage === 'capture' || i.stage === 'any') &&
      !i.kind.startsWith('coverage-'),
  )
  if (tidy.length) out.push(message('capture-gaps', 'A few things to tidy up:', [actions(tidy)]))
  const end = f.surveyEnd
  if (f.anotherVisit && end && end >= today)
    out.push(
      message(
        'visit-set',
        `The survey ends on ${longDay(end)}. I'll keep ${f.site} in Capture until then and hold off on capture gaps.`,
      ),
    )
  else if (end && end < today)
    out.push(
      visitQuestion(
        f.anotherVisit
          ? `How did ${weekdayName(end)} go? If that's everything now, I'll move this on to generation.`
          : 'Is that everything from site, or do you need another visit?',
      ),
    )
  return out
}

// The survey-passed question: capture is done, or another visit on a day picked (AC 5).
function visitQuestion(text: string): BriefMessage {
  return message(
    'visit-question',
    text,
    [
      {
        type: 'replies',
        replies: [
          { id: 'ready-to-generate', label: "That's everything", primary: true, picksDate: false },
          { id: 'another-visit', label: 'I need another visit', primary: false, picksDate: true },
        ],
      },
    ],
    'question',
  )
}
