// Reschedule (CP-60): an assessment's survey days and report due date, changed
// from the calendar. Saves through Edit details' own call (PUT
// /api/assessments/:reference), so the same rules apply: only the assigned
// engineer, and the due date and last survey day on or after the first.
// Called by screens/Calendar.tsx. Calls Dialog and DatePicker.
import { useRef, useState } from 'react'
import { Button, DatePicker, Dialog } from '../../../design-system'
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
  // Esc with a date field's calendar open closes that calendar only. The browser
  // also asks the dialog to close on the same key, so that one request is skipped.
  const escForCalendar = useRef(false)
  const close = () => {
    if (escForCalendar.current) return void (escForCalendar.current = false)
    onClose()
  }
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
  return (
    <Dialog
      className="ds-dialog--v2 cal-reschedule"
      title={`Reschedule ${item.site}`}
      description={`${item.reference} for ${item.client}. The new dates show on the Assessments list and its Overview.`}
      width={480}
      onClose={busy ? undefined : close}
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
        onKeyDownCapture={(e) => {
          if (e.key === 'Escape' && e.currentTarget.querySelector('.ds-popover'))
            escForCalendar.current = true
        }}
      >
        <Problem title="Dates not saved" problem={problem} />
        <div className="cal-reschedule-pair">
          <DatePicker
            label="Survey start"
            value={form.start}
            onChange={change('start')}
            error={errors.start ?? fields.siteVisitDate}
            disabled={busy}
          />
          <DatePicker
            label="Survey end"
            value={form.end}
            min={form.start || undefined}
            onChange={change('end')}
            error={errors.end ?? fields.siteVisitEndDate}
            disabled={busy}
          />
        </div>
        <DatePicker
          label="Report due"
          value={form.due}
          min={form.start || undefined}
          onChange={change('due')}
          error={errors.due ?? fields.reportDueDate}
          disabled={busy}
        />
      </div>
    </Dialog>
  )
}
