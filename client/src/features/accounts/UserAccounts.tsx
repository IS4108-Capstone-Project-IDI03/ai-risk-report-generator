import { useEffect, useRef, useState } from 'react'
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
  getUser,
  listUsers,
  ROLE_LABELS,
  updateUser,
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
const OFFICE_OPTIONS = [{ value: '', label: 'Not set' }, ...JURISDICTIONS]

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

// Knowledge admins view and update team members' account details (F-03).
// Every open reads the account from the gateway, so saved changes show on
// reopening.
export function UserAccounts({ narrow }: { narrow: boolean }) {
  const [listVersion, setListVersion] = useState(0)
  const [list, setList] = useState<Loaded<UserAccount[]> | null>(null)
  const [selected, setSelected] = useState<{ id: string; version: number } | null>(null)
  const [profile, setProfile] = useState<Loaded<UserAccount> | null>(null)

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

  const open = (id: string) => setSelected((s) => ({ id, version: (s?.version ?? 0) + 1 }))
  const back = () => {
    setSelected(null)
    setListVersion((v) => v + 1)
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
            onSaved={(user) => setProfile({ key: current.key, data: user })}
          />
        )}
      </div>
    )
  }

  const currentList = list?.key === listKey ? list : null
  return (
    <div className="accounts">
      <Callout tone="info" title="Access is not restricted yet">
        {
          'Anyone signed in to this demo can edit accounts; sign-in and the knowledge admin role arrive with F-04. Saved changes go to the database the gateway is connected to.'
        }
      </Callout>
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
          description="Run the server seed script to add the sample accounts."
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
                    {ROLE_LABELS[user.role]} · {user.email}
                  </small>
                </span>
                {!user.active && <Badge tone="neutral">Deactivated</Badge>}
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
            role: ROLE_LABELS[user.role],
            office: officeLabel(user.office),
            status: (
              <Badge tone={user.active ? 'low' : 'neutral'}>
                {user.active ? 'Active' : 'Deactivated'}
              </Badge>
            ),
          }))}
        />
      )}
    </div>
  )
}

function ProfilePanel({
  user,
  onSaved,
}: {
  user: UserAccount
  onSaved: (user: UserAccount) => void
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState<UserProfile>(() => toProfile(user))
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})
  const [saveError, setSaveError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const formRef = useRef<HTMLFormElement>(null)

  // Move focus to the first field the gateway rejected.
  useEffect(() => {
    formRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus()
  }, [fieldErrors])

  function set<K extends keyof UserProfile>(key: K, value: UserProfile[K]) {
    setDraft((d) => ({ ...d, [key]: value }))
  }
  function startEditing() {
    setDraft(toProfile(user))
    setFieldErrors({})
    setSaveError(null)
    setSaved(false)
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
      setSaved(true)
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
          <span className="accounts-mono">{user.staffId}</span> · {ROLE_LABELS[user.role]}
        </span>
      </div>
      <Badge tone={user.active ? 'low' : 'neutral'}>{user.active ? 'Active' : 'Deactivated'}</Badge>
    </div>
  )

  if (!editing) {
    return (
      <section className="accounts-card" aria-label={`Profile for ${user.name}`}>
        {header}
        {saved && (
          <div role="status" className="accounts-body-note">
            <Callout tone="success" title="Profile saved">
              The changes are stored and will show whenever this profile is opened.
            </Callout>
          </div>
        )}
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
            <dd>{ROLE_LABELS[user.role]}</dd>
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
        <div className="accounts-form">
          <Input
            label="Name"
            required
            value={draft.name}
            error={fieldErrors.name}
            onChange={(e) => set('name', e.target.value)}
          />
          <Input
            label="Email"
            type="email"
            required
            value={draft.email}
            error={fieldErrors.email}
            onChange={(e) => set('email', e.target.value)}
          />
          <Select
            label="Role"
            options={ROLE_OPTIONS}
            value={draft.role}
            error={fieldErrors.role}
            onChange={(e) => set('role', e.target.value as UserRole)}
          />
          <Input
            label="Job title"
            hint="Optional"
            value={draft.jobTitle}
            error={fieldErrors.jobTitle}
            onChange={(e) => set('jobTitle', e.target.value)}
          />
          <Input
            label="Phone"
            type="tel"
            hint="Optional, e.g. +65 6123 4567"
            value={draft.phone}
            error={fieldErrors.phone}
            onChange={(e) => set('phone', e.target.value)}
          />
          <Select
            label="Office"
            options={OFFICE_OPTIONS}
            value={draft.office}
            error={fieldErrors.office}
            onChange={(e) => set('office', e.target.value)}
          />
        </div>
        <div className="accounts-body-note">
          <Switch
            label="Account active"
            checked={draft.active}
            onChange={(checked) => set('active', checked)}
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
