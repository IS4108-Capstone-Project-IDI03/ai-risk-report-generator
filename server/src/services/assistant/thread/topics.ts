// Which topics MarshBot raises in each stage, in order (AS-06 round 5, P2
// scenario map), and "Also worth a look" for anything no topic speaks for.
// Called by advance.ts and view.ts. Builders are in tasks.ts, topics-capture.ts
// and topics-report.ts.
import type { BriefItem, Stage } from '../types'
import { count, itemRow, pill } from './cards'
import { isTask, todoTopic } from './tasks'
import {
  allClearTopic,
  beforeSurveyTopic,
  BEFORE_SURVEY_KINDS,
  checklistTopic,
  CHECKLIST_KINDS,
  gapsTopic,
  GAPS_KINDS,
  setupTopic,
  SETUP_KINDS,
  tidyTopic,
  TIDY_KINDS,
  visitQuestionTopic,
  visitSetTopic,
  VISIT_KINDS,
} from './topics-capture'
import {
  beforeGenerateTopic,
  BLOCKER_KINDS,
  draftAgainTopic,
  DRAFT_AGAIN_KINDS,
  EXPORTED_KINDS,
  exportedTopic,
  exportReadyTopic,
  outlineTopic,
  OUTLINE_KINDS,
  readyTopic,
  remindersTopic,
  REMINDER_KINDS,
  sectionsTopic,
  SECTIONS_KINDS,
} from './topics-report'
import type { Built, TopicCtx, TopicDef } from './types'

const none = () => false

// "rest" is last in each list but before a closing question, so the question is what waits.
export const STAGE_TOPICS: Record<Stage, string[]> = {
  setup: ['todo', 'rest', 'setup'],
  prepare: ['todo', 'before-survey', 'rest', 'visit-question'],
  capture: [
    'todo',
    'checklist',
    'tidy',
    'gaps',
    'rest',
    'visit-question',
    'visit-set',
    'all-clear',
  ],
  ready_for_generation: ['todo', 'before-generate', 'ready', 'rest'],
  generate: ['todo', 'sections', 'rest'],
  review: ['todo', 'outline', 'reminders', 'rest'],
  ready_to_export: ['todo', 'draft-again', 'outline', 'export-ready', 'rest'],
  exported: ['todo', 'draft-again', 'exported', 'rest'],
}

// The report date is a sentence in the greeting, never a row (P2 "Any").
const unspoken = (i: BriefItem) => i.kind === 'report-due'

/** Also worth a look: open gaps and notes that no topic of this stage speaks for. */
function restTopic(ctx: TopicCtx): Built | null {
  const claimed = STAGE_TOPICS[ctx.brief.stage]
    .filter((k) => k !== 'rest')
    .map((k) => DEFS[k].claims)
  const items = ctx.open.filter(
    (i) =>
      (i.weight === 'gap' || i.weight === 'info') &&
      !unspoken(i) &&
      !claimed.some((claims) => claims(i)),
  )
  if (!items.length) return null
  return {
    kind: 'info',
    says: [{ text: 'A few more things worth a look when you have a moment.', tone: 'normal' }],
    cards: [
      {
        type: 'rows',
        id: 'rest',
        title: 'Also Worth a Look',
        note: null,
        rows: items.map(itemRow),
        ticks: [],
        cta: null,
      },
    ],
    mood: 'idle',
    status: {
      text: pill(`${count(items.length, 'thing')} to look at`, `${items.length} to look at`),
      tone: 'amber',
      icon: 'list-checks',
    },
  }
}

const def = (build: TopicDef['build'], claims: TopicDef['claims'] = none): TopicDef => ({
  build,
  claims,
})

/** Every topic by key; a turn's `topic` names one of these when its cards are rebuilt. */
export const DEFS: Record<string, TopicDef> = {
  todo: def((ctx, items) => todoTopic(ctx, items), isTask),
  setup: def(setupTopic, SETUP_KINDS),
  'before-survey': def(beforeSurveyTopic, BEFORE_SURVEY_KINDS),
  'visit-question': def(visitQuestionTopic, VISIT_KINDS),
  'visit-set': def(visitSetTopic),
  checklist: def(checklistTopic, CHECKLIST_KINDS),
  tidy: def(tidyTopic, TIDY_KINDS),
  gaps: def(gapsTopic, GAPS_KINDS),
  'all-clear': def(allClearTopic),
  'before-generate': def(beforeGenerateTopic, BLOCKER_KINDS),
  ready: def(readyTopic, BLOCKER_KINDS),
  sections: def(sectionsTopic, SECTIONS_KINDS),
  outline: def(outlineTopic, OUTLINE_KINDS),
  reminders: def(remindersTopic, REMINDER_KINDS),
  'draft-again': def(draftAgainTopic, DRAFT_AGAIN_KINDS),
  'export-ready': def(exportReadyTopic),
  exported: def(exportedTopic, EXPORTED_KINDS),
  rest: def(restTopic),
}
