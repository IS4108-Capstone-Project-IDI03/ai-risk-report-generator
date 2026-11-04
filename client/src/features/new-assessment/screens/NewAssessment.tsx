// The New Assessment screen (CP-23): the top bar with its inline Back, then
// either the form (filled in by hand), or the client documents' start, the
// reading screen and the filled-in form. Leaving without creating discards
// what was added (AC13). Called by assessments/AssessmentApp.tsx. Calls
// useNewAssessment.ts, useIntake.ts and the two screens below.
import { useState, type ReactNode } from 'react'
import { FormActionBar, Icon, TopBar, toast } from '../../../design-system'
import type { Assessment } from '../../assessments/api'
import { plural } from '../../clients/formatClient'
import type { StartMode } from '../components/NewAssessmentButton'
import { ReadingFileRow } from '../components/ReadingFileRow'
import { UploadArea } from '../components/UploadArea'
import { formFromResult } from '../form'
import { failureOf } from '../reading'
import { useIntake, type Read } from '../useIntake'
import { useNewAssessment, type CreateStart } from '../useNewAssessment'
import { NewAssessmentForm } from './NewAssessmentForm'
import { ReadingDocuments } from './ReadingDocuments'
import '../new-assessment.css'

export function NewAssessment({
  mode,
  start,
  onCreated,
  onLeave,
  onView,
  bell,
}: {
  mode: StartMode
  start: CreateStart
  onCreated: (assessments: Assessment[]) => void
  onLeave: () => void
  // Opens a created assessment from the toast's View.
  onView?: (assessment: Assessment) => void
  bell?: ReactNode
}) {
  // a. The documents, read on their own screen.
  const intake = useIntake()
  // b. The form; once created through the intake, its documents are the client's.
  const f = useNewAssessment(start, (created, fromIntake) => {
    if (fromIntake) intake.keep()
    toast.success(
      created.length === 1
        ? created[0].reference + ' created'
        : plural(created.length, 'assessment') + ' created',
      onView && created[0]
        ? { action: { label: 'View', onClick: () => onView(created[0]) } }
        : undefined,
    )
    onCreated(created)
  })
  // c. A reading fills the form in (AC5) while the found items reveal; one
  // that named nothing says so once the form opens.
  const [readNothing, setReadNothing] = useState(false)
  const fill = (read: Read | null) => {
    if (!read) return
    f.fillIn(formFromResult(read.result, read.files))
    setReadNothing(!read.result.client.name.value && !read.result.sites.length)
  }
  // Every read fills the form, a retry's too; without this Try again opens it empty.
  const add = (files: File[], text: string) => void intake.add(files, text).then(fill)
  const retry = () => void intake.retry().then(fill)
  // d. Which screen: the form, or the documents' start or reading. After a
  // failed read the engineer can drop the documents and fill the form in by hand.
  const [byHand, setByHand] = useState(false)
  const fillInByHand = () => {
    intake.cancel()
    setByHand(true)
  }
  const formShown = mode === 'form' || intake.phase === 'ready' || byHand
  return (
    <div className="na">
      <div className="na-topbar">
        <TopBar
          eyebrow="Assessments"
          title="New Assessment"
          back={{ label: 'Back to Assessments', onClick: onLeave }}
          bell={bell}
        />
      </div>
      <div className="na-body">
        {formShown ? (
          <NewAssessmentForm f={f} enter={mode === 'documents'} readNothing={readNothing} />
        ) : intake.phase === 'idle' ? (
          <div className="na-start">
            <UploadArea onAdd={add} />
            {!!intake.error && (
              <div className="na-card na-start-error">
                <p className="na-read-error" role="alert">
                  <Icon name="circle-alert" size={14} />
                  <strong>{'Nothing added.'}</strong> {intake.error}
                </p>
                {!!intake.files.length && (
                  <ul className="na-files" aria-label="Failed documents">
                    {intake.files.map((x, k) => (
                      <ReadingFileRow
                        key={x.name + k}
                        row={{ key: x.name, name: x.name, state: 'done', failure: failureOf(x) }}
                      />
                    ))}
                  </ul>
                )}
              </div>
            )}
          </div>
        ) : (
          <ReadingDocuments intake={intake} onAdd={add} onRetry={retry} onFillIn={fillInByHand} />
        )}
      </div>
      {formShown && (
        <FormActionBar
          onCancel={onLeave}
          primaryLabel="Create"
          primaryLoading={f.busy}
          onPrimary={() => void f.create(intake.phase === 'ready' ? intake.id() : null)}
        />
      )}
    </div>
  )
}
