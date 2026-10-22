import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type * as React from 'react'
import {
  Badge,
  Button,
  Callout,
  EmptyState,
  Input,
  Select,
  Switch,
  Table,
} from '../../design-system'
import { GatewayError } from '../assessments/api'
import { JURISDICTIONS } from '../assessments/demo-data'
import {
  createUser,
  getUser,
  listUsers,
  resendInvitation,
  ROLE_LABELS,
  roleLabel,
  updateUser,
  type NewUserAccount,
  type UserAccount,
  type UserProfile,
  type UserRole,
} from './api'
import './accounts.css'

type Loaded<T> = { key: string; data: T } | { key: string; error: string }

const ROLE_OPTIONS = (Object.keys(ROLE_LABELS) as UserRole[]).map((value) => ({
  value,
  label: ROLE_LABELS[value],
}))
// A new account has no role until the admin picks one (F-08).
const NEW_ROLE_OPTIONS = [{ value: '', label: 'Choose a role' }, ...ROLE_OPTIONS]
const OFFICE_OPTIONS = [{ value: '', label: 'Not set' }, ...JURISDICTIONS]
const EMPTY_ACCOUNT: NewUserAccount = {
  name: '',
  email: '',
  role: '',
  jobTitle: '',
  phone: '',
  office: '',
}

// What the account list and profile badge say. Deactivated comes first: such
// an account cannot sign in whether or not a password is set. Until the owner
// sets a password from their invitation (F-08), the account is pending.
function accountStatus(user: UserAccount): { label: string; tone: string } {
  if (!user.active) return { label: 'Deactivated', tone: 'neutral' }
  if (!user.passwordSet) return { label: 'Invitation pending', tone: 'info' }
  return { label: 'Active', tone: 'low' }
}
// e.g. 25 Oct 2026, 09:30, in the viewer's time zone.
function formatWhen(iso: string) {
  return new Date(iso).toLocaleString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}
function officeLabel(code: string | null) {
  if (!code) return 'Not set'
  return JURISDICTIONS.find((j) => j.value === code)?.label ?? code
}
function initials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0].toUpperCase())
    .join('')
}
function problem(error: unknown, action: string) {
  if (error instanceof GatewayError && error.status === 404)
    return 'This account no longer exists. Return to the list and choose another account.'
  if (error instanceof GatewayError && error.status === null)
    return `The gateway could not be reached, so ${action}. Check that the server is running, then try again.`
  return `Something went wrong, so ${action}. Try again.`
}
function toProfile(user: UserAccount): UserProfile {
  return {
    name: user.name,
    email: user.email,
    role: user.role,
    jobTitle: user.jobTitle ?? '',
    phone: user.phone ?? '',
    office: user.office ?? '',
    active: user.active,
  }
}

// Knowledge admins add team members' accounts (F-08), view and update their
// details (F-03) and assign each one's role (F-05). Every open reads the
// account from the gateway, so saved changes show on reopening. currentUserId
// is the signed-in admin, who cannot change their own role or deactivate
// themselves.
export function UserAccounts({
  narrow,
  currentUserId,
}: {
  narrow: boolean
  currentUserId: string
}) {
  const [listVersion, setListVersion] = useState(0)
  const [list, setList] = useState<Loaded<UserAccount[]> | null>(null)
  const [selected, setSelected] = useState<{ id: string; version: number } | null>(null)
  const [profile, setProfile] = useState<Loaded<UserAccount> | null>(null)
  const [creating, setCreating] = useState(false)
  const [created, setCreated] = useState<UserAccount | null>(null)

  const listKey = String(listVersion)
  useEffect(() => {
    const controller = new AbortController()
    listUsers(controller.signal).then(
      (users) => setList({ key: listKey, data: users }),
      (error: unknown) => {
        if (!controller.signal.aborted)
          setList({ key: listKey, error: problem(error, 'the accounts could not be loaded') })
      },
    )
    return () => controller.abort()
  }, [listKey])

  const profileKey = selected ? `${selected.id}:${selected.version}` : null
  useEffect(() => {
    if (!selected || !profileKey) return
    const controller = new AbortController()
    getUser(selected.id, controller.signal).then(
      (user) => setProfile({ key: profileKey, data: user }),
      (error: unknown) => {
        if (!controller.signal.aborted)
          setProfile({ key: profileKey, error: problem(error, 'the profile could not be loaded') })
      },
    )
    return () => controller.abort()
  }, [selected, profileKey])

  const open = (id: string) => {
    setCreated(null)
    setSelected((s) => ({ id, version: (s?.version ?? 0) + 1 }))
  }
  const back = () => {
    setSelected(null)
    setListVersion((v) => v + 1)
  }
  const startCreating = () => {
    setCreated(null)
    setCreating(true)
  }
  // Back to the list, reloaded so it includes the new account.
  const finishCreating = (user: UserAccount | null) => {
    setCreating(false)
    setCreated(user)
    if (user) setListVersion((v) => v + 1)
  }

  if (creating) {
    return (
      <div className="accounts">
        <div>
          <Button variant="ghost" iconLeft="arrow-left" onClick={() => finishCreating(null)}>
            Back to accounts
          </Button>
        </div>
        <NewAccountPanel onCreated={finishCreating} onCancel={() => finishCreating(null)} />
      </div>
    )
  }

  if (selected) {
    const current = profile?.key === profileKey ? profile : null
    return (
      <div className="accounts">
        <div>
          <Button variant="ghost" iconLeft="arrow-left" onClick={back}>
            Back to accounts
          </Button>
        </div>
        {!current ? (
          <p className="accounts-loading" role="status">
            Loading profile…
          </p>
        ) : 'error' in current ? (
          <Callout
            tone="danger"
            title="Profile not loaded"
            actions={
              <Button variant="secondary" size="sm" onClick={() => open(selected.id)}>
                Try again
              </Button>
            }
          >
            {current.error}
          </Callout>
        ) : (
          <ProfilePanel
            key={current.key}
            user={current.data}
            isSelf={current.data.id === currentUserId}
            onSaved={(user) => setProfile({ key: current.key, data: user })}
          />
        )}
      </div>
    )
  }

  const currentList = list?.key === listKey ? list : null
  const addButton = (
    <Button variant="primary" iconLeft="plus" onClick={startCreating}>
      Add account
    </Button>
  )
  return (
    <div className="accounts">
      <div className="accounts-toolbar">
        <p className="accounts-intro">
          {
            'A role decides what each person can open: risk engineers run assessments; knowledge admins manage the knowledge base and these accounts.'
          }
        </p>
        {addButton}
      </div>
      {created && (
        <div role="status">
          {created.invitationExpiresAt ? (
            <Callout tone="success" title={`Account created for ${created.name}`}>
              {`${created.staffId} is active as a ${roleLabel(created.role).toLowerCase()}. An invitation to set a password was emailed to ${created.email}; its link works until ${formatWhen(created.invitationExpiresAt)}.`}
            </Callout>
          ) : (
            <Callout
              tone="warning"
              title={`Account created for ${created.name}, but no invitation sent`}
            >
              {`The invitation email to ${created.email} could not be sent, so they cannot set a password yet. Open their profile and choose Resend invitation to try again.`}
            </Callout>
          )}
        </div>
      )}
      {!currentList ? (
        <p className="accounts-loading" role="status">
          Loading accounts…
        </p>
      ) : 'error' in currentList ? (
        <Callout
          tone="danger"
          title="Accounts not loaded"
          actions={
            <Button variant="secondary" size="sm" onClick={() => setListVersion((v) => v + 1)}>
              Try again
            </Button>
          }
        >
          {currentList.error}
        </Callout>
      ) : currentList.data.length === 0 ? (
        <EmptyState
          icon="users"
          title="No accounts yet"
          description="Add your team's accounts, or run the server seed script for the sample ones."
          action={addButton}
        />
      ) : narrow ? (
        <ul className="accounts-stack" aria-label="User accounts">
          {currentList.data.map((user) => (
            <li key={user.id}>
              <button
                type="button"
                className="accounts-stack-item"
                aria-label={`Open profile for ${user.name}`}
                onClick={() => open(user.id)}
              >
                <span className="accounts-avatar" aria-hidden="true">
                  {initials(user.name)}
                </span>
                <span className="accounts-stack-text">
                  <strong>{user.name}</strong>
                  <small>
                    {roleLabel(user.role)} · {user.email}
                  </small>
                </span>
                {accountStatus(user).label !== 'Active' && (
                  <Badge tone={accountStatus(user).tone}>{accountStatus(user).label}</Badge>
                )}
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <Table
          columns={[
            {
              key: 'name',
              header: 'Name',
              render: (row) => (
                <button
                  type="button"
                  className="accounts-link"
                  aria-label={`Open profile for ${row.name}`}
                  onClick={() => open(String(row.id))}
                >
                  {row.name}
                </button>
              ),
            },
            { key: 'staffId', header: 'Staff ID' },
            { key: 'email', header: 'Email' },
            { key: 'role', header: 'Role' },
            { key: 'office', header: 'Office' },
            { key: 'status', header: 'Status' },
          ]}
          rows={currentList.data.map((user) => ({
            id: user.id,
            name: user.name,
            staffId: <span className="accounts-mono">{user.staffId}</span>,
            email: user.email,
            role: roleLabel(user.role),
            office: officeLabel(user.office),
            status: <Badge tone={accountStatus(user).tone}>{accountStatus(user).label}</Badge>,
          }))}
        />
      )}
    </div>
  )
}

function ProfilePanel({
  user,
  isSelf,
  onSaved,
}: {
  user: UserAccount
  isSelf: boolean
  onSaved: (user: UserAccount) => void
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState<UserProfile>(() => toProfile(user))
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})
  const [saveError, setSaveError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState<string | null>(null)
  const formRef = useRef<HTMLFormElement>(null)

  // Move focus to the first field the gateway rejected. A layout effect, so
  // it lands in the same commit that marks the fields invalid, before the
  // error message can be seen or read out without it.
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
    setSaving(true)
    setSaveError(null)
    try {
      const stored = await updateUser(user.id, draft)
      setFieldErrors({})
      setEditing(false)
      // A corrected email on an account still to be set up gets a new
      // invitation; the link sent to the old address stops working (F-08).
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

  const header = (
    <div className="accounts-profile-head">
      <span className="accounts-avatar accounts-avatar-lg" aria-hidden="true">
        {initials(user.name)}
      </span>
      <div className="accounts-profile-title">
        <h2>{user.name}</h2>
        <span>
          <span className="accounts-mono">{user.staffId}</span> · {roleLabel(user.role)}
        </span>
      </div>
      <Badge tone={accountStatus(user).tone}>{accountStatus(user).label}</Badge>
    </div>
  )

  if (!editing) {
    return (
      <section className="accounts-card" aria-label={`Profile for ${user.name}`}>
        {header}
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
            <dt>Name</dt>
            <dd>{user.name}</dd>
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
        <div className="accounts-actions">
          <Button variant="primary" iconLeft="pencil" onClick={startEditing}>
            Edit profile
          </Button>
        </div>
      </section>
    )
  }

  return (
    <section className="accounts-card" aria-label={`Edit profile for ${user.name}`}>
      {header}
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
        <div className="accounts-actions">
          <Button type="submit" variant="primary" iconLeft="save" disabled={saving}>
            {saving ? 'Saving…' : 'Save changes'}
          </Button>
          <Button variant="ghost" disabled={saving} onClick={() => setEditing(false)}>
            Cancel
          </Button>
        </div>
      </form>
    </section>
  )
}

type AccountFieldValues = Pick<UserProfile, 'name' | 'email' | 'jobTitle' | 'phone' | 'office'> & {
  role: UserRole | ''
}

// The account fields shared by adding (F-08) and editing (F-03) an account.
// Each shows the gateway's problem with it, if any.
function AccountFields({
  values,
  errors,
  onChange,
  roleOptions = ROLE_OPTIONS,
  roleLocked = false,
}: {
  values: AccountFieldValues
  errors: Record<string, string>
  onChange: (key: keyof AccountFieldValues, value: string) => void
  roleOptions?: { value: string; label: string }[]
  roleLocked?: boolean
}) {
  return (
    <div className="accounts-form">
      <Input
        label="Name"
        required
        value={values.name}
        error={errors.name}
        autoComplete="off"
        onChange={(e) => onChange('name', e.target.value)}
      />
      <Input
        label="Email"
        type="email"
        required
        value={values.email}
        error={errors.email}
        autoComplete="off"
        onChange={(e) => onChange('email', e.target.value)}
      />
      <Select
        label="Role"
        required
        options={roleOptions}
        value={values.role}
        error={errors.role}
        disabled={roleLocked}
        hint={roleLocked ? 'Another knowledge admin must change your role.' : undefined}
        onChange={(e) => onChange('role', e.target.value)}
      />
      <Input
        label="Job title"
        hint="Optional"
        value={values.jobTitle}
        error={errors.jobTitle}
        onChange={(e) => onChange('jobTitle', e.target.value)}
      />
      <Input
        label="Phone"
        type="tel"
        hint="Optional, e.g. +65 6123 4567"
        value={values.phone}
        error={errors.phone}
        onChange={(e) => onChange('phone', e.target.value)}
      />
      <Select
        label="Office"
        options={OFFICE_OPTIONS}
        value={values.office}
        error={errors.office}
        onChange={(e) => onChange('office', e.target.value)}
      />
    </div>
  )
}

// For an account whose owner has not set a password yet (F-08): when their
// invitation link expires, and a way to email them a new one, e.g. after it
// expired or never arrived. A new link cancels the earlier one.
function InvitationNote({
  user,
  onSent,
}: {
  user: UserAccount
  onSent: (user: UserAccount) => void
}) {
  const [sending, setSending] = useState(false)
  const [result, setResult] = useState<{ tone: string; text: string } | null>(null)
  // Read once, as the profile opens: whether the link has lapsed only needs
  // to be right when the admin looks.
  const [openedAt] = useState(() => Date.now())

  async function resend() {
    if (sending) return
    setSending(true)
    setResult(null)
    try {
      const stored = await resendInvitation(user.id)
      setResult({
        tone: 'success',
        text: `A new invitation was emailed to ${stored.email}. Any earlier link no longer works.`,
      })
      onSent(stored)
    } catch (error: unknown) {
      setResult({
        tone: 'danger',
        text:
          error instanceof GatewayError && (error.status === 409 || error.status === 503)
            ? error.message
            : problem(error, 'the invitation was not sent'),
      })
    } finally {
      setSending(false)
    }
  }

  const expiresAt = user.invitationExpiresAt
  const linkOpen = expiresAt !== null && Date.parse(expiresAt) > openedAt
  const status = !user.active
    ? 'Reactivate the account to send them an invitation.'
    : expiresAt === null
      ? 'No invitation link is open. Send one so they can set a password.'
      : linkOpen
        ? `The link in their invitation email works until ${formatWhen(expiresAt)}.`
        : `Their invitation link expired on ${formatWhen(expiresAt)}. Send a new one so they can set a password.`

  return (
    <>
      <div className="accounts-body-note">
        <Callout
          tone={linkOpen || !user.active ? 'info' : 'warning'}
          title="They have not set a password yet"
          actions={
            user.active ? (
              <Button
                variant="secondary"
                size="sm"
                iconLeft="mail"
                disabled={sending}
                onClick={resend}
              >
                {sending ? 'Sending…' : 'Resend invitation'}
              </Button>
            ) : undefined
          }
        >
          {status}
        </Callout>
      </div>
      {result && (
        <div role={result.tone === 'danger' ? 'alert' : 'status'} className="accounts-body-note">
          <Callout
            tone={result.tone}
            title={result.tone === 'danger' ? 'Invitation not sent' : 'Invitation sent'}
          >
            {result.text}
          </Callout>
        </div>
      )}
    </>
  )
}

// Adds a team member's account (F-08). Nothing is saved until the gateway
// accepts every field; each field it rejects shows its own problem. Once it
// is, the gateway emails them an invitation to set their password.
function NewAccountPanel({
  onCreated,
  onCancel,
}: {
  onCreated: (user: UserAccount) => void
  onCancel: () => void
}) {
  const [draft, setDraft] = useState<NewUserAccount>(EMPTY_ACCOUNT)
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})
  const [saveError, setSaveError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const formRef = useRef<HTMLFormElement>(null)

  // Move focus to the first field the gateway rejected. A layout effect, so
  // it lands in the same commit that marks the fields invalid, before the
  // error message can be seen or read out without it.
  useLayoutEffect(() => {
    formRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus()
  }, [fieldErrors])

  async function save(event: React.FormEvent) {
    event.preventDefault()
    if (saving) return
    setSaving(true)
    setSaveError(null)
    try {
      onCreated(await createUser(draft))
    } catch (error: unknown) {
      if (error instanceof GatewayError && Object.keys(error.fields).length > 0) {
        setFieldErrors(error.fields)
        setSaveError('Correct the highlighted fields, then add the account again.')
      } else {
        setFieldErrors({})
        setSaveError(problem(error, 'the account was not added'))
      }
      setSaving(false)
    }
  }

  return (
    <section className="accounts-card" aria-label="Add account">
      <div className="accounts-profile-head">
        <div className="accounts-profile-title">
          <h2>Add account</h2>
          <span>
            The account is active once added, and its staff ID is assigned for you. They are emailed
            a link to set their password.
          </span>
        </div>
      </div>
      <form ref={formRef} noValidate onSubmit={save}>
        <AccountFields
          values={draft}
          errors={fieldErrors}
          roleOptions={NEW_ROLE_OPTIONS}
          onChange={(key, value) => setDraft((d) => ({ ...d, [key]: value }))}
        />
        {saveError && (
          <div className="accounts-body-note">
            <Callout tone="danger" title="Account not added">
              {saveError}
            </Callout>
          </div>
        )}
        <div className="accounts-actions">
          <Button type="submit" variant="primary" iconLeft="plus" disabled={saving}>
            {saving ? 'Adding…' : 'Add account'}
          </Button>
          <Button variant="ghost" disabled={saving} onClick={onCancel}>
            Cancel
          </Button>
        </div>
      </form>
    </section>
  )
}
