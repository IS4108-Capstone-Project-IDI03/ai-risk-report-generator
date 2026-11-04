// The dialogs that change a client or a site (CP-18): one of each, opened from
// the client page and from an assessment's Overview alike, so a change
// follows the same rules, warning and wording wherever it is made.
import { useState, type ChangeEvent } from 'react'
import { Button, Callout, Dialog, Input, Select } from '../../design-system'
import { FACILITY_TYPES, JURISDICTIONS } from '../assessments/demo-data'
import {
  correctSite,
  removeClient,
  removeSite,
  renameClient,
  restoreSite,
  type SiteFields,
} from './api'
import { useDialogSave } from './useDialogSave'

const plural = (n: number, one: string, many = one + 's') => `${n} ${n === 1 ? one : many}`

// Why a dialog's save failed, above its fields. Edit details uses it too.
export function Problem({ title, problem }: { title: string; problem: string | null }) {
  if (!problem) return null
  return (
    <div role="alert">
      <Callout tone="warning" title={title}>
        {problem}
      </Callout>
    </div>
  )
}

// The site as the dialog starts from.
export type EditedSite = {
  id: string
  name: string
  address: string | null
  jurisdiction: string
  facilityType: string
}

// Corrects a site's name, address, jurisdiction and facility type for every
// assessment at it. A new jurisdiction or facility type changes what drafting
// retrieves, so saving one asks first, saying how many assessments it changes.
// A facility type no longer offered stays as it is unless another is chosen
// (CP-30), so correcting only the address never changes it.
export function EditSiteDialog({
  site,
  assessments,
  onClose,
  onSaved,
}: {
  site: EditedSite
  assessments: number
  onClose: () => void
  onSaved: (message: string) => void
}) {
  const [form, setForm] = useState<SiteFields>({
    name: site.name,
    address: site.address ?? '',
    jurisdiction: site.jurisdiction,
    facilityType: site.facilityType,
  })
  const [confirming, setConfirming] = useState(false)
  const { busy, problem, fields, run } = useDialogSave()
  const set = (key: keyof SiteFields) => (e: ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setForm({ ...form, [key]: e.target.value })
  const facilityOptions = [
    ...(FACILITY_TYPES.includes(site.facilityType)
      ? []
      : [{ value: site.facilityType, label: `${site.facilityType} (no longer offered)` }]),
    ...FACILITY_TYPES,
  ]
  const jurisdictionOptions = [
    ...(JURISDICTIONS.some((j) => j.value === site.jurisdiction)
      ? []
      : [{ value: site.jurisdiction, label: site.jurisdiction }]),
    ...JURISDICTIONS,
  ]
  const scopeChanged =
    form.jurisdiction !== site.jurisdiction || form.facilityType !== site.facilityType
  const unchanged =
    !scopeChanged && form.name === site.name && form.address === (site.address ?? '')
  const save = () =>
    run(async () => {
      try {
        await correctSite(site.id, form)
      } catch (error: unknown) {
        setConfirming(false)
        throw error
      }
      onSaved(`${form.name.trim()} saved. ${everyAssessment(assessments)}`)
    })
  const next = () => {
    if (unchanged) return onClose()
    if (scopeChanged && !confirming) return setConfirming(true)
    void save()
  }
  return (
    <Dialog
      className="ds-dialog--v2"
      title={confirming ? 'Change this site’s scope?' : `Edit ${site.name}`}
      description={confirming ? undefined : everyAssessment(assessments)}
      width={520}
      onClose={busy ? undefined : onClose}
      footer={
        <>
          <Button
            pill
            variant="secondary"
            disabled={busy}
            onClick={confirming ? () => setConfirming(false) : onClose}
          >
            {confirming ? 'Back' : 'Cancel'}
          </Button>
          <Button pill variant="primary" loading={busy} disabled={!form.name.trim()} onClick={next}>
            {confirming ? 'Change scope' : 'Save changes'}
          </Button>
        </>
      }
    >
      {/* Keyed by the step, so switching to the scope check crossfades (.ds-swap, kit.css). */}
      <div
        key={String(confirming)}
        className="ds-swap"
        style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}
      >
        <Problem title="Site not saved" problem={problem} />
        {confirming ? (
          <>
            <p style={{ margin: 0 }}>
              {`A new jurisdiction or facility type changes the ${plural(assessments, 'assessment')} at ${form.name.trim()}:`}
            </p>
            <ul style={{ margin: 0, paddingLeft: '20px', lineHeight: '24px' }}>
              <li>{'Their checklists are marked out of date, to generate again.'}</li>
              <li>
                {
                  'Their report drafts are marked out of date until redrafted, since the standards they draw on change.'
                }
              </li>
              <li>{'Saved observations keep the jurisdiction and facility type they had.'}</li>
            </ul>
          </>
        ) : (
          <>
            <Input
              label="Site name"
              value={form.name}
              error={fields.name}
              maxLength={200}
              onChange={set('name')}
            />
            <Input
              label="Site address"
              value={form.address}
              error={fields.address}
              maxLength={200}
              onChange={set('address')}
            />
            <Select
              label="Jurisdiction"
              hint="Filters the standards and regulations drafting draws on"
              options={jurisdictionOptions}
              value={form.jurisdiction}
              error={fields.jurisdiction}
              onChange={set('jurisdiction')}
            />
            <Select
              label="Facility type"
              options={facilityOptions}
              value={form.facilityType}
              error={fields.facilityType}
              onChange={set('facilityType')}
            />
          </>
        )}
      </div>
    </Dialog>
  )
}

// What a correction reaches, said before and after saving.
const everyAssessment = (n: number) =>
  n === 0
    ? 'No assessments at this site yet.'
    : n === 1
      ? 'Changes apply to the one assessment at this site.'
      : `Changes apply to the ${n} assessments at this site.`

// Renames a client for every assessment for it. It renames the client's own
// record: which client an assessment is for never changes (CP-17).
export function RenameClientDialog({
  client,
  onClose,
  onSaved,
}: {
  client: { id: string; name: string }
  onClose: () => void
  onSaved: (message: string) => void
}) {
  const [name, setName] = useState(client.name)
  const { busy, problem, fields, run } = useDialogSave()
  const save = () =>
    name === client.name
      ? onClose()
      : void run(async () => {
          await renameClient(client.id, name)
          onSaved(`${client.name} renamed to ${name.trim().replace(/\s+/g, ' ')}.`)
        })
  return (
    <Dialog
      className="ds-dialog--v2"
      title={`Rename ${client.name}`}
      description="The new name appears on all of this client's assessments."
      width={440}
      onClose={busy ? undefined : onClose}
      footer={
        <>
          <Button pill variant="secondary" disabled={busy} onClick={onClose}>
            {'Cancel'}
          </Button>
          <Button pill variant="primary" loading={busy} disabled={!name.trim()} onClick={save}>
            {'Rename'}
          </Button>
        </>
      }
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
        <Problem title="Client not renamed" problem={problem} />
        <Input
          label="Client name"
          value={name}
          error={fields.name}
          maxLength={200}
          onChange={(e) => setName(e.target.value)}
        />
      </div>
    </Dialog>
  )
}

// Confirms removing a site, or a client with all its listed sites. Removed,
// they leave the create form and this page's list; their assessments stay as
// they are, and Removed sites can restore them.
export function RemoveDialog({
  target,
  onClose,
  onSaved,
}: {
  target: { kind: 'site' | 'client'; id: string; name: string; sites?: number }
  onClose: () => void
  onSaved: (message: string) => void
}) {
  const { busy, problem, run } = useDialogSave()
  const client = target.kind === 'client'
  const remove = () =>
    run(async () => {
      await (client ? removeClient(target.id) : removeSite(target.id))
      onSaved(
        client
          ? `${target.name} removed. Restore on this page brings its sites back.`
          : `${target.name} removed. Removed sites can restore it.`,
      )
    })
  return (
    <Dialog
      className="ds-dialog--v2"
      title={`Remove ${target.name}?`}
      description={
        client
          ? `Its ${plural(target.sites ?? 0, 'site')} won't be offered for new assessments. Existing assessments stay as they are, and you can restore the client later.`
          : "It won't be offered for new assessments. Existing assessments stay as they are, and you can restore it from Removed sites."
      }
      width={440}
      onClose={busy ? undefined : onClose}
      footer={
        <>
          <Button pill variant="secondary" disabled={busy} onClick={onClose}>
            {'Cancel'}
          </Button>
          <Button pill variant="danger" loading={busy} onClick={remove}>
            {client ? 'Remove client' : 'Remove site'}
          </Button>
        </>
      }
    >
      <Problem title={client ? 'Client not removed' : 'Site not removed'} problem={problem} />
    </Dialog>
  )
}

// Restores a removed site under a new name, when the client has since given
// another site its own: two listed sites of one name are never made (CP-17).
export function RestoreSiteDialog({
  site,
  onClose,
  onSaved,
}: {
  site: { id: string; name: string }
  onClose: () => void
  onSaved: (message: string) => void
}) {
  const [name, setName] = useState('')
  const { busy, problem, fields, run } = useDialogSave()
  const restore = () =>
    run(async () => {
      await restoreSite(site.id, name)
      onSaved(`${site.name} restored as ${name.trim()}.`)
    })
  return (
    <Dialog
      className="ds-dialog--v2"
      title={`Restore ${site.name}`}
      description={`Another site at this client is now called ${site.name}. Give this one a new name to restore it.`}
      width={480}
      onClose={busy ? undefined : onClose}
      footer={
        <>
          <Button pill variant="secondary" disabled={busy} onClick={onClose}>
            {'Cancel'}
          </Button>
          <Button pill variant="primary" loading={busy} disabled={!name.trim()} onClick={restore}>
            {'Restore'}
          </Button>
        </>
      }
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
        <Problem title="Site not restored" problem={problem} />
        <Input
          label="New site name"
          value={name}
          error={fields.name}
          maxLength={200}
          onChange={(e) => setName(e.target.value)}
        />
      </div>
    </Dialog>
  )
}
