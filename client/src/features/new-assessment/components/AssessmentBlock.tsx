// One assessment in a site's card (CP-23, boards 08, 09, 12): its type tile,
// "Assessment N", a (?) on the types and the type control (AC18, AC20); the
// dates row, then the copy-locations switch for a resurvey or follow-up of a
// recorded site; then its site contacts. Used by SiteCard.tsx.
import {
  AssessmentTypeControl,
  AssessmentTypeTile,
  IconButton,
  Switch,
  type AssessmentType,
} from '../../../design-system'
import { plural } from '../../clients/formatClient'
import { TYPE_HELP, type FormAssessment } from '../form'
import type { NewAssessmentForm } from '../useNewAssessment'
import { useExit } from './Block'
import { ContactsEditor } from './ContactsEditor'
import { beforeStartLine, INVALID_DATE } from '../validate'
import { DateField } from './DateField'
import { ErrorLine } from './Field'
import { Help } from './Help'

export type CopyLocations = { count: number; from: string; on: boolean; set: (on: boolean) => void }

export function AssessmentBlock({
  f,
  i,
  j,
  a,
  type,
  firstOnly,
  removable,
  copy,
}: {
  f: NewAssessmentForm
  i: number
  j: number
  a: FormAssessment
  // The type it will be created as; '' while none is chosen.
  type: AssessmentType | ''
  firstOnly: boolean
  removable: boolean
  copy: CopyLocations | null
}) {
  const exit = useExit()
  const path = `sites.${i}.assessments.${j}.`
  const notSure = (k: string) => a.notSure.includes(k)
  const typeError = f.errors[path + 'visitType']
  const typeUnsure = notSure('visitType') && !firstOnly && !typeError
  // A date field. A typed date before the survey start shows the same line as a refused Create.
  const date = (k: 'siteVisitDate' | 'siteVisitEndDate' | 'reportDueDate', label: string) => {
    const early = k !== 'siteVisitDate' && !!a[k] && !!a.siteVisitDate && a[k] < a.siteVisitDate
    return (
      <DateField
        label={label}
        required={k === 'siteVisitDate'}
        value={a[k]}
        min={k === 'siteVisitDate' ? undefined : a.siteVisitDate || undefined}
        notSure={notSure(k)}
        error={
          f.errors[path + k] ??
          (f.typed.has(path + k)
            ? INVALID_DATE
            : early
              ? beforeStartLine(a.siteVisitDate)
              : undefined)
        }
        onChange={(iso, invalid) => {
          f.setAssessment(i, j, { [k]: iso })
          f.markTyped(path + k, invalid)
        }}
      />
    )
  }
  return (
    <section className="na-assessment" aria-label={'Assessment ' + (j + 1)}>
      <div className="na-assessment-head">
        {type ? (
          <AssessmentTypeTile type={type} size={32} />
        ) : (
          <span className="na-tile na-tile--empty" aria-hidden="true" />
        )}
        <h3>{'Assessment ' + (j + 1)}</h3>
        <span className="na-type">
          <Help label="What the assessment types mean" align="right">
            <dl className="na-help-list">
              {TYPE_HELP.map((t) => (
                <div key={t.value}>
                  <dt>{t.value}</dt>
                  <dd>{t.help}</dd>
                </div>
              ))}
            </dl>
            {firstOnly && (
              <p className="na-help-note">
                {'This site has no earlier assessment, so this one is a First survey.'}
              </p>
            )}
          </Help>
          <span
            className={'na-type-control' + (typeUnsure ? ' is-unsure' : '')}
            data-error={typeError ? '' : undefined}
          >
            <AssessmentTypeControl
              value={type as AssessmentType}
              disabled={firstOnly ? ['Resurvey', 'Follow-up'] : []}
              onChange={(visitType) => f.setAssessment(i, j, { visitType })}
            />
          </span>
          {removable && (
            <IconButton
              icon="trash-2"
              label={'Remove assessment ' + (j + 1)}
              onClick={() => exit(() => f.removeAssessment(i, j))}
            />
          )}
        </span>
      </div>
      {typeError && (
        <div className="na-type-error">
          <ErrorLine text={typeError} />
        </div>
      )}
      <div className="na-grid na-grid--3">
        {date('siteVisitDate', 'Survey start')}
        {date('siteVisitEndDate', 'Survey end')}
        {date('reportDueDate', 'Report due')}
      </div>
      {/* Its own row under the dates, so the label reads on one line (round 13). */}
      {copy && (
        <div className="na-copy">
          <Switch
            checked={copy.on}
            onChange={copy.set}
            label={
              <span className="na-copy-text">
                <strong>{'Copy ' + plural(copy.count, 'location')}</strong> {'from '}
                <span className="na-copy-from">{copy.from}</span>
              </span>
            }
          />
        </div>
      )}
      <ContactsEditor
        contacts={a.siteContacts}
        onChange={(contacts) => f.setContacts(i, j, contacts)}
      />
    </section>
  )
}
