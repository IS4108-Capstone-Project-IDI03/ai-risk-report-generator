// The Details panel's Site contacts block (AS-06, boards D1, D2): the first few, and See all
// (only when there are more) opens a small list over the panel. Called by DetailsContent.tsx.
import { useState } from 'react'
import { Icon, Popover } from '../../../design-system'
import { initials } from '../../clients/components/ClientAvatar'
import { DetailsHeading } from './DetailsHeading'

type Contact = { name: string; role: string | null }

// One contact: initials, name, and their role in grey.
function Person({ c }: { c: Contact }) {
  return (
    <span className="mb-person">
      <span className="cl-contact-dot" aria-hidden="true">
        {initials(c.name)}
      </span>
      <span>
        {c.name}
        {c.role && <span className="mb-muted">{` · ${c.role}`}</span>}
      </span>
    </span>
  )
}

/** Returns the block; `shown` is how many contacts fit, and `links` makes it one row with just See All. */
export function DetailsContacts({
  contacts,
  shown,
  links = false,
}: {
  contacts: Contact[]
  shown: number
  links?: boolean
}) {
  const [open, setOpen] = useState(false)
  const more = contacts.length - shown
  // Where there is no room for previews, See All is there whenever there is anyone to list.
  const listed = links ? contacts.length > 0 : more > 0
  const seeAll = listed && (
    <Popover
      open={open}
      onOpenChange={setOpen}
      ariaLabel="Site Contacts"
      surfaceClassName="mb-contacts-pop"
      trigger={
        <button
          type="button"
          className="mb-textlink mb-hit"
          aria-label="See All Site Contacts"
          onClick={() => setOpen(!open)}
        >
          See All
          <Icon name="chevron-right" size={14} />
        </button>
      }
    >
      <div className="mb-contacts-list">
        <h4>Site Contacts</h4>
        <ul>
          {contacts.map((c, i) => (
            <li key={i}>
              <Person c={c} />
            </li>
          ))}
        </ul>
      </div>
    </Popover>
  )
  if (links)
    return (
      <section>
        <DetailsHeading big link={seeAll || <span className="mb-none">None yet</span>}>
          Site Contacts
        </DetailsHeading>
      </section>
    )
  return (
    <section>
      <DetailsHeading link={seeAll}>Site Contacts</DetailsHeading>
      {contacts.length === 0 ? (
        <p className="mb-none">None yet</p>
      ) : (
        <ul className="mb-people">
          {contacts.slice(0, shown).map((c, i) => (
            <li key={i}>
              <Person c={c} />
            </li>
          ))}
        </ul>
      )}
      {more > 0 && <p className="mb-more">{`+${more} more`}</p>}
    </section>
  )
}
