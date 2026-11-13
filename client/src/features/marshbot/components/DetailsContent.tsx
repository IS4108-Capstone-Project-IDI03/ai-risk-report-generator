// What the Details panel shows (AS-06 boards 06, D1): the client's avatar, the site with its
// chips, type and engineer, survey and report due date cells, then three blocks with a fixed
// budget each (site contacts, client documents, site map) so the panel never scrolls. Called by
// DetailsPanel.tsx. Calls DetailsContacts, DetailsDocuments, DetailsPlaces and useDetailsBudget.
import { useRef, type ReactNode } from 'react'
import { AssessmentTypeTile, Chip, IconButton, ReportDue, useIsPhone } from '../../../design-system'
import type { Assessment } from '../../assessments/api'
import { rowsOf } from '../../assessments/components/siteMapEdit'
import type { AssessmentWorkflow } from '../../assessments/useAssessmentWorkflow'
import { ClientAvatar, initials } from '../../clients/components/ClientAvatar'
import { assessmentType, country } from '../../clients/formatClient'
import { daysBetween, today } from '../format'
import { DetailsContacts } from './DetailsContacts'
import { DetailsDocuments, useDocuments } from './DetailsDocuments'
import { DetailsPlaces } from './DetailsPlaces'
import { useDetailsBudget } from './useDetailsBudget'
import './details.css'

// The gateway sends these too (assessment.service.ts toDto); the shared type doesn't list them yet.
export type DetailedRecord = Assessment & {
  siteVisitEndDate?: string | null
  siteContacts?: { name: string; role: string | null }[]
}

// A fact's small heading, under the panel's "Details" (h2).
function Label({ children }: { children: ReactNode }) {
  return <h3 className="mb-label">{children}</h3>
}

/** Returns the panel's facts; `onEditSite` is absent when the site isn't this engineer's to change. */
export function DetailsContent({
  v,
  record,
  onEditSite,
  siteReason,
  onOpenMap,
}: {
  v: AssessmentWorkflow
  record: DetailedRecord
  onEditSite?: () => void
  // Why the site can't be edited (someone else's assessment uses it): the pencil stays, greyed,
  // and says so (design system v2: grey out and explain).
  siteReason?: string | null
  // Swaps the panel to the site map (SiteMapPanel); absent for a sample assessment with no map.
  onOpenMap?: () => void
}) {
  const docs = useDocuments(record)
  const contacts = record.siteContacts ?? []
  const places = v.ovMap ? rowsOf(v.ovMap.site, v.ovMap.buildings) : []
  // Each block's budget shrinks until nothing scrolls (a phone's sheet scrolls, so it keeps all).
  const root = useRef<HTMLDivElement>(null)
  const phone = useIsPhone()
  const budget = useDetailsBudget(
    root,
    !phone,
    [contacts.length, Array.isArray(docs) ? docs.length : docs, places.length].join(),
  )
  const survey = record.siteVisitEndDate ?? record.siteVisitDate
  const surveyDone = !!survey && daysBetween(today(), survey) < 0
  const clientFact = v.ovSiteFacts.find((f) => f.label === 'Client')
  const openClient = clientFact?.open
  return (
    <div ref={root} className="mb-details">
      <div className="mb-details-client">
        <ClientAvatar name={record.client} />
        <div>
          {/* The client's name opens its page (CP-18), where the engineer may manage it. */}
          {openClient ? (
            <button type="button" className="mb-details-name mb-link mb-hit" onClick={openClient}>
              {record.client}
            </button>
          ) : (
            <div className="mb-details-name">{record.client}</div>
          )}
          <div className="mb-details-ref">{record.reference}</div>
        </div>
      </div>
      <section aria-label="Site">
        <div className="mb-labelrow">
          <Label>Site</Label>
          {(onEditSite || siteReason) && (
            <IconButton
              icon="pencil"
              label="Edit Site"
              tooltip="Edit Site"
              size="sm"
              className="mb-hit"
              onClick={onEditSite}
              disabledReason={
                onEditSite || !siteReason
                  ? undefined
                  : { title: 'Can’t edit this site', text: siteReason }
              }
            />
          )}
        </div>
        <div className="mb-value">{record.site.name}</div>
        {record.site.address && <div className="mb-value-sub">{record.site.address}</div>}
        <div className="mb-chips">
          <Chip kind="jurisdiction">{country(record.site.jurisdiction)}</Chip>
          <Chip kind="facility">{record.site.facilityType}</Chip>
        </div>
      </section>
      <div className="mb-two">
        <section>
          <Label>Type</Label>
          <AssessmentTypeTile type={assessmentType(record.surveyType)} size={28} showLabel />
        </section>
        <section>
          <Label>Engineer</Label>
          <span className="mb-person">
            <span className="cl-contact-dot" aria-hidden="true">
              {initials(record.engineer?.name ?? '')}
            </span>
            {record.engineer?.name ?? 'Not assigned'}
          </span>
        </section>
        <section>
          <Label>{record.siteVisitEndDate ? 'Survey ends' : 'Survey'}</Label>
          <ReportDue date={survey} note={surveyDone ? 'Done' : undefined} todayLabel="Today" />
        </section>
        <section>
          <Label>Report due</Label>
          <ReportDue date={record.reportDueDate} todayLabel="Today" />
        </section>
      </div>
      <DetailsContacts contacts={contacts} shown={budget.contacts} links={budget.links} />
      {docs && (
        <DetailsDocuments
          docs={docs}
          shown={budget.documents}
          links={budget.links}
          onSeeAll={clientFact?.documents}
        />
      )}
      {onOpenMap && v.ovMap && (
        <DetailsPlaces
          rows={places}
          shown={budget.places}
          links={budget.links}
          onOpenMap={onOpenMap}
        />
      )}
    </div>
  )
}
