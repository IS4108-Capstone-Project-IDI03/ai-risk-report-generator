// Reschedule (CP-60): an assessment's survey days and report due date, changed
// from the calendar. Saves through Edit details' own call (PUT
// /api/assessments/:reference), so the same rules apply: only the assigned
// engineer, and the due date and last survey day on or after the first.
// Called by screens/Calendar.tsx. Calls Dialog and DatePicker (the phone's own date
// field on a phone).
import { useState } from 'react'
import { Button, DatePicker, Dialog, Input, useIsPhone } from '../../../design-system'
import { updateAssessment } from '../../assessments/api'
import { Problem } from '../../clients/ClientDialogs'
import { useDialogSave } from '../../clients/useDialogSave'
import { beforeStartLine, INVALID_DATE } from '../../new-assessment/validate'
import type { CalendarItem } from '../calendar'

type Field = 'start' | 'end' | 'due'

export function RescheduleDialog({
  item,
  onClose,
  onSaved,
}: {
  item: CalendarItem
  onClose: () => void
  onSaved: () => void
}) {
  const saved = { start: item.start ?? '', end: item.end ?? '', due: item.due ?? '' }
  const [form, setForm] = useState(saved)
  // Fields whose typed text is not a date yet: their value reads as empty.
  const [typed, setTyped] = useState<Partial<Record<Field, boolean>>>({})
  const [errors, setErrors] = useState<Partial<Record<Field, string>>>({})
  const { busy, problem, fields, run } = useDialogSave()
  // On a phone the date picker's calendar is a sheet, which opens behind a dialog
  // (a dialog sits above the whole page). So a phone gets its own date field here,
  // as Edit details has, which also brings up the phone's date wheel.
  const phone = useIsPhone()
  const change = (key: Field) => (value: string, info: { invalid?: boolean }) => {
    setForm((f) => ({ ...f, [key]: value }))
    setTyped((t) => ({ ...t, [key]: !!info.invalid }))
    setErrors((e) => ({ ...e, [key]: undefined }))
  }
  const unchanged = (Object.keys(saved) as Field[]).every((k) => form[k] === saved[k] && !typed[k])
  const save = () => {
    const found: Partial<Record<Field, string>> = {}
    if (form.end && !form.start) found.start = 'Add the survey start'
    else if (form.end && form.end < form.start) found.end = beforeStartLine(form.start)
    if (form.due && form.start && form.due < form.start) found.due = beforeStartLine(form.start)
    for (const key of Object.keys(typed) as Field[]) if (typed[key]) found[key] = INVALID_DATE
    setErrors(found)
    if (Object.keys(found).length) return
    void run(async () => {
      await updateAssessment(item.reference, {
        // Its type stays as it is; the gateway keeps an older one unchanged.
        surveyType: item.type,
        siteVisitDate: form.start,
        // One day has no last day of its own.
        siteVisitEndDate: form.end === form.start ? '' : form.end,
        reportDueDate: form.due,
      })
      onSaved()
    })
  }
  // One date field: its own check's line, else the gateway's. `min` greys earlier days.
  const date = (key: Field, label: string, refused?: string, min?: string) =>
    phone ? (
      <Input
        label={label}
        type="date"
        value={form[key]}
        min={min || undefined}
        error={errors[key] ?? refused}
        disabled={busy}
        onChange={(e) => change(key)(e.target.value, {})}
      />
    ) : (
      <DatePicker
        label={label}
        value={form[key]}
        min={min || undefined}
        onChange={change(key)}
        error={errors[key] ?? refused}
        disabled={busy}
      />
    )
  return (
    <Dialog
      className="cal-reschedule"
      title={`Reschedule ${item.site}`}
      description={`${item.reference} for ${item.client}. The new dates show on the Assessments list and its Overview.`}
      width={480}
      onClose={busy ? undefined : onClose}
      footer={
        <>
          <Button pill variant="secondary" disabled={busy} onClick={onClose}>
            {'Cancel'}
          </Button>
          <Button pill variant="primary" loading={busy} disabled={unchanged} onClick={save}>
            {'Save dates'}
          </Button>
        </>
      }
    >
      <div
        className="cal-reschedule-fields"
        // Esc with a date field's calendar open closes that calendar only (or takes its month
        // or year chooser back to the days): cancelled here, so the dialog gets no close
        // request. Chrome lets a second request in a row through however the dialog answers.
        onKeyDownCapture={(e) => {
          if (e.key === 'Escape' && e.currentTarget.querySelector('.ds-popover')) e.preventDefault()
        }}
      >
        <Problem title="Dates not saved" problem={problem} />
        <div className="cal-reschedule-pair">
          {date('start', 'Survey start', fields.siteVisitDate)}
          {date('end', 'Survey end', fields.siteVisitEndDate, form.start)}
        </div>
        {date('due', 'Report due', fields.reportDueDate, form.start)}
      </div>
    </Dialog>
  )
}
