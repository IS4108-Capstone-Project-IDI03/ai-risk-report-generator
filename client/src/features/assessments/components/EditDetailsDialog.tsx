// Edit Assessment Details (RV-10 AC10, AC11; AS-06 round 9, design system v2): an assessment's own
// details, over its Overview. Its site and client change for all their assessments at once,
// through Edit site and the client page (CP-18), so they are not here.
// Called by marshbot/components/DetailsPanel.tsx and screens/Overview.tsx. Calls updateAssessment.
import { useState } from 'react'
import { Button, DatePicker, Dialog, Select } from '../../../design-system'
import { Problem } from '../../clients/ClientDialogs'
import { useDialogSave } from '../../clients/useDialogSave'
import { beforeStartLine, INVALID_DATE } from '../../new-assessment/validate'
import { updateAssessment, type Assessment } from '../api'
import { SURVEY_TYPES } from '../options'
import './edit-details.css'

type DateKey = 'siteVisitDate' | 'siteVisitEndDate' | 'reportDueDate'

/** Returns the dialog; `onSaved` hears the saved message once the gateway has taken the change. */
export function EditDetailsDialog({
  record,
  onClose,
  onSaved,
}: {
  record: Assessment
  onClose: () => void
  onSaved: (message: string) => void
}) {
  const start = {
    surveyType: record.surveyType,
    siteVisitDate: record.siteVisitDate ?? '',
    // Sent with the rest, or saving would clear it (CP-60).
    siteVisitEndDate: record.siteVisitEndDate ?? '',
    reportDueDate: record.reportDueDate ?? '',
  }
  const [form, setForm] = useState(start)
  // The dates whose typed text is not a real date: the picker reports no value for them.
  const [typed, setTyped] = useState<DateKey[]>([])
  const { busy, problem, fields, run } = useDialogSave()
  // A type saved before the list changed stays offered, as it is.
  const surveyOptions = SURVEY_TYPES.includes(record.surveyType)
    ? SURVEY_TYPES
    : [record.surveyType, ...SURVEY_TYPES]

  // What is wrong with a date on this screen: a typed non-date, or a report due date that falls
  // before the survey (the same line as the New Assessment form). The gateway's own line, shown
  // under the field after a refused save, never blocks the next try.
  const early =
    !!form.reportDueDate && !!form.siteVisitDate && form.reportDueDate < form.siteVisitDate
  const mine = (key: DateKey) =>
    typed.includes(key)
      ? INVALID_DATE
      : key === 'reportDueDate' && early
        ? beforeStartLine(form.siteVisitDate)
        : undefined
  const blocked = mine('siteVisitDate') ?? mine('siteVisitEndDate') ?? mine('reportDueDate')
  const unchanged =
    !typed.length &&
    (Object.keys(start) as (keyof typeof start)[]).every((k) => form[k] === start[k])

  const date = (key: DateKey, label: string, min?: string) => (
    <DatePicker
      label={label}
      value={form[key]}
      min={min}
      error={mine(key) ?? fields[key]}
      // Inside this modal dialog a phone's calendar must float, not open in a sheet behind it.
      noSheet
      onChange={(iso, info) => {
        setForm({ ...form, [key]: iso })
        setTyped(
          info.invalid ? [...typed.filter((k) => k !== key), key] : typed.filter((k) => k !== key),
        )
      }}
    />
  )

  // Pressing Save with nothing changed just closes: without this it would send an empty edit.
  const save = () => {
    if (unchanged) return onClose()
    void run(async () => {
      await updateAssessment(record.reference, form)
      onSaved('Details saved for ' + record.reference + '.')
    })
  }
  return (
    <Dialog
      title="Edit Assessment Details"
      description={`${record.reference} · ${record.site.name}`}
      width={520}
      onClose={busy ? undefined : onClose}
      footer={
        <>
          <Button pill variant="secondary" disabled={busy} onClick={onClose}>
            Cancel
          </Button>
          <Button
            pill
            variant="primary"
            loading={busy}
            // Plainly greyed: the red line under the date already says why, right above this
            // button, and a reason box here opened over that line.
            disabled={!!blocked}
            onClick={save}
          >
            Save Changes
          </Button>
        </>
      }
    >
      <div
        className="ed-fields"
        // Escape closes an open calendar, not the dialog: without this one press would close both.
        onKeyDown={(e) =>
          e.key === 'Escape' && e.currentTarget.querySelector('.ds-popover') && e.preventDefault()
        }
      >
        <Problem title="Details not saved" problem={problem} />
        <Select
          label="Assessment Type"
          options={surveyOptions}
          value={form.surveyType}
          error={fields.surveyType}
          onChange={(e) => setForm({ ...form, surveyType: e.target.value })}
        />
        {/* An error line stays in its own column and wraps there (ed-dates, edit-details.css). */}
        <div className="ed-dates">
          {date('siteVisitDate', 'Survey Date')}
          {/* The last survey day (CP-60), editable here so a save never clears it. */}
          {date('siteVisitEndDate', 'Survey End Date', form.siteVisitDate || undefined)}
          {date('reportDueDate', 'Report Due Date', form.siteVisitDate || undefined)}
        </div>
      </div>
    </Dialog>
  )
}
