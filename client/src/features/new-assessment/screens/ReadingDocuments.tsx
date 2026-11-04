// The reading screen (CP-23 AC1-AC4, AC22, boards 10, 11): the slim drop row
// for more files, each file's status on the left, what has been found so far
// on the right; once every file is read, the page blurs behind the done card,
// then the form opens. Used by screens/NewAssessment.tsx. Calls the reading
// components; the intake's timeline lives in useIntake.ts.
import { DoneCard } from '../components/DoneCard'
import { FoundSoFar } from '../components/FoundSoFar'
import { ReadingCard } from '../components/ReadingCard'
import { UploadArea } from '../components/UploadArea'
import type { Intake } from '../useIntake'

export function ReadingDocuments({
  intake,
  onAdd,
  onRetry,
  onFillIn,
}: {
  intake: Intake
  onAdd: (files: File[], pastedText: string) => void
  onRetry: () => void
  onFillIn: () => void
}) {
  const { phase } = intake
  const finished = phase === 'done' || phase === 'leaving'
  const blurred = finished && phase !== 'leaving'
  // Only documents actually read count. The total leaves out files refused at
  // upload, as the reading card's header does (boards 10, 11); failed reads stay in.
  const pasted = +!!intake.added.text.trim()
  const read = intake.files.filter((f) => f.status === 'read').length + pasted
  const total = intake.files.filter((f) => f.status !== 'refused').length + pasted
  return (
    <div className="na-reading-screen">
      {/* Blurred behind the done card: inert + aria-hidden keep keyboard and readers out of it. */}
      <div
        className={'na-reading-page' + (blurred ? ' is-blurred' : '')}
        inert={blurred}
        aria-hidden={blurred || undefined}
      >
        <UploadArea slim onAdd={onAdd} />
        <div className="na-reading-grid">
          <ReadingCard intake={intake} onRetry={onRetry} onFillIn={onFillIn} />
          <FoundSoFar result={intake.read?.result ?? null} revealed={intake.revealed} />
        </div>
      </div>
      {finished && <DoneCard read={read} total={total} leaving={phase === 'leaving'} />}
    </div>
  )
}
