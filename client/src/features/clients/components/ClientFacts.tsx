// The side panel of facts on the client page (CP-23, board 06):
// jurisdictions, facility types, first, last and next survey, next report due
// and site contacts. Called by screens/ClientRecord. A column beside the tab
// from 1280 px, folded above (tablet) or below (phone) the content under that
// (client-record.css). Contacts show three until Show all.
import { useState } from 'react'
import { Button, Chip, ReportDue } from '../../../design-system'
import type { ClientPage, ClientPageSite } from '../api'
import { distinct, type ClientFacts as Facts } from '../clientFacts'
import { country, day } from '../formatClient'
import { initials } from './ClientAvatar'

// Contacts shown before Show all.
const FEW = 3

// One label and its value.
function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="cl-fact">
      <dt>{label}</dt>
      <dd>{children}</dd>
    </div>
  )
}

export function ClientFacts({
  facts,
  division,
  sites,
  contacts = [],
  sheet = false,
}: {
  facts: Facts
  // Shown here, not as a pill beside the name (round 17).
  division?: string | null
  // The listed sites, which the jurisdictions and facility types come from.
  sites: ClientPageSite[]
  contacts?: NonNullable<ClientPage['contacts']>
  // The Client details sheet (phone): only the five sections of board 22.
  sheet?: boolean
}) {
  const [allContacts, setAllContacts] = useState(false)
  const date = (iso: string | null) => (iso ? day(iso) : 'Not set')
  const jurisdictions = distinct(sites.map((s) => s.jurisdiction))
  const facilities = distinct(sites.map((s) => s.facilityType))
  return (
    <aside
      className={sheet ? 'cl-facts cl-facts--sheet' : 'cl-facts'}
      aria-label={sheet ? 'Client details' : 'Client facts'}
    >
      <dl>
        {division && <Fact label="Division">{division}</Fact>}
        {jurisdictions.length > 0 && (
          <Fact label="Jurisdictions">
            <span className="cl-chips">
              {jurisdictions.map((j) => (
                <Chip key={j} kind="jurisdiction">
                  {country(j)}
                </Chip>
              ))}
            </span>
          </Fact>
        )}
        {facilities.length > 0 && (
          <Fact label="Facility types">
            <span className="cl-chips">
              {facilities.map((f) => (
                <Chip key={f} kind="facility">
                  {f}
                </Chip>
              ))}
            </span>
          </Fact>
        )}
        {!sheet && <Fact label="First survey">{date(facts.firstSurvey)}</Fact>}
        {!sheet && <Fact label="Last survey">{date(facts.lastSurvey)}</Fact>}
        <Fact label="Next survey">
          {/* The same date cell as Next report due, with the site under the date (round 13). */}
          <ReportDue date={facts.nextSurvey?.date} note={facts.nextSurvey?.site} />
        </Fact>
        <Fact label="Next report due">
          <ReportDue date={facts.nextDue?.date} />
        </Fact>
        {contacts.length > 0 && (
          <Fact label="Site contacts">
            <ul className="cl-contacts">
              {(allContacts ? contacts : contacts.slice(0, FEW)).map((c, i) => (
                <li key={i} title={`At ${c.site}`}>
                  <span className="cl-contact-dot" aria-hidden="true">
                    {initials(c.name)}
                  </span>
                  <span>
                    {c.name}
                    {c.role && <span className="cl-muted">{` · ${c.role}`}</span>}
                  </span>
                </li>
              ))}
            </ul>
            {!allContacts && contacts.length > FEW && (
              <Button size="sm" variant="link" onClick={() => setAllContacts(true)}>
                {`Show all ${contacts.length}`}
              </Button>
            )}
          </Fact>
        )}
      </dl>
    </aside>
  )
}
