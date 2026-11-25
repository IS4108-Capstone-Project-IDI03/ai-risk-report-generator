// The User accounts list (F-03, F-05): one white card holding the standard table, or on a phone
// a stack of rows. Opening a name shows that person's profile. Called by UserAccounts.tsx.
// Anyone not Active carries a badge beside their name; Active, the usual case, says nothing.
import { Badge, Chip, EmptyState, TableFooter } from '../../../design-system'
import { Tip } from '../../help/Tip'
import { roleLabel, type UserAccount } from '../api'
import { accountStatus, initials, officeLabel } from '../accountFormat'

// The name's badge, left out for an Active account.
function StatusBadge({ user }: { user: UserAccount }) {
  const status = accountStatus(user)
  return status.label === 'Active' ? null : <Badge tone={status.tone}>{status.label}</Badge>
}

export function AccountList({
  users,
  narrow,
  onOpen,
}: {
  users: UserAccount[]
  narrow: boolean
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
      <div className="accounts-list">
        <ul className="accounts-stack" aria-label="User accounts">
          {users.map((user, i) => (
            <li key={user.id} data-walk={i === 0 ? 'accounts.row-1' : undefined}>
              <button
                type="button"
                className="accounts-stack-item"
                aria-label={`Open profile for ${user.name}`}
                data-walk={i === 0 ? 'accounts.row-1.name' : undefined}
                onClick={() => onOpen(user.id)}
              >
                <span className="accounts-avatar" aria-hidden="true">
                  {initials(user.name)}
                </span>
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
      </div>
    )

  return (
    <div className="accounts-list">
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
            <tr key={user.id} data-walk={i === 0 ? 'accounts.row-1' : undefined}>
              <th scope="row">
                <span className="accounts-name">
                  <span className="accounts-avatar" aria-hidden="true">
                    {initials(user.name)}
                  </span>
                  <button
                    type="button"
                    className="accounts-link"
                    aria-label={`Open profile for ${user.name}`}
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
    </div>
  )
}
