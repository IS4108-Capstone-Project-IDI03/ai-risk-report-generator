// The client page's header (CP-23, boards 06 and 22): Back, the name, Rename and
// Remove pills (Remove greyed out with its reason box when refused), New
// assessment and the tabs, in the kit's top bar. The division is in the facts
// panel, not here. On a phone: no avatar, a round + and a ⋯ that opens the More sheet.
// Called by screens/ClientRecord. Calls TopBar, Button, Sheet.
import { useState, type ReactNode } from 'react'
import { Button, IconButton, Sheet, Tooltip, TopBar, useIsPhone } from '../../../design-system'
import { useCompact } from '../../assessments/useCompact'
import { ClientAvatar } from './ClientAvatar'

// Rename or Remove: whether the engineer may, and if not why, and what opens it.
export type HeaderAction = { allowed: boolean; reason: string | null; open: () => void }

export function ClientHeader({
  name,
  rename,
  remove,
  onNewAssessment,
  onDetails,
  onBack,
  bell,
  tabs,
}: {
  name: string
  // Null for a removed client, which is restored first.
  rename: HeaderAction | null
  remove: HeaderAction | null
  onNewAssessment: (() => void) | null
  // Opens the Client details sheet (phone More sheet).
  onDetails: () => void
  onBack: () => void
  bell?: ReactNode
  tabs: ReactNode
}) {
  const phone = useIsPhone()
  // Under 820 px the board's labelled Rename and Remove leave the name no room, so they are round icons.
  const tablet = useCompact(819) && !phone
  const [more, setMore] = useState(false)
  // A refused action stays focusable but inert; its reason shows in a box (board 06 A).
  const pill = (
    a: HeaderAction,
    label: string,
    icon: string,
    blocked: string,
    danger?: boolean,
  ) => {
    const reason = a.allowed
      ? undefined
      : { title: blocked, text: a.reason ?? "You can't do this here." }
    if (tablet) {
      const round = (
        <IconButton
          icon={icon}
          label={label}
          title={undefined}
          disabledReason={reason}
          onClick={a.open}
          style={{
            borderRadius: 999,
            background: danger && a.allowed ? 'var(--red-50)' : 'var(--graphite-100)',
            color: danger && a.allowed ? 'var(--action-danger)' : 'var(--graphite-600)',
          }}
        />
      )
      // A refused one shows its reason box instead of a tooltip.
      return a.allowed ? <Tooltip label={label}>{round}</Tooltip> : round
    }
    return (
      <Button
        pill
        variant={danger && a.allowed ? 'danger-tonal' : 'pill'}
        iconLeft={icon}
        aria-label={label}
        disabledReason={reason}
        onClick={a.open}
      >
        {label.split(' ')[0]}
      </Button>
    )
  }
  const back = { label: 'Back to Clients', onClick: onBack }
  if (phone)
    return (
      <>
        <TopBar
          back={back}
          title={name}
          action={
            <span className="cl-phone-actions">
              {onNewAssessment && (
                <IconButton
                  icon="plus"
                  label="New assessment"
                  size="lg"
                  onClick={onNewAssessment}
                  style={{ background: 'var(--marsh-navy)', color: '#fff', borderRadius: 999 }}
                />
              )}
              <IconButton
                icon="ellipsis"
                label="More actions"
                size="lg"
                onClick={() => setMore(true)}
                style={{ background: 'var(--graphite-100)', borderRadius: 999 }}
              />
            </span>
          }
          bell={bell}
          tabs={tabs}
        />
        <Sheet
          open={more}
          onClose={() => setMore(false)}
          title={name}
          actions={[
            { label: 'Client details', icon: 'info', onSelect: onDetails },
            ...(rename
              ? [
                  {
                    label: 'Rename client',
                    icon: 'pencil',
                    onSelect: rename.open,
                    disabledReason: rename.allowed ? undefined : (rename.reason ?? 'Not allowed.'),
                  },
                ]
              : []),
            ...(remove
              ? [
                  {
                    label: 'Remove client',
                    icon: 'trash-2',
                    destructive: true,
                    onSelect: remove.open,
                    disabledReason: remove.allowed ? undefined : (remove.reason ?? 'Not allowed.'),
                  },
                ]
              : []),
          ]}
        />
      </>
    )
  return (
    <TopBar
      back={back}
      lead={<ClientAvatar name={name} />}
      eyebrow="Clients"
      title={<span title={name}>{name}</span>}
      action={
        <span className="cl-header-actions">
          {rename && pill(rename, 'Rename client', 'pencil', "Can't rename yet")}
          {remove && pill(remove, 'Remove client', 'trash-2', "Can't remove yet", true)}
          {onNewAssessment && (
            <Button variant="primary" pill iconLeft="plus" onClick={onNewAssessment}>
              {'New assessment'}
            </Button>
          )}
        </span>
      }
      bell={bell}
      tabs={tabs}
    />
  )
}
