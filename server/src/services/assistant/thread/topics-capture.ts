// MarshBot's topics before the report (AS-06 rounds 5-6, canvas S1, S2, C4-C6,
// C9, C13): setup details, before the survey, the checklist, things to tidy,
// coverage gaps, the survey-day question and the all clear. Each builder
// returns the topic, or null when it has nothing to say. Card and row titles
// are Title Case, words are sentences (round 6). Called by topics.ts.
import { longDay, shortDay, weekdayName } from '../dates'
import type { AreaHealth, CardRow, Reply, Say } from '../types'
import { andList, areaIcon, count, itemRow, kinds, opens, row, tick, tickRow } from './cards'
import type { Built, TopicCtx } from './types'

const QUESTION = { text: '1 question for you', tone: 'blue', icon: 'message-square' } as const

/** Returns the checklist's answered and total counts across its areas. */
export function answered(areas: AreaHealth[]) {
  return areas.reduce(
    (sum, a) => ({ covered: sum.covered + a.covered, total: sum.total + a.total }),
    { covered: 0, total: 0 },
  )
}

export const SETUP_KINDS = kinds('setup-details')

// The Setup details checks/setup-details.ts raises, each with its value once set. Each keeps one
// row with its item id, so the row ticks in place with the real value instead of keeping
// "Not set" beside a tick (round 9, item B).
const setupDetails = (f: TopicCtx['facts']) => [
  {
    id: 'setup.report-due',
    icon: 'calendar',
    title: 'Report Due Date',
    value: f.reportDue ? longDay(f.reportDue) : 'Set',
  },
  {
    id: 'setup.site-contacts',
    icon: 'users',
    title: 'Site Contacts',
    // A brief saved before round 9 has no contact count.
    value: f.siteContacts ? count(f.siteContacts, 'contact') : 'Added',
  },
  {
    id: 'setup.client-documents',
    icon: 'file-text',
    title: 'Client Documents',
    value: `${f.documents ?? 0} uploaded`,
  },
]

/** Setup (S1): every detail as a row (missing in amber, set ticked), then the question as its own bubble. */
export function setupTopic(ctx: TopicCtx): Built {
  const f = ctx.facts
  const missing = ctx.open.filter(SETUP_KINDS)
  const rows = setupDetails(f).map((d) => {
    const open = missing.find((i) => i.id === d.id)
    return open
      ? row(
          d.id,
          open.icon,
          'amber',
          open.title,
          d.id === 'setup.report-due' ? 'Not set' : 'None yet',
          opens(open.link!),
        )
      : tickRow(d.id, d.icon, d.title, d.value)
  })
  const ticks = [
    tick('Site', f.site),
    ...(f.surveyStart ? [tick('Survey Date', longDay(f.surveyStart))] : []),
    ...(f.engineerName ? [tick('Engineer', f.engineerName)] : []),
  ]
  const n = missing.length
  // Nothing missing: MarshBot says so and asks to move on (round 9, item D); the stage still
  // moves only on the choice.
  const reply: Reply = n
    ? {
        id: 'nothing-more',
        label: 'Nothing more to add',
        primary: true,
        picksDate: false,
        link: null,
      }
    : { id: 'to-prepare', label: 'Move on to Prepare', primary: true, picksDate: false, link: null }
  return {
    kind: 'question',
    says: n
      ? [
          {
            text: n === 1 ? '1 detail is still missing.' : `${n} details are still missing.`,
            tone: 'lead',
          },
          {
            text:
              n === 1
                ? "It doesn't stop you, but it makes the report easier later."
                : 'None of them stop you, but they make the report easier later.',
            tone: 'normal',
          },
        ]
      : [{ text: 'Every Setup detail is in.', tone: 'good' }],
    cards: [
      {
        type: 'rows',
        id: 'setup',
        title: 'Setup',
        note: `${ticks.length + rows.length - n} of ${ticks.length + rows.length} set`,
        rows,
        ticks,
        cta: null,
      },
    ],
    after: [
      {
        text: n
          ? "Anything more to add, or still to come from the client? If not, I'll move this on to Prepare."
          : SETUP_DONE_QUESTION,
        tone: 'normal',
      },
    ],
    replies: [reply],
    mood: n ? 'idle' : 'pleased',
    status: n ? { text: `${count(n, 'detail')} missing`, tone: 'amber', icon: 'info' } : QUESTION,
  }
}

/** The question once every Setup detail is in (round 9, item D). */
export const SETUP_DONE_QUESTION = 'Ready to move on to Prepare?'

export const BEFORE_SURVEY_KINDS = kinds(
  'checklist-read',
  'new-standard',
  'checklist-missing',
  'uncited-items',
)
/**
 * Before the survey (S2): the checklist to read and anything new in it, done
 * ones ticked. The survey date is the greeting's to say, not repeated here.
 */
export function beforeSurveyTopic(ctx: TopicCtx): Built | null {
  const items = ctx.open.filter(BEFORE_SURVEY_KINDS)
  if (!items.length) return null
  const total = answered(ctx.brief.areas).total
  const rows: CardRow[] = items.map((i) =>
    i.id === 'prepare.checklist-read'
      ? row(
          i.id,
          'list-checks',
          'violet',
          'Site Checklist',
          `${count(total, 'item')} · not read yet`,
          opens(i.link!),
        )
      : i.id === 'prepare.checklist-ready'
        ? // The unread row's id: one Site Checklist row that ticks in place (round 9, item 8).
          tickRow('prepare.checklist-read', 'list-checks', 'Site Checklist', 'Read through')
        : i.kind === 'new-standard'
          ? row(
              i.id,
              'book-open',
              'amber',
              `New Standard: ${i.title}`,
              'Added after the checklist was built',
              opens(i.link!),
            )
          : i.kind === 'checklist-missing'
            ? row(i.id, 'list-checks', 'amber', 'Checklist', 'Not made yet', opens(i.link!))
            : itemRow(i),
  )
  if (ctx.facts.documents)
    rows.push(tickRow('documents', 'files', 'Client Documents', `${ctx.facts.documents} uploaded`))
  const left = rows.filter((r) => r.end.type !== 'tick').length
  const read = items.some((i) => i.id === 'prepare.checklist-ready')
  const unread = items.some((i) => i.id === 'prepare.checklist-read')
  const others = items.filter((i) => i.kind !== 'checklist-read').length
  const words = [
    unread
      ? 'Have a read through the checklist before the survey, so you know what to look for on site.'
      : '',
    read ? "You've read the checklist, so you're set." : '',
    others
      ? `There ${others === 1 ? 'is' : 'are'}${unread || read ? ' also' : ''} ${count(others, 'thing')} to look at before the survey.`
      : '',
  ].filter(Boolean)
  return {
    kind: 'info',
    // The first sentence is the bold line, unless it only says the checklist is read.
    says: words.map((text, n) => ({ text, tone: n === 0 && !read ? 'lead' : 'normal' })),
    cards: [
      {
        type: 'rows',
        id: 'before-survey',
        title: 'Before the Survey',
        note: `${rows.length - left} of ${rows.length} done`,
        rows,
        ticks: [],
        cta: null,
      },
    ],
    mood: 'idle',
    status: left
      ? { text: `${count(left, 'thing')} to read`, tone: 'blue', icon: 'book-open' }
      : { text: 'Ready for survey', tone: 'green', icon: 'circle-check' },
  }
}

export const CHECKLIST_KINDS = kinds('area-gaps')
/**
 * The checklist (C4): the areas that need more opened up, the rest ticked.
 * After an earlier session it is every area as a bar (H1). Null when no area
 * is thin, except on a rebuild, where the card shows every area ticked.
 */
export function checklistTopic(ctx: TopicCtx): Built | null {
  const areas = ctx.brief.areas
  const thin = areas.filter((a) => a.thin)
  if (!areas.length || (!thin.length && !ctx.rebuild)) return null
  const fine = areas.filter((a) => !a.thin)
  const { covered, total } = answered(areas)
  const link = (area: string) => ({ tab: 'checklist' as const, params: { area } })
  const unanswered = areas.filter((a) => a.covered < a.total)
  const clauses = thin.map((a) =>
    a.covered ? `${a.area} is only at ${a.covered} of ${a.total}` : `${a.area} has nothing yet`,
  )
  const need = thin.length === 1 ? '1 needs' : `${thin.length} need`
  const text = ctx.catchUp
    ? // The noun and the numbers each needs: they are checklist areas, never "sections" (round 9, H).
      // Every area with an item still open, not only the thin ones, so the count is true (item 6).
      `${count(unanswered.length, 'checklist area')} still ${unanswered.length === 1 ? 'has' : 'have'} unanswered checklist items: ${andList(unanswered.map((a) => `${a.total - a.covered} in ${a.area}`))}.`
    : `I've lined your ${count(ctx.facts.observations, 'observation')} up against this site's checklist. ${
        fine.length
          ? `${count(fine.length, 'area is', 'areas are')} in good shape, but ${need} more before you leave: `
          : `${thin.length === 1 ? '1 area needs' : `All ${thin.length} areas need`} more before you leave: `
      }${andList(clauses)}. Here's what's still open${thin.length === 1 ? '' : ' in each'}.`
  return {
    kind: 'info',
    says: ctx.catchUp
      ? [{ text, tone: 'lead' }]
      : [
          { text: "Now let's look at what the report still needs.", tone: 'lead' },
          { text, tone: 'normal' },
        ],
    cards: [
      ctx.catchUp
        ? {
            type: 'bars',
            id: 'checklist',
            answered: covered,
            total,
            areas: areas.map((a) => ({
              area: a.area,
              icon: areaIcon(a.area),
              covered: a.covered,
              total: a.total,
              low: a.thin,
              link: link(a.area),
            })),
          }
        : {
            type: 'checklist',
            id: 'checklist',
            answered: covered,
            total,
            gaps: thin.map((a) => ({
              area: a.area,
              icon: areaIcon(a.area),
              tone: a.covered ? ('amber' as const) : ('red' as const),
              covered: a.covered,
              total: a.total,
              items: (a.open ?? []).slice(0, 3).map((o) => o.text),
              more: Math.max(0, (a.open ?? []).length - 3),
              link: link(a.area),
            })),
            fine: fine.map((a) =>
              tick(a.area, `${a.covered} of ${a.total}`, { covered: a.covered, total: a.total }),
            ),
          },
    ],
    mood: 'idle',
    status: thin.length
      ? {
          text: `${count(thin.length, 'area needs', 'areas need')} more`,
          tone: 'amber',
          icon: 'list-checks',
        }
      : { text: 'Checklist covered', tone: 'green', icon: 'circle-check' },
  }
}

export const TIDY_KINDS = kinds('walk-fields', 'blank-page', 'unsure-words', 'uncategorised')
/** To tidy up: proposed observations to complete, blank pages, unsure words, no category. */
export function tidyTopic(ctx: TopicCtx): Built | null {
  const items = ctx.open.filter(TIDY_KINDS)
  if (!items.length) return null
  const n = items.length
  return {
    kind: 'info',
    says: [
      {
        text: `There ${n === 1 ? 'is 1 small thing' : `are ${n} small things`} to tidy up while it's still fresh.`,
        tone: 'lead',
      },
    ],
    cards: [
      {
        type: 'rows',
        id: 'tidy',
        title: 'To Tidy Up',
        note: null,
        rows: items.map(itemRow),
        ticks: [],
        cta: null,
      },
    ],
    mood: 'idle',
    status: { text: `${count(n, 'thing')} to tidy`, tone: 'amber', icon: 'list-checks' },
  }
}

export const GAPS_KINDS = kinds('coverage-uncovered', 'coverage-thin')
export const COVERAGE_FAILED =
  "I tried to read your observations against the checklist, but that check didn't go through just now. Everything above is still up to date. I'll try again in a few minutes and tell you what I find."

/** Returns whether another visit is booked and not yet past, which holds the gaps until then (AC 5). */
export const gapsHeld = (ctx: TopicCtx) =>
  ctx.facts.anotherVisit && !!ctx.facts.surveyEnd && ctx.facts.surveyEnd >= ctx.today

/**
 * Gaps (C5): checklist items no observation mentions, and notes too thin for
 * their section, from the last coverage check that finished (its result is
 * kept even when a later run stopped early). When it found nothing, MarshBot
 * says so in words. Null before any check finished, and while another visit
 * holds the gaps (AC 5).
 */
export function gapsTopic(ctx: TopicCtx, more = false): Built | null {
  if (!ctx.brief.coverage.checkedAt || gapsHeld(ctx)) return null
  const uncovered = new Set(ctx.brief.coverage.uncovered)
  const raised = new Set(
    ctx.open.filter((i) => i.kind === 'coverage-uncovered').map((i) => i.title),
  )
  const missed = ctx.brief.areas.flatMap((a) =>
    raised.has(a.area)
      ? (a.open ?? []).filter((o) => uncovered.has(o.id)).map((o) => ({ ...o, area: a.area }))
      : [],
  )
  const thin = ctx.open.filter((i) => i.kind === 'coverage-thin')
  if (!missed.length && !thin.length) {
    // A rebuild has nothing to redraw: the turn's rows tick in place instead. With
    // nothing open at all, the all clear says "Gaps: None found" instead.
    if (ctx.rebuild || allClearTopic(ctx)) return null
    return {
      kind: 'info',
      says: [
        {
          text: 'I also read your observations against the checklist itself. Every checklist item is mentioned somewhere, and no note is too thin for its section.',
          tone: 'good',
        },
      ],
      cards: [],
      mood: 'pleased',
      status: { text: 'No gaps found', tone: 'green', icon: 'circle-check' },
    }
  }
  // Each card has its own lead-in bubble right before it, then one closing bubble (round 7, items 23-24).
  const leads = [
    missed.length
      ? `${count(missed.length, 'checklist item')} ${missed.length === 1 ? "isn't" : "aren't"} mentioned anywhere yet.`
      : '',
    thin.length
      ? thin.length === 1
        ? '1 observation is too thin to support its section.'
        : `${thin.length} observations are too thin to support their sections.`
      : '',
  ].filter(Boolean)
  // Still on survey day (or before it): the visit question only comes once the day has passed.
  const end = ctx.facts.surveyEnd
  const onSite = ctx.brief.stage === 'capture' && !!end && end >= ctx.today
  // The gaps end the day's topics only when nothing else is left to raise (`more`, from topics.ts):
  // without this check "That's everything" was followed by a "What else?" with more to show.
  const last = onSite && !more
  const says: Say[] = [
    // The first lead-in is the turn's bold line; the second sits between the two cards.
    ...leads.map((text, n) => ({
      text: n ? text : `I also read your observations against the checklist itself, and ${text}`,
      tone: n ? ('normal' as const) : ('lead' as const),
    })),
    {
      text: "None of this blocks you today, but it's quicker to sort out while you're still on site.",
      tone: 'normal',
    },
    // Until the survey day is over the gaps are the last topic: without this line the thread just
    // stopped, with no word on what comes next (the visit question waits for the day to pass).
    ...(last
      ? [
          {
            text: "That's everything from me for now. Once your survey day is over, I'll check in about wrapping up.",
            tone: 'normal' as const,
          },
        ]
      : []),
  ]
  return {
    kind: 'info',
    says,
    order: [
      ...leads.flatMap(() => ['say', 'card'] as const),
      'say',
      ...(last ? (['say'] as const) : []),
    ],
    cards: [
      ...(missed.length
        ? [
            {
              type: 'rows' as const,
              id: 'not-covered',
              title: 'Not Covered',
              note: count(missed.length, 'checklist item'),
              help: 'A row clears once an observation records it, or the checklist item is marked “Not seen” or “Not applicable”.',
              rows: missed.map((o) =>
                row(
                  o.id,
                  areaIcon(o.area),
                  'neutral',
                  o.text,
                  o.area,
                  opens({ tab: 'checklist', params: { item: o.id } }),
                ),
              ),
              ticks: [],
              cta: null,
            },
          ]
        : []),
      ...(thin.length
        ? [
            {
              type: 'rows' as const,
              id: 'thin',
              title: 'Thin',
              note: count(thin.length, 'observation'),
              help: 'A row clears once its note gives a report writer something specific: equipment, numbers, places or conditions.',
              rows: thin.map((i) =>
                row(i.id, i.icon, 'amber', i.title, String(i.facts.reason ?? ''), opens(i.link!)),
              ),
              ticks: [],
              cta: null,
            },
          ]
        : []),
    ],
    mood: 'idle',
    status: {
      text: `${count(missed.length + thin.length, 'gap')} to close`,
      tone: 'amber',
      icon: 'search',
    },
  }
}

/** The coverage check failed (C12): said once, plainly, nothing to press. */
export const coverageFailedTopic = (): Built => ({
  kind: 'info',
  says: [{ text: COVERAGE_FAILED, tone: 'normal' }],
  cards: [],
  mood: 'concerned',
  status: { text: 'Checking again', tone: 'blue', icon: 'clock' },
})

// Another visit, more to add from this one (opens Observations, posts nothing), or done (round 7,
// item 25). The first two have their own icons so they don't look alike (round 9, item K).
const VISIT_REPLIES: Reply[] = [
  {
    id: 'another-visit',
    label: 'Another visit',
    primary: false,
    picksDate: true,
    link: null,
    icon: 'calendar',
  },
  {
    id: 'add-observations',
    label: 'Add observations',
    primary: false,
    picksDate: false,
    link: { tab: 'observations' },
    icon: 'plus',
  },
  {
    id: 'ready-to-generate',
    label: "That's everything",
    primary: true,
    picksDate: false,
    link: null,
  },
]

export const VISIT_KINDS = kinds('survey-passed-empty')
/** The survey-day question (C6, AC 5): that's everything, or another visit. */
export function visitQuestionTopic(ctx: TopicCtx): Built | null {
  const f = ctx.facts
  const end = f.surveyEnd
  if (!end || end >= ctx.today) return null
  const prepare = ctx.brief.stage !== 'capture'
  if (prepare && (f.captureStarted || !ctx.open.some(VISIT_KINDS))) return null
  const says = prepare
    ? [
        `Your survey day was on ${shortDay(end)}, and nothing is captured from it yet.`,
        'Is that everything, or do you need another visit?',
      ]
    : f.anotherVisit
      ? [
          `How did ${weekdayName(end)} go?`,
          "If that's everything now, I'll move this on to generation.",
        ]
      : [
          `Your survey day has passed and you're at ${count(f.observations, 'observation')} now.`,
          'There is just 1 question before I move this on to generation: is that everything from site, with all your observations recorded, or do you need another visit?',
        ]
  return {
    kind: 'question',
    says: says.map((text, n) => ({ text, tone: n ? 'normal' : 'lead' })),
    cards: [],
    replies: VISIT_REPLIES,
    mood: 'idle',
    status: QUESTION,
  }
}

/** Another visit is booked (C9): capture gaps wait until then. */
export function visitSetTopic(ctx: TopicCtx): Built | null {
  const end = ctx.facts.surveyEnd
  if (!ctx.facts.anotherVisit || !end || end < ctx.today) return null
  return {
    kind: 'info',
    says: [
      {
        text: `The survey now ends on ${shortDay(end)}. I'll hold the gaps until you're back from site.`,
        tone: 'normal',
      },
    ],
    cards: [],
    mood: 'idle',
    status: NEXT_VISIT,
  }
}

/** The pill while another visit is booked (at most 18 characters). */
export const NEXT_VISIT = { text: 'Next visit booked', tone: 'blue', icon: 'clock' } as const

/**
 * Nothing open in Capture (C13): what MarshBot would chase, each ticked. The
 * greeting already said where things stand, so the words don't repeat it.
 */
export function allClearTopic(ctx: TopicCtx): Built | null {
  const f = ctx.facts
  const busy = ctx.open.some(
    (i) => (i.weight === 'fix_now' || i.weight === 'gap') && i.kind !== 'report-due',
  )
  if (busy || ctx.brief.coverage.status === 'running') return null
  const { covered, total } = answered(ctx.brief.areas)
  return {
    kind: 'info',
    says: [
      {
        text: "There's nothing for you to chase right now, so you're all caught up. I'll speak up when something changes.",
        tone: 'good',
      },
    ],
    cards: [
      {
        type: 'rows',
        id: 'all-clear',
        title: 'Capture',
        note: 'Nothing open',
        rows: [
          tickRow('walks', 'footprints', 'Site Walks', `${f.walksReviewed ?? 0} reviewed`),
          tickRow('recordings', 'mic', 'Recordings', `${f.recordingsTranscribed ?? 0} transcribed`),
          ...(total
            ? [tickRow('checklist', 'list-checks', 'Checklist', `${covered} of ${total} answered`)]
            : []),
          tickRow('gaps', 'search', 'Gaps', 'None found'),
        ],
        ticks: [],
        cta: null,
      },
    ],
    mood: 'pleased',
    status: { text: 'All caught up', tone: 'green', icon: 'circle-check' },
  }
}
