// The User accounts list (F-03, F-05): one white card holding the standard table, or on a phone
// a stack of rows. Opening a name shows that person's profile in a side panel; their row keeps
// the selected tint while it is open. Called by UserAccounts.tsx.
// Anyone not Active carries a status pill beside their name; Active, the usual case, says nothing.
import { Avatar, Chip, EmptyState, ListCard, StatusPill, TableFooter } from '../../../design-system'
import { Tip } from '../../help/Tip'
import { roleLabel, type UserAccount } from '../api'
import { accountStatus, officeLabel } from '../accountFormat'

// The name's badge, left out for an Active account.
function StatusBadge({ user }: { user: UserAccount }) {
  const status = accountStatus(user)
  return status === 'account_active' ? null : <StatusPill status={status} />
}

export function AccountList({
  users,
  narrow,
  openId,
  onOpen,
}: {
  users: UserAccount[]
  narrow: boolean
  // The account whose panel is open.
  openId: string | null
  onOpen: (id: string) => void
}) {
  if (users.length === 0)
    return (
      <EmptyState
        icon="users"
        title="No accounts yet"
        description="Add your team's accounts, or run the server seed script for the sample ones."
      />
    )
  const pending = users.filter((u) => u.active && !u.passwordSet).length
  const footer = (
    <TableFooter>
      {`${users.length} ${users.length === 1 ? 'account' : 'accounts'}${pending ? ` · ${pending} invited` : ''}`}
    </TableFooter>
  )

  if (narrow)
    return (
      <ListCard className="accounts-list">
        <ul className="accounts-stack" aria-label="User accounts">
          {users.map((user, i) => (
            <li
              key={user.id}
              data-walk={i === 0 ? 'accounts.row-1' : undefined}
              data-open={user.id === openId || undefined}
            >
              <button
                type="button"
                className="accounts-stack-item"
                aria-label={`Open profile for ${user.name}`}
                aria-haspopup="dialog"
                data-walk={i === 0 ? 'accounts.row-1.name' : undefined}
                onClick={() => onOpen(user.id)}
              >
                <Avatar name={user.name} size={32} />
                {/* A narrow list has no headings (F-12): its "headings" tag sits inside row 1, so the highlight is row 1 alone. */}
                <span
                  className="accounts-stack-text"
                  data-walk={i === 0 ? 'accounts.head' : undefined}
                >
                  <strong>{user.name}</strong>
                  <small>
                    {roleLabel(user.role)} · {user.email}
                  </small>
                </span>
                <StatusBadge user={user} />
              </button>
            </li>
          ))}
        </ul>
        {footer}
      </ListCard>
    )

  return (
    <ListCard className="accounts-list">
      <table className="accounts-table" aria-label="User accounts">
        <colgroup>
          <col />
          <col className="accounts-col-id" />
          <col />
          <col className="accounts-col-role" />
          <col className="accounts-col-office" />
        </colgroup>
        <thead data-walk="accounts.head">
          <tr>
            <th scope="col">Name</th>
            <th scope="col">Staff ID</th>
            <th scope="col">Email</th>
            <th scope="col">
              <span className="accounts-th-tip">
                {'Role'}
                <Tip id="accounts.role" />
              </span>
            </th>
            <th scope="col">Office</th>
          </tr>
        </thead>
        <tbody>
          {users.map((user, i) => (
            <tr
              key={user.id}
              data-walk={i === 0 ? 'accounts.row-1' : undefined}
              data-open={user.id === openId || undefined}
            >
              <th scope="row">
                <span className="accounts-name">
                  <Avatar name={user.name} size={32} />
                  <button
                    type="button"
                    className="accounts-link"
                    aria-label={`Open profile for ${user.name}`}
                    aria-haspopup="dialog"
                    data-walk={i === 0 ? 'accounts.row-1.name' : undefined}
                    onClick={() => onOpen(user.id)}
                  >
                    {user.name}
                  </button>
                  <StatusBadge user={user} />
                </span>
              </th>
              <td data-label="Staff ID">
                <Chip kind="code">{user.staffId}</Chip>
              </td>
              <td data-label="Email">{user.email}</td>
              <td data-label="Role">{roleLabel(user.role)}</td>
              <td data-label="Office">
                {user.office ? (
                  <Chip kind="jurisdiction">{officeLabel(user.office)}</Chip>
                ) : (
                  <span className="accounts-muted">Not set</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {footer}
    </ListCard>
  )
}
