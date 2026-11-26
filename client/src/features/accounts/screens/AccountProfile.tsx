// One person's profile (F-03): their details, with Edit profile in the top bar. An account whose
// owner has not set a password shows the invitation note (F-08). Called by UserAccounts.tsx.
// Calls updateUser (api.ts). The role and active switch are locked for the signed-in admin.
import { useLayoutEffect, useRef, useState } from 'react'
import { Badge, Button, Callout, FormActionBar, Switch } from '../../../design-system'
import { GatewayError } from '../../assessments/api'
import { updateUser, roleLabel, type UserAccount, type UserProfile } from '../api'
import { accountStatus, initials, officeLabel, problem, toProfile } from '../accountFormat'
import { AccountFields } from '../components/AccountFields'
import { AccountsHeader } from '../components/AccountsHeader'
import { InvitationNote } from '../components/InvitationNote'

export function AccountProfile({
  user,
  isSelf,
  onSaved,
  onBack,
  bell,
}: {
  user: UserAccount
  isSelf: boolean
  onSaved: (user: UserAccount) => void
  onBack: () => void
  bell?: React.ReactNode
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState<UserProfile>(() => toProfile(user))
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})
  const [saveError, setSaveError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState<string | null>(null)
  const formRef = useRef<HTMLFormElement>(null)

  // Move focus to the first field the gateway rejected (as in NewAccount.tsx).
  useLayoutEffect(() => {
    formRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus()
  }, [fieldErrors])

  function startEditing() {
    setDraft(toProfile(user))
    setFieldErrors({})
    setSaveError(null)
    setSaved(null)
    setEditing(true)
  }
  async function save(event: React.FormEvent) {
    event.preventDefault()
    if (saving) return
    setSaving(true)
    setSaveError(null)
    try {
      const stored = await updateUser(user.id, draft)
      setFieldErrors({})
      setEditing(false)
      // A corrected email on an account still to be set up gets a new invitation; the link sent
      // to the old address stops working (F-08).
      const reinvited = !stored.passwordSet && stored.active && stored.email !== user.email
      setSaved(
        !reinvited
          ? 'The changes are stored and will show whenever this profile is opened.'
          : stored.invitationExpiresAt
            ? `The changes are stored. A new invitation was emailed to ${stored.email}, and the link sent to ${user.email} no longer works.`
            : `The changes are stored, but the invitation to ${stored.email} could not be sent. Choose Resend invitation to try again.`,
      )
      onSaved(stored)
    } catch (error: unknown) {
      if (error instanceof GatewayError && Object.keys(error.fields).length > 0) {
        setFieldErrors(error.fields)
        setSaveError('Correct the highlighted fields, then save again.')
      } else {
        setSaveError(problem(error, 'the changes were not saved'))
      }
    } finally {
      setSaving(false)
    }
  }

  const status = accountStatus(user)
  const header = (action?: React.ReactNode) => (
    <AccountsHeader
      title={user.name}
      helper={`${user.staffId} · ${roleLabel(user.role)}`}
      back={{ label: 'Back to accounts', onClick: onBack }}
      lead={
        <span className="accounts-avatar accounts-avatar-lg" aria-hidden="true">
          {initials(user.name)}
        </span>
      }
      action={action}
      bell={bell}
      stack
    />
  )

  if (!editing) {
    return (
      <>
        {header(
          <Button variant="create" iconLeft="pencil" onClick={startEditing}>
            Edit profile
          </Button>,
        )}
        <div className="accounts">
          <section className="accounts-card" aria-label={`Profile for ${user.name}`}>
            {saved && (
              <div role="status" className="accounts-body-note">
                <Callout tone="success" title="Profile saved">
                  {saved}
                </Callout>
              </div>
            )}
            {!user.passwordSet && <InvitationNote user={user} onSent={onSaved} />}
            <dl className="accounts-details">
              <div>
                <dt>Status</dt>
                <dd>
                  <Badge tone={status.tone}>{status.label}</Badge>
                </dd>
              </div>
              <div>
                <dt>Email</dt>
                <dd>{user.email}</dd>
              </div>
              <div>
                <dt>Role</dt>
                <dd>{roleLabel(user.role)}</dd>
              </div>
              <div>
                <dt>Job title</dt>
                <dd>{user.jobTitle ?? 'Not set'}</dd>
              </div>
              <div>
                <dt>Phone</dt>
                <dd>{user.phone ?? 'Not set'}</dd>
              </div>
              <div>
                <dt>Office</dt>
                <dd>{officeLabel(user.office)}</dd>
              </div>
            </dl>
          </section>
        </div>
      </>
    )
  }

  return (
    <div className="accounts-page">
      {header()}
      <div className="accounts">
        <section className="accounts-card" aria-label={`Edit profile for ${user.name}`}>
          <form ref={formRef} noValidate onSubmit={save}>
            <AccountFields
              values={draft}
              errors={fieldErrors}
              roleLocked={isSelf}
              onChange={(key, value) => setDraft((d) => ({ ...d, [key]: value }))}
            />
            <div className="accounts-body-note">
              <Switch
                label="Account active"
                checked={draft.active}
                disabled={isSelf}
                onChange={(checked) => setDraft((d) => ({ ...d, active: checked }))}
              />
              {fieldErrors.active && <p className="accounts-field-error">{fieldErrors.active}</p>}
            </div>
            {saveError && (
              <div className="accounts-body-note">
                <Callout tone="danger" title="Profile not saved">
                  {saveError}
                </Callout>
              </div>
            )}
          </form>
        </section>
      </div>
      <FormActionBar
        onCancel={() => setEditing(false)}
        primaryLabel="Save changes"
        primaryLoading={saving}
        onPrimary={() => formRef.current?.requestSubmit()}
      />
    </div>
  )
}
