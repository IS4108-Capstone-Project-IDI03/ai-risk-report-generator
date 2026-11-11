// The client card at the foot of MarshBot's rail (AS-06 board 01): the client's avatar, name and
// the assessment's reference, a real button with a chevron that opens Details (board 06).
// Called by screens/MarshBotOverview.tsx. Reuses the client page's ClientAvatar.
import { Icon, Tooltip } from '../../../design-system'
import { ClientAvatar } from '../../clients/components/ClientAvatar'

/** Returns the clickable client card. */
export function ClientCard({
  name,
  reference,
  onOpen,
}: {
  name: string
  reference: string
  onOpen: () => void
}) {
  return (
    <Tooltip label="Assessment details" style={{ display: 'flex', width: '100%' }}>
      <button
        type="button"
        className="mb-client"
        onClick={onOpen}
        aria-label={`${name}, ${reference}. Open assessment details`}
      >
        <ClientAvatar name={name} />
        <span className="mb-client-text">
          <span className="mb-client-name">{name}</span>
          <span className="mb-client-ref">{reference}</span>
        </span>
        <span className="mb-client-chev" aria-hidden="true">
          <Icon name="chevron-right" size={16} />
        </span>
      </button>
    </Tooltip>
  )
}
