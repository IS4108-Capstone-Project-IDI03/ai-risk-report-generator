// The client card pinned at the foot of MarshBot's rail (AS-06 canvas P6): the client's avatar,
// name and the assessment's reference, each on one line ending in "…", with both in full in its
// tooltip; a real button with a chevron that opens Details (board 06).
// Called by Rail.tsx. Reuses the client page's ClientAvatar.
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
    <Tooltip
      label={
        <span className="mb-client-tip">
          {name}
          <br />
          {reference}
        </span>
      }
      style={{ display: 'flex', width: '100%', flex: 'none' }}
    >
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
