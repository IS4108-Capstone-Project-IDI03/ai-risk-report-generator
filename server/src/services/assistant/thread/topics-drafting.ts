// MarshBot's next step in the Generate stage (GN-13 rule 12, board 18): the same
// checkpoint Generation's header shows, in MarshBot's words, with the one button
// Generation would offer. In Review and Ready to export it speaks only when a
// checkpoint needs a look (out of date, failed, drafting). Read from the brief's
// `facts.drafting`, which the re-check copies from draftingState
// (generation.service.ts). Called by topics.ts and advance.ts.
import { STEP_ONE_PARTS, type Checkpoint } from '../../generation/types'
import { sectionList } from '../../generation/words'
import type { BriefFacts } from '../phrases'
import type { ItemLink, Say } from '../types'
import { count } from './cards'
import { DRAFT_AGAIN_KINDS } from './topics-report'
import type { Built, TopicCtx } from './types'

const plural = (n: number, one: string, many: string) => (n === 1 ? one : many)
const GENERATION: ItemLink = { tab: 'generate' }
// Without a section: Review opens on its own list.
const REVIEW: ItemLink = { tab: 'review' }

// Checkpoints where the engineer must act. In Generate the next step then offers only its
// own button, never "What else?", as To Do offers only Skip while its tasks are open (board 18).
const ACTS: Checkpoint['kind'][] = [
  'input_needed',
  'needs_observations',
  'ready',
  'failed',
  'out_of_date',
]
// Past Generate, the checkpoints worth a word: never "All drafted" again.
const PAST_GENERATE: Checkpoint['kind'][] = ['out_of_date', 'failed', 'drafting']

/** Returns true while the Generate stage's next step waits on the engineer: it then offers no "What else?". */
export const waitsOnEngineer = (ctx: TopicCtx) =>
  ctx.brief.stage === 'generate' &&
  !!ctx.facts.drafting &&
  ACTS.includes(ctx.facts.drafting.checkpoint.kind)

/** Returns the checkpoint as one word, e.g. "ready-3"; a change of it is a new next step. */
export const checkpointKey = (c: Checkpoint) => ('step' in c ? `${c.kind}-${c.step}` : c.kind)

/** Returns the said-mark for the checkpoint MarshBot names now, or null without one. */
export const stepMark = (facts: BriefFacts) =>
  facts.drafting ? `checkpoint:${checkpointKey(facts.drafting.checkpoint)}` : null

/** Returns the greeting's line for the Generate stage when a checkpoint has its own, else null. */
export function draftingLine(facts: BriefFacts): string | null {
  return facts.drafting?.checkpoint.kind === 'input_needed'
    ? `${sectionList(STEP_ONE_PARTS)} are drafted and ready for you in Review.`
    : null
}

// What MarshBot says about the engineer's open tasks (board 18): Sections 4 and 5's
// figures count as 1 thing, the accepted OFI as another.
function inputNeeded(openTasks: string[]): Say[] {
  const figures = ['4', '5'].filter((s) => openTasks.includes(s === '4' ? 'scores' : 'losses'))
  const clauses = [
    figures.length
      ? `**${sectionList(figures)}** ${plural(figures.length, 'needs its', 'need their')} figures`
      : '',
    openTasks.includes('ofi') ? '**Section 2** needs at least 1 accepted OFI in Section 3' : '',
  ].filter(Boolean)
  return [
    {
      text: `Before I can draft the last 3 sections, I need ${count(clauses.length, 'thing')} from you.`,
      tone: 'lead',
    },
    {
      text: `${clauses.join(', and ')}. Once ${plural(clauses.length, "that's", 'those are')} in, draft them from Generation.`,
      tone: 'normal',
    },
  ]
}

const drafts = (n: number) =>
  `Drafting ${count(n, 'section')} runs in the background and takes a few minutes. Start it from Generation.`

/**
 * Returns the next-step topic for Generation's checkpoint, or null before there is one.
 * The rules pick the words and the button; the wording path (wording.service.ts) may reword them.
 */
export function nextStepTopic(ctx: TopicCtx): Built | null {
  const c = ctx.facts.drafting?.checkpoint
  if (!c) return null
  if (ctx.brief.stage !== 'generate') {
    if (!PAST_GENERATE.includes(c.kind)) return null
    // In Ready to export, Draft Again already names the out-of-date sections.
    if (c.kind === 'out_of_date' && ctx.open.some(DRAFT_AGAIN_KINDS)) return null
  }
  // A turn with words only, or with one button: the button is a card's `cta`, drawn in the
  // action slot, as the export answer's is (advance.ts). The card id names the checkpoint, so
  // an older turn keeps its own button when the checkpoint moves on (advance.ts `merged`).
  const built = (
    says: Say[],
    cta: { label: string; link: ItemLink } | null,
    status: Built['status'],
    mood: Built['mood'] = 'idle',
  ): Built => ({
    kind: 'info',
    says,
    cards: cta
      ? [
          {
            type: 'rows',
            id: `step-${checkpointKey(c)}`,
            title: 'Next Step',
            note: null,
            rows: [],
            ticks: [],
            cta,
          },
        ]
      : [],
    mood,
    status,
  })
  const lead = (text: string): Say => ({ text, tone: 'lead' })
  const say = (text: string): Say => ({ text, tone: 'normal' })
  switch (c.kind) {
    case 'needs_observations': {
      const n = c.sections.length
      return built(
        [
          lead(
            `Before I can draft, ${sectionList(c.sections)} ${plural(n, 'needs', 'need')} at least 1 observation${plural(n, '', ' each')}.`,
          ),
          say('Add them in Observations, then draft from Generation.'),
        ],
        { label: 'Open Observations', link: { tab: 'observations' } },
        { text: 'Needs observations', tone: 'amber', icon: 'camera' },
        'concerned',
      )
    }
    case 'transcribing': {
      const n = c.recordings
      return built(
        [
          say(
            `${count(n, 'recording')} ${plural(n, 'is', 'are')} still transcribing. You can draft when ${plural(n, 'it finishes, so its', 'they finish, so their')} observations are included.`,
          ),
        ],
        null,
        { text: 'Transcribing', tone: 'blue', icon: 'mic' },
      )
    }
    case 'ready': {
      // Step 3's run also redrafts out-of-date step 1 parts (drafting-run.service.ts).
      const first = c.parts.filter((id) => STEP_ONE_PARTS.includes(id))
      const redraft =
        c.step === 3 && first.length
          ? `${sectionList(first)} ${plural(first.length, "is out of date, so it's", "are out of date, so they're")} redrafted too. `
          : ''
      return built(
        [
          lead(
            c.step === 1
              ? 'The report is ready to draft from your observations.'
              : 'The last sections are ready to draft from your input.',
          ),
          say(`${redraft}${drafts(c.parts.length)}`),
        ],
        { label: 'Open Generation', link: GENERATION },
        { text: 'Ready to draft', tone: 'blue', icon: 'sparkles' },
      )
    }
    case 'drafting':
      return built(
        [
          say(
            `I'm drafting ${count(c.parts.length, 'section')} in the background. It takes a few minutes, and the bell will tell you when it's done.`,
          ),
        ],
        null,
        { text: 'Drafting', tone: 'blue', icon: 'sparkles' },
      )
    case 'failed':
      return built(
        [
          lead(`${sectionList(c.failed)} ${plural(c.failed.length, 'was', 'were')} not drafted.`),
          say('You can try again from Generation.'),
        ],
        { label: 'Open Generation', link: GENERATION },
        { text: 'Not drafted', tone: 'red', icon: 'circle-alert' },
        'concerned',
      )
    case 'input_needed':
      return built(
        inputNeeded(ctx.facts.drafting!.openTasks),
        { label: 'Open Review', link: REVIEW },
        { text: 'Your input needed', tone: 'amber', icon: 'user' },
      )
    case 'out_of_date':
      return built(
        [
          lead(`${sectionList(c.parts)} ${plural(c.parts.length, 'is', 'are')} out of date.`),
          say('Redraft them from Generation. Redrafting keeps the findings you accepted.'),
        ],
        { label: 'Open Generation', link: GENERATION },
        { text: 'Out of date', tone: 'amber', icon: 'refresh-cw' },
      )
    case 'drafted':
      return built(
        [
          {
            text: 'All 11 sections are drafted and ready for you to review before you export the report.',
            tone: 'good',
          },
        ],
        { label: 'Open Review', link: REVIEW },
        { text: 'All drafted', tone: 'green', icon: 'sparkles' },
        'pleased',
      )
  }
}
