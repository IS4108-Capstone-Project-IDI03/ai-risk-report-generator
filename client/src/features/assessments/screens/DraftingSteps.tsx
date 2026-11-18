// The Generation tab for a saved assessment (GN-13): the checkpoint header (who acts now, one
// button, the report bar) over the three steps: Draft from observations, Add your input, Draft
// from your input. Drafting runs on the gateway in the background; this screen only starts a
// drafting run and shows the state, re-read on every pushed `drafting` or `brief` event
// (useGeneration).
// Rendered by AssessmentApp.tsx. Calls generation/api.ts.
import { useState } from 'react'
import {
  Callout,
  CheckpointHeader,
  Icon,
  SegmentBar,
  StepCard,
  TaskRow,
  toast,
  useIsPhone,
} from '../../../design-system'
import type { SegmentState } from '../../../design-system'
import { DraftingPartRow } from '../components/DraftingPartRow'
import { HeaderButton } from '../components/HeaderButton'
import { LoadingSteps } from '../components/LoadingSteps'
import { startDraftingRun } from '../generation/api'
import type { GenerationDto, GenerationPart } from '../generation/types'
import { useGeneration } from '../generation/useGeneration'
import { draftedWhen, headerWords, sectionList, STEP_THREE_LINE, TASKS } from '../generation/words'
import { plural } from '../reviewDisplay'
import '../drafting-steps.css'

// A drafting run is working through this step now (aria-busy on its card).
const isRunning = (g: GenerationDto, step: 1 | 3) =>
  g.checkpoint.kind === 'drafting' && g.checkpoint.step === step

// A part's segment in the report bar: green once drafted, blue while drafted now.
function segmentOf(p: GenerationPart): SegmentState {
  if (p.job === 'drafting') return 'working'
  if (p.job === 'failed' && !p.drafted) return 'failed'
  if (p.outOfDate) return 'stale'
  return p.drafted ? 'done' : 'empty'
}

// "3 of 8" and its bar, on a step a drafting run is working through, or that failed. It counts
// this card's own rows, and only when the run drafts all of them: a run of Sections 7 and 2
// drafts 1 of step 3's 3 rows, and "0 of 1" over rows 4, 5 and 2 would not add up; the header
// and marks show that run. A row is done once it has a draft and no job left.
function runCount(g: GenerationDto, rows: GenerationPart[]) {
  const c = g.checkpoint
  if (c.kind === 'drafting') {
    if (!rows.every((p) => c.parts.includes(p.id))) return null
    const done = rows.filter((p) => p.drafted && !p.job).length
    return { done, of: rows.length, progress: done / rows.length }
  }
  const failedStep = c.kind === 'failed' && rows.some((p) => c.failed.includes(p.id))
  if (!failedStep) return null
  const done = rows.filter((p) => p.drafted).length
  return { done, of: rows.length, progress: done / rows.length }
}

/** Returns the Generation screen: loading and error states until the drafting state is read. */
export function DraftingSteps({
  reference,
  onReview,
  onOpenSection,
  onObservations,
}: {
  reference: string
  onReview: () => void
  // Opens one section in Review (a step 2 task).
  onOpenSection: (section: string) => void
  onObservations: () => void
}) {
  const { generation, setGeneration, loadError } = useGeneration(reference)
  const phone = useIsPhone()
  // Phone only: the steps opened by a tap, beside the current one.
  const [opened, setOpened] = useState<number[]>([])
  const [starting, setStarting] = useState(false)

  if (!generation)
    return loadError ? (
      <div className="gx">
        <Callout tone="danger" title="The drafting progress could not be loaded">
          {loadError}
        </Callout>
      </div>
    ) : (
      <LoadingSteps />
    )

  const g = generation
  const part = (id: string) => g.parts.find((p) => p.id === id) as GenerationPart
  const one = g.steps.one.parts.map(part)
  const three = g.steps.three.parts.map(part)
  const words = headerWords(g, phone)

  // Starts the run the checkpoint offers and shows the state it returns at once; the pushes
  // then move it on. A refusal (a run already going, transcription started) is a toast.
  const start = async () => {
    setStarting(true)
    try {
      setGeneration(await startDraftingRun(reference))
      toast.success('Drafting started')
    } catch (error: unknown) {
      toast.error(error instanceof Error ? error.message : 'Drafting could not start.')
    } finally {
      setStarting(false)
    }
  }

  // Phones show the current step open and fold the others to one line. A step holding an
  // out-of-date section, or one a run is drafting, opens too, so its flag or spinner is in view
  // (Section 7 redrafted with step 3 shows only in step 1).
  const open = (n: number, state: string, rows: GenerationPart[]) =>
    !phone || opened.includes(n) || state === 'now' || rows.some((p) => p.outOfDate || p.job)
  const fold = (n: number, state: string, rows: GenerationPart[], summary: string) => ({
    collapsed: !open(n, state, rows),
    onExpand: () => setOpened((o) => [...o, n]),
    summary,
  })

  const oneRun = runCount(g, one)
  const threeRun = runCount(g, three)
  const tasksDone = g.tasks.filter((t) => t.done).length
  // The engineer's turn: amber tiles and rows that open Review. An admin only watches.
  const turn = g.steps.two.state === 'now' && g.canStart
  // The report bar's groups: the parts each step drafts (8 then 3).
  const groups = [1, 3].map((n) => g.parts.filter((p) => p.step === n).length)

  return (
    <div className="gx">
      <CheckpointHeader
        swapKey={g.checkpoint.kind + ('step' in g.checkpoint ? g.checkpoint.step : '')}
        tone={words.tone}
        icon={words.icon}
        busy={words.busy}
        title={words.title}
        line={words.line}
        action={
          words.action && (
            <HeaderButton
              action={words.action}
              starting={starting}
              onStart={() => void start()}
              onReview={onReview}
              onObservations={onObservations}
            />
          )
        }
      >
        <SegmentBar
          segments={g.parts.map(segmentOf)}
          groups={groups}
          count={g.drafted}
          total={g.parts.length}
          word="drafted"
        />
      </CheckpointHeader>

      <div className="gx-steps">
        {/* In a span: Icon sets its own display, which would beat the stacked layout's hiding. */}
        <span className="gx-arrow gx-arrow-right" aria-hidden="true">
          <Icon name="arrow-right" size={16} />
        </span>
        <StepCard
          number={1}
          title="Draft from observations"
          state={g.steps.one.state}
          line={
            g.steps.one.state === 'done' && g.steps.one.draftedAt
              ? { icon: 'clock', text: draftedWhen(g.steps.one.draftedAt) }
              : { icon: 'sparkles', text: sectionList(g.steps.one.parts) }
          }
          count={oneRun ?? undefined}
          progress={oneRun?.progress}
          busy={isRunning(g, 1)}
          {...fold(1, g.steps.one.state, one, plural(one.length, 'section'))}
        >
          {one.map((p) => (
            <DraftingPartRow key={p.id} part={p} showCount />
          ))}
        </StepCard>

        <div className="gx-stack">
          <div className="gx-turn">
            <StepCard
              number={2}
              title="Add your input"
              state={g.steps.two.state}
              line={{ icon: 'user-round-search', text: 'In Review' }}
              count={
                g.steps.two.state === 'next' ? undefined : { done: tasksDone, of: g.tasks.length }
              }
              {...fold(2, g.steps.two.state, [], plural(g.tasks.length, 'task'))}
            >
              {g.tasks.map((t) => (
                <TaskRow
                  key={t.id}
                  icon={TASKS[t.id].icon}
                  title={TASKS[t.id].title}
                  detail={`Section ${t.section}`}
                  done={t.done}
                  active={turn}
                  onOpen={turn ? () => onOpenSection(t.section) : undefined}
                />
              ))}
            </StepCard>
            <span className="gx-arrow gx-arrow-down" aria-hidden="true">
              <Icon name="arrow-down" size={16} />
            </span>
          </div>
          <StepCard
            number={3}
            title="Draft from your input"
            state={g.steps.three.state}
            line={
              g.steps.three.state === 'done' && g.steps.three.draftedAt
                ? { icon: 'clock', text: draftedWhen(g.steps.three.draftedAt) }
                : { icon: 'sparkles', text: STEP_THREE_LINE }
            }
            count={threeRun ?? undefined}
            progress={threeRun?.progress}
            busy={isRunning(g, 3)}
            {...fold(3, g.steps.three.state, three, plural(three.length, 'section'))}
          >
            {three.map((p) => (
              <DraftingPartRow key={p.id} part={p} showCount={false} />
            ))}
          </StepCard>
        </div>
      </div>
    </div>
  )
}
