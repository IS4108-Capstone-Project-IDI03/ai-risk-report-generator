// Edit details (RV-10 AC10, AC11): an assessment's own details, over its
// Overview. Its site and client change for all their assessments at once,
// through Edit site and the client page (CP-18), so they are not here.
import { useState } from 'react'
import { Button, Dialog, Input, Select } from '../../../design-system'
import { Problem } from '../../clients/ClientDialogs'
import { useDialogSave } from '../../clients/useDialogSave'
import { updateAssessment, type Assessment } from '../api'
import { SURVEY_TYPES } from '../demo-data'

export function EditDetailsDialog({
  record,
  onClose,
  onSaved,
}: {
  record: Assessment
  onClose: () => void
  onSaved: (message: string) => void
}) {
  const [form, setForm] = useState({
    surveyType: record.surveyType,
    siteVisitDate: record.siteVisitDate ?? '',
    reportDueDate: record.reportDueDate ?? '',
  })
  const { busy, problem, fields, run } = useDialogSave()
  const set = (key: keyof typeof form) => (e: { target: { value: string } }) =>
    setForm({ ...form, [key]: e.target.value })
  // A type saved before the list changed stays offered, as it is.
  const surveyOptions = SURVEY_TYPES.includes(record.surveyType)
    ? SURVEY_TYPES
    : [record.surveyType, ...SURVEY_TYPES]
  const save = () =>
    run(async () => {
      await updateAssessment(record.reference, form)
      onSaved('Details saved for ' + record.reference + '.')
    })
  return (
    <Dialog
      title="Edit details"
      description={`${record.reference} · ${record.site.name}, ${record.client}`}
      width={480}
      onClose={busy ? undefined : onClose}
      footer={
        <>
          <Button variant="secondary" disabled={busy} onClick={onClose}>
            {'Cancel'}
          </Button>
          <Button variant="primary" loading={busy} onClick={() => void save()}>
            {'Save changes'}
          </Button>
        </>
      }
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
        <Problem title="Details not saved" problem={problem} />
        <Select
          label="Assessment type"
          options={surveyOptions}
          value={form.surveyType}
          error={fields.surveyType}
          onChange={set('surveyType')}
        />
        <Input
          label="Site visit date"
          type="date"
          value={form.siteVisitDate}
          error={fields.siteVisitDate}
          onChange={set('siteVisitDate')}
        />
        <Input
          label="Report due"
          type="date"
          value={form.reportDueDate}
          error={fields.reportDueDate}
          onChange={set('reportDueDate')}
        />
      </div>
    </Dialog>
  )
}
