// The Clients table (CP-23, board 05): Client (avatar, name, division), Sites,
// Open, Jurisdictions, Next survey (date and site) and Next report due, then
// New assessment, Rename and Remove as hover icons (Remove greyed with the server's
// reason when it isn't allowed). Called by ClientList. On a phone each row is a short
// card with one More button that opens a Sheet (clients.css).
import { useState } from 'react'
import { Badge, Chip, Icon, IconButton, ReportDue, Sheet, useIsPhone } from '../../../design-system'
import type { Allowed } from '../api'
import type { ClientFacts } from '../clientFacts'
import { country } from '../formatClient'
import { ClientAvatar } from './ClientAvatar'
import { RowAction } from './RowAction'

export type ClientRow = {
  id: string
  name: string
  division: string | null
  // Every site the engineer visits there is removed.
  removed: boolean
  sites: number
  jurisdictions: string[]
  facts: ClientFacts
  open: () => void
  newAssessment: () => void
  rename: () => void
  remove: () => void
  // What the server lets the engineer do; null until the clients list has loaded.
  rights: { rename: Allowed; remove: Allowed } | null
}

// A column heading with its small icon.
// The sorted column's heading carries an arrow (board 05).
const Head = ({
  icon,
  arrow,
  children,
}: {
  icon?: string
  arrow?: 'up' | 'down'
  children: string
}) => (
  <th scope="col" aria-sort={arrow ? (arrow === 'up' ? 'ascending' : 'descending') : undefined}>
    <span className="cl-th" data-sorted={arrow ? '' : undefined}>
      {icon && <Icon name={icon} size={14} />}
      {children}
      {arrow && <Icon name={'arrow-' + arrow} size={14} />}
    </span>
  </th>
)

// A row icon the server may refuse: greyed, focusable, with its reason in a box (not an error after a click).
function RuleAction({
  icon,
  label,
  tooltip,
  rule,
  danger,
  onClick,
}: {
  icon: string
  label: string
  tooltip: string
  rule?: Allowed
  danger?: boolean
  onClick: () => void
}) {
  if (!rule || rule.allowed)
    return (
      <RowAction icon={icon} label={label} tooltip={tooltip} danger={danger} onClick={onClick} />
    )
  return (
    <IconButton
      icon={icon}
      label={label}
      title={undefined}
      size="sm"
      style={{ borderRadius: 999, color: 'var(--graphite-400)' }}
      disabledReason={{
        title: danger ? "Can't remove yet" : "Can't rename yet",
        text: rule.reason || 'Not allowed.',
      }}
    />
  )
}

// The reason a refused action gives, or "Not allowed." when the server gave none; undefined when allowed.
const refusal = (rule?: Allowed) =>
  rule?.allowed === false ? rule.reason || 'Not allowed.' : undefined

export function ClientTable({ rows, sort }: { rows: ClientRow[]; sort: string }) {
  const phone = useIsPhone()
  const [more, setMore] = useState<ClientRow | null>(null)
  return (
    <>
      <table className="cl-table cl-clients" aria-label="Your clients">
        <colgroup>
          <col />
          <col className="cl-col-num" />
          <col className="cl-col-num" />
          <col className="cl-col-juris" />
          <col className="cl-col-survey" />
          <col className="cl-col-due" />
          <col className="cl-col-actions-3" />
        </colgroup>
        <thead>
          <tr>
            <Head icon="building-2" arrow={sort === 'name' ? 'up' : undefined}>
              {'Client'}
            </Head>
            <Head>{'Sites'}</Head>
            <Head arrow={sort === 'open' ? 'down' : undefined}>{'Open'}</Head>
            <Head icon="globe">{'Jurisdictions'}</Head>
            <Head icon="calendar" arrow={sort === 'survey' ? 'up' : undefined}>
              {'Next survey'}
            </Head>
            <Head icon="calendar" arrow={sort === 'due' ? 'up' : undefined}>
              {'Next report due'}
            </Head>
            <th scope="col">
              <span className="cl-sr">{'Actions'}</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((c) => (
            <tr key={c.id}>
              <td className="cl-cell-main">
                <button
                  type="button"
                  className="cl-open"
                  aria-label={`Open ${c.name}`}
                  onClick={c.open}
                >
                  <ClientAvatar name={c.name} small />
                  <span className="cl-lines">
                    <span className="cl-line-1">
                      <span className="cl-ellip" dir="auto" title={c.name}>
                        {c.name}
                      </span>
                      {c.removed && <Badge tone="neutral">{'Removed'}</Badge>}
                    </span>
                    {c.division && (
                      <span className="cl-line-2 cl-ellip" dir="auto" title={c.division}>
                        {c.division}
                      </span>
                    )}
                  </span>
                </button>
              </td>
              <td data-label="Sites" className="cl-num">
                {c.sites}
              </td>
              <td data-label="Open" className="cl-num">
                {c.facts.open}
              </td>
              <td data-label="Jurisdictions">
                <span className="cl-chips">
                  {c.jurisdictions.map((j) => (
                    <Chip key={j} kind="jurisdiction">
                      {country(j)}
                    </Chip>
                  ))}
                </span>
              </td>
              <td data-label="Next survey">
                {/* No icon: a long site line would push it far from the date (round 14). */}
                <ReportDue
                  date={c.facts.nextSurvey?.date}
                  note={c.facts.nextSurvey?.site}
                  icon={false}
                />
              </td>
              <td data-label="Report due">
                <ReportDue date={c.facts.nextDue?.date} />
              </td>
              <td className="cl-cell-actions">
                {/* A removed client is restored from its page, so it offers none. */}
                {!c.removed &&
                  (phone ? (
                    <IconButton
                      icon="ellipsis"
                      label={`More for ${c.name}`}
                      title={undefined}
                      style={{ borderRadius: 999 }}
                      onClick={() => setMore(c)}
                    />
                  ) : (
                    <span className="cl-row-actions">
                      <RowAction
                        icon="plus"
                        label={`New assessment for ${c.name}`}
                        tooltip="New assessment"
                        onClick={c.newAssessment}
                      />
                      <RuleAction
                        icon="pencil"
                        label={`Rename client ${c.name}`}
                        tooltip="Rename client"
                        rule={c.rights?.rename}
                        onClick={c.rename}
                      />
                      <RuleAction
                        icon="trash-2"
                        label={`Remove client ${c.name}`}
                        tooltip="Remove client"
                        rule={c.rights?.remove}
                        danger
                        onClick={c.remove}
                      />
                    </span>
                  ))}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <Sheet
        open={!!more}
        onClose={() => setMore(null)}
        title={more?.name ?? ''}
        actions={
          more
            ? [
                { label: 'New assessment', icon: 'plus', onSelect: more.newAssessment },
                {
                  label: 'Rename client',
                  icon: 'pencil',
                  onSelect: more.rename,
                  disabledReason: refusal(more.rights?.rename),
                },
                {
                  label: 'Remove client',
                  icon: 'trash-2',
                  onSelect: more.remove,
                  disabledReason: refusal(more.rights?.remove),
                },
              ]
            : []
        }
      />
    </>
  )
}
