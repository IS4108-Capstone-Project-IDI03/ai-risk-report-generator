// The User accounts screen: knowledge admins add team members' accounts (F-08), view and update
// their details (F-03) and assign each one's role (F-05). Shown by features/assessments/AssessmentApp.tsx.
// Holds the loading; the list is always the screen (screens/AccountList.tsx), an account opens in
// a side panel over it (components/AccountPanel.tsx) and Add account in a dialog
// (components/NewAccountDialog.tsx). Every open reads the account from the gateway, so saved
// changes show on reopening. currentUserId is the signed-in admin, who cannot change their own
// role or deactivate themselves.
import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { Button, Callout, toast } from '../../design-system'
import { useWalkthroughScreen } from '../walkthrough/useWalkthroughScreen'
import { getUser, listUsers, roleLabel, type UserAccount } from './api'
import { formatWhen, problem } from './accountFormat'
import { AccountPanel } from './components/AccountPanel'
import { AccountsHeader } from './components/AccountsHeader'
import { NewAccountDialog } from './components/NewAccountDialog'
import { AccountList } from './screens/AccountList'
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
  // Closing the panel reloads the list, so an edit shows in its row.
  const close = () => {
    setSelected(null)
    setListVersion((v) => v + 1)
  }
  const startCreating = () => {
    setCreated(null)
    setCreating(true)
  }
  // Back to the list, reloaded so it includes the new account. A sent invitation is a toast;
  // one that failed stays as a warning on the list, since it needs Resend invitation.
  const finishCreating = (user: UserAccount | null) => {
    setCreating(false)
    if (!user) return
    setListVersion((v) => v + 1)
    if (user.invitationExpiresAt)
      toast.success(`Account created for ${user.name}`, {
        description: `${user.staffId} is active as a ${roleLabel(user.role).toLowerCase()}. An invitation to set a password was emailed to ${user.email}; its link works until ${formatWhen(user.invitationExpiresAt)}.`,
      })
    else setCreated(user)
  }

  // F-12: ready once the list has loaded; held back (no offer) while a profile or the new-account form is open.
  const loaded = list?.key === listKey && 'data' in list ? list.data : null
  useWalkthroughScreen('accounts', !!loaded, creating || !!selected || loaded?.length === 0)

  // The open account: loaded, failed, or still loading (null). One panel (keyed by the account)
  // stays mounted through all three, so closing it returns focus to the row that opened it.
  const current = selected && profile?.key === profileKey ? profile : null
  const panel = selected && (
    <AccountPanel
      key={selected.id}
      user={current && 'data' in current ? current.data : null}
      pending={
        !current ? (
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
        )
      }
      isSelf={selected.id === currentUserId}
      onSaved={(user) => profileKey && setProfile({ key: profileKey, data: user })}
      onClose={close}
    />
  )

  // While the list reloads (after a panel closes) the previous rows stay, so the row that opened
  // the panel is still there to take focus back.
  const currentList = list && (list.key === listKey || 'data' in list) ? list : null
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
            <Callout
              tone="warning"
              title={`Account created for ${created.name}, but no invitation sent`}
            >
              {`The invitation email to ${created.email} could not be sent, so they cannot set a password yet. Open their profile and choose Resend invitation to try again.`}
            </Callout>
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
          <AccountList
            users={currentList.data}
            narrow={narrow}
            openId={selected?.id ?? null}
            onOpen={open}
          />
        )}
      </div>
      {panel}
      {creating && (
        <NewAccountDialog onCreated={finishCreating} onCancel={() => finishCreating(null)} />
      )}
    </>
  )
}
