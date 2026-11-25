// The User accounts screen: knowledge admins add team members' accounts (F-08), view and update
// their details (F-03) and assign each one's role (F-05). Shown by features/assessments/AssessmentApp.tsx.
// Holds the loading and the choice of screen; each screen is in screens/. Every open reads the
// account from the gateway, so saved changes show on reopening. currentUserId is the signed-in
// admin, who cannot change their own role or deactivate themselves.
import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { Button, Callout } from '../../design-system'
import { useWalkthroughScreen } from '../walkthrough/useWalkthroughScreen'
import { getUser, listUsers, roleLabel, type UserAccount } from './api'
import { formatWhen, problem } from './accountFormat'
import { AccountsHeader } from './components/AccountsHeader'
import { AccountList } from './screens/AccountList'
import { AccountProfile } from './screens/AccountProfile'
import { NewAccount } from './screens/NewAccount'
import './accounts.css'

type Loaded<T> = { key: string; data: T } | { key: string; error: string }

export function UserAccounts({
  narrow,
  currentUserId,
  bell,
}: {
  narrow: boolean
  currentUserId: string
  bell?: ReactNode
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

  // F-12: ready once the list has loaded; held back (no offer) while a profile or the new-account form is open.
  const loaded = list?.key === listKey && 'data' in list ? list.data : null
  useWalkthroughScreen('accounts', !!loaded, creating || !!selected || loaded?.length === 0)

  if (creating)
    return (
      <NewAccount onCreated={finishCreating} onCancel={() => finishCreating(null)} bell={bell} />
    )

  if (selected) {
    const current = profile?.key === profileKey ? profile : null
    if (current && 'data' in current)
      return (
        <AccountProfile
          key={current.key}
          user={current.data}
          isSelf={current.data.id === currentUserId}
          onSaved={(user) => setProfile({ key: current.key, data: user })}
          onBack={back}
          bell={bell}
        />
      )
    return (
      <>
        <AccountsHeader
          title="Profile"
          back={{ label: 'Back to accounts', onClick: back }}
          bell={bell}
        />
        <div className="accounts">
          {!current ? (
            <p className="accounts-loading" role="status">
              Loading profile…
            </p>
          ) : (
            <Callout
              tone="danger"
              title="Profile not loaded"
              actions={
                <Button variant="secondary" size="sm" pill onClick={() => open(selected.id)}>
                  Try again
                </Button>
              }
            >
              {'error' in current ? current.error : ''}
            </Callout>
          )}
        </div>
      </>
    )
  }

  const currentList = list?.key === listKey ? list : null
  return (
    <>
      <AccountsHeader
        title="User accounts"
        helper="Who can sign in, and what each role lets them open."
        bell={bell}
        action={
          <Button variant="create" iconLeft="plus" data-walk="accounts.add" onClick={startCreating}>
            Add account
          </Button>
        }
      />
      <div className="accounts">
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
              <Button
                variant="secondary"
                size="sm"
                pill
                onClick={() => setListVersion((v) => v + 1)}
              >
                Try again
              </Button>
            }
          >
            {currentList.error}
          </Callout>
        ) : (
          <AccountList users={currentList.data} narrow={narrow} onOpen={open} />
        )}
      </div>
    </>
  )
}
