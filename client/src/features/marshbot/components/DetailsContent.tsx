// What the Details panel shows (AS-06 board 06), built from the client page's parts: the client's
// avatar, the site with its chips, type and engineer, survey and report due date cells, site
// contacts, and the client documents that fit with See all. Edit site and the site map from the
// old Overview stay here. Called by DetailsPanel.tsx.
import { useEffect, useState, type ReactNode } from 'react'
import {
  AssessmentTypeTile,
  Chip,
  FileTile,
  Icon,
  IconButton,
  ReportDue,
} from '../../../design-system'
import { formatDay } from '../../assessments/format'
import type { Assessment } from '../../assessments/api'
import { SiteMapCard } from '../../assessments/components/SiteMapCard'
import type { AssessmentWorkflow } from '../../assessments/useAssessmentWorkflow'
import { getClientDocuments, type ClientDocument } from '../../clients/api'
import { ClientAvatar, initials } from '../../clients/components/ClientAvatar'
import { assessmentType, country, fileSize } from '../../clients/formatClient'
import { daysBetween, today } from '../format'

// shortcut: shows the newest few, not a measured "as many as fit"; measure the panel if the
// list ever needs to fill a taller screen exactly.
const DOCUMENTS_SHOWN = 5

// The gateway sends these too (assessment.service.ts toDto); the shared type doesn't list them yet.
export type DetailedRecord = Assessment & {
  siteVisitEndDate?: string | null
  siteContacts?: { name: string; role: string | null }[]
}

// The client's documents about this assessment: the whole client's, its site's and its own;
// 'failed' when they couldn't be read, so that never looks like "no documents".
function useDocuments(record: DetailedRecord) {
  const [docs, setDocs] = useState<ClientDocument[] | 'failed' | null>(null)
  useEffect(() => {
    if (!record.clientId) return
    const abort = new AbortController()
    getClientDocuments(record.clientId, abort.signal)
      .then((all) =>
        setDocs(
          all
            .filter(({ placement: p }) =>
              p.kind === 'client'
                ? true
                : p.kind === 'site'
                  ? p.siteId === record.site.id
                  : p.assessmentId === record.id,
            )
            .reverse(),
        ),
      )
      .catch(() => {
        if (!abort.signal.aborted) setDocs('failed')
      })
    return () => abort.abort()
  }, [record.clientId, record.site.id, record.id])
  return docs
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
}: {
  v: AssessmentWorkflow
  record: DetailedRecord
  onEditSite?: () => void
}) {
  const docs = useDocuments(record)
  const survey = record.siteVisitEndDate ?? record.siteVisitDate
  const surveyDone = !!survey && daysBetween(today(), survey) < 0
  const clientFact = v.ovSiteFacts.find((f) => f.label === 'Client')
  const openClient = clientFact?.open
  const siteReason = v.ovEdit && !v.ovEdit.site.allowed ? v.ovEdit.site.reason : null
  return (
    <div className="mb-details">
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
          {onEditSite && (
            <IconButton
              icon="pencil"
              label="Edit site"
              tooltip="Edit site"
              size="sm"
              className="mb-hit"
              onClick={onEditSite}
            />
          )}
        </div>
        <div className="mb-value">{record.site.name}</div>
        {record.site.address && <div className="mb-value-sub">{record.site.address}</div>}
        {siteReason && <div className="mb-value-sub">{siteReason}</div>}
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
          <ReportDue date={survey} note={surveyDone ? 'Done' : undefined} />
        </section>
        <section>
          <Label>Report due</Label>
          <ReportDue date={record.reportDueDate} />
        </section>
      </div>
      {!!record.siteContacts?.length && (
        <section>
          <Label>Site contacts</Label>
          <ul className="mb-people">
            {record.siteContacts.map((c, i) => (
              <li key={i} className="mb-person">
                <span className="cl-contact-dot" aria-hidden="true">
                  {initials(c.name)}
                </span>
                <span>
                  {c.name}
                  {c.role && <span className="mb-muted">{` · ${c.role}`}</span>}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
      {docs === 'failed' && (
        <section>
          <Label>Client documents</Label>
          <p className="mb-value-sub">Couldn’t load the client’s documents.</p>
        </section>
      )}
      {Array.isArray(docs) && !!docs.length && (
        <section>
          <div className="mb-labelrow">
            <Label>Client documents</Label>
            {/* Opens the client page's Documents tab (CP-23), where every document is. */}
            {clientFact?.documents && (
              <button type="button" className="mb-textlink mb-hit" onClick={clientFact.documents}>
                See all
                <Icon name="chevron-right" size={14} />
              </button>
            )}
          </div>
          <ul className="mb-docs">
            {docs.slice(0, DOCUMENTS_SHOWN).map((d) => (
              <li key={d.id}>
                <FileTile name={d.name} contentType={d.contentType} />
                <span className="mb-row-text">
                  <span className="mb-doc-name" title={d.name} dir="auto">
                    {d.name}
                  </span>
                  <span className="mb-row-detail">
                    {`${fileSize(d.size)} · ${formatDay(new Date(d.uploadedAt))}`}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
      {v.ovMap && <SiteMapCard {...v.ovMap} onSaved={v.siteSaved} />}
    </div>
  )
}
