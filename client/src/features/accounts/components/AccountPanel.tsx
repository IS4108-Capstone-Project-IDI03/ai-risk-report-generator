// One person's account in the design system's SidePanel (F-03), opened from the User accounts
// list in place of a page: their details, the invitation note while they have no password (F-08),
// and its actions in the footer: Resend invitation while it is pending, and Edit profile, which
// turns the panel into the form with Cancel and Save in the same footer.
// Called by UserAccounts.tsx, which keeps this one panel open from "Loading profile…" through the
// loaded account (no remount, so focus returns to the list row on close). Calls updateUser (api.ts).
// Role and Account active are locked for the signed-in admin.
import { useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import {
  Avatar,
  Button,
  Callout,
  Chip,
  Fact,
  FactList,
  SidePanel,
  StatusPill,
  Switch,
  toast,
  useIsPhone,
} from '../../../design-system'
import { GatewayError } from '../../assessments/api'
import { updateUser, roleLabel, type UserAccount, type UserProfile } from '../api'
import { accountStatus, officeLabel, problem, toProfile } from '../accountFormat'
import { AccountFields } from './AccountFields'
import { InvitationNote } from './InvitationNote'
import { useResendInvitation } from './useResendInvitation'

// The panel's own toaster: on a computer it covers the app's (SidePanel `toaster`).
const PANEL_TOASTER = 'account-panel'

/** Returns the panel for one account: its profile once loaded, else `pending` (loading or failed). */
export function AccountPanel({
  user,
  pending,
  isSelf,
  onSaved,
  onClose,
}: {
  user: UserAccount | null
  pending: ReactNode
  isSelf: boolean
  onSaved: (user: UserAccount) => void
  onClose: () => void
}) {
  const phone = useIsPhone()
  const [editing, setEditing] = useState(false)
  // Filled by Edit profile; null until then.
  const [draft, setDraft] = useState<UserProfile | null>(null)
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})
  const [saveError, setSaveError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const formRef = useRef<HTMLFormElement>(null)
  const invitation = useResendInvitation(user, onSaved)

  // Move focus to the first field the gateway rejected (as in NewAccountDialog.tsx).
  useLayoutEffect(() => {
    formRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus()
  }, [fieldErrors])

  function startEditing() {
    if (!user) return
    setDraft(toProfile(user))
    setFieldErrors({})
    setSaveError(null)
    invitation.clear()
    setEditing(true)
  }
  async function save(event: React.FormEvent) {
    event.preventDefault()
    if (saving || !user || !draft) return
    setSaving(true)
    setSaveError(null)
    try {
      const stored = await updateUser(user.id, draft)
      setFieldErrors({})
      setEditing(false)
      // A corrected email on an account still to be set up gets a new invitation; the link sent
      // to the old address stops working (F-08).
      const reinvited = !stored.passwordSet && stored.active && stored.email !== user.email
      const toasterId = phone ? undefined : PANEL_TOASTER
      if (!reinvited) toast.success('Profile saved', { toasterId })
      else if (stored.invitationExpiresAt)
        toast.success('Profile saved', {
          toasterId,
          description: `A new invitation was emailed to ${stored.email}, and the link sent to ${user.email} no longer works.`,
        })
      else
        toast.error('Profile saved, but no invitation sent', {
          toasterId,
          description: `The invitation to ${stored.email} could not be sent. Choose Resend invitation to try again.`,
        })
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

  if (!user)
    return (
      <SidePanel open onClose={onClose} title="Profile">
        {pending}
      </SidePanel>
    )
  const status = accountStatus(user)
  // Changed fields not yet saved: Esc and the backdrop then leave the panel open (Cancel, Close discard).
  const unsaved = editing && !!draft && JSON.stringify(draft) !== JSON.stringify(toProfile(user))
  return (
    <SidePanel
      open
      onClose={onClose}
      unsaved={unsaved}
      title={user.name}
      subtitle={`${user.staffId} · ${roleLabel(user.role)}`}
      lead={<Avatar name={user.name} size={40} />}
      toaster={PANEL_TOASTER}
      footer={
        <div className="accounts-panel-buttons">
          {editing ? (
            <>
              <Button variant="secondary" pill onClick={() => setEditing(false)}>
                Cancel
              </Button>
              <Button
                variant="primary"
                pill
                loading={saving}
                onClick={() => formRef.current?.requestSubmit()}
              >
                Save changes
              </Button>
            </>
          ) : (
            <>
              {/* Only while they have no password and the account is active (F-08). */}
              {!user.passwordSet && user.active && (
                <Button
                  variant="secondary"
                  pill
                  iconLeft="mail"
                  disabled={invitation.sending}
                  onClick={invitation.resend}
                >
                  {invitation.sending ? 'Sending…' : 'Resend invitation'}
                </Button>
              )}
              <Button variant="secondary" pill iconLeft="pencil" onClick={startEditing}>
                Edit profile
              </Button>
            </>
          )}
        </div>
      }
    >
      {editing && draft ? (
        <form
          ref={formRef}
          className="accounts-panel"
          aria-label={`Edit profile for ${user.name}`}
          noValidate
          onSubmit={save}
        >
          <AccountFields
            values={draft}
            errors={fieldErrors}
            roleLocked={isSelf}
            onChange={(key, value) => setDraft((d) => d && { ...d, [key]: value })}
          />
          <div>
            <Switch
              label="Account active"
              checked={draft.active}
              disabled={isSelf}
              onChange={(checked) => setDraft((d) => d && { ...d, active: checked })}
            />
            {fieldErrors.active && <p className="accounts-field-error">{fieldErrors.active}</p>}
          </div>
          {saveError && (
            <Callout tone="danger" title="Profile not saved">
              {saveError}
            </Callout>
          )}
        </form>
      ) : (
        <section className="accounts-panel" aria-label={`Profile for ${user.name}`}>
          <div>
            <StatusPill status={status} />
          </div>
          {!user.passwordSet && <InvitationNote user={user} result={invitation.result} />}
          <FactList>
            <Fact label="Email" wide>
              {user.email}
            </Fact>
            <Fact label="Role">{roleLabel(user.role)}</Fact>
            <Fact label="Office">
              {user.office ? (
                <Chip kind="jurisdiction">{officeLabel(user.office)}</Chip>
              ) : (
                'Not set'
              )}
            </Fact>
            <Fact label="Job title">{user.jobTitle ?? 'Not set'}</Fact>
            <Fact label="Phone">{user.phone ?? 'Not set'}</Fact>
          </FactList>
        </section>
      )}
    </SidePanel>
  )
}
