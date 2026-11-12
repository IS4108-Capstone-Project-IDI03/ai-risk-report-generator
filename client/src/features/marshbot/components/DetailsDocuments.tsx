// The Details panel's Client Documents block (AS-06, board D1): the newest few, with See All.
// Called by DetailsContent.tsx. Calls clients/api.ts getClientDocuments.
import { useEffect, useState } from 'react'
import { FileTile, Icon } from '../../../design-system'
import type { Assessment } from '../../assessments/api'
import { formatDay } from '../../assessments/format'
import { getClientDocuments, type ClientDocument } from '../../clients/api'
import { fileSize } from '../../clients/formatClient'
import { DetailsHeading } from './DetailsHeading'

/** Returns the client's documents about this assessment, newest first; 'failed' when they couldn't be read. */
// eslint-disable-next-line react-refresh/only-export-components -- the hook belongs with its block
export function useDocuments(record: Pick<Assessment, 'clientId' | 'id' | 'site'>) {
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
            .sort((a, b) => b.uploadedAt.localeCompare(a.uploadedAt)),
        ),
      )
      .catch(() => {
        if (!abort.signal.aborted) setDocs('failed')
      })
    return () => abort.abort()
  }, [record.clientId, record.site.id, record.id])
  return docs
}

/** Returns the block; `shown` is how many rows fit, and `links` makes it one row with just its link. */
export function DetailsDocuments({
  docs,
  shown,
  links = false,
  onSeeAll,
}: {
  docs: ClientDocument[] | 'failed'
  shown: number
  links?: boolean
  // Opens the client page's Documents tab (CP-23), where every document is.
  onSeeAll?: () => void
}) {
  if (docs === 'failed')
    return (
      <section>
        <DetailsHeading>Client Documents</DetailsHeading>
        <p className="mb-none">Couldn’t load the client’s documents.</p>
      </section>
    )
  const more = docs.length - shown
  const seeAll = docs.length > 0 && onSeeAll && (
    <button
      type="button"
      className="mb-textlink mb-hit"
      aria-label="See All Client Documents"
      onClick={onSeeAll}
    >
      See All
      <Icon name="chevron-right" size={14} />
    </button>
  )
  if (links)
    return (
      <section>
        <DetailsHeading big link={seeAll || <span className="mb-none">None yet</span>}>
          Client Documents
        </DetailsHeading>
      </section>
    )
  return (
    <section>
      <DetailsHeading link={seeAll}>Client Documents</DetailsHeading>
      {docs.length === 0 && <p className="mb-none">None yet</p>}
      {shown > 0 && (
        <ul className="mb-docs">
          {docs.slice(0, shown).map((d) => (
            <li key={d.id}>
              <FileTile name={d.name} contentType={d.contentType} />
              <span className="mb-doc-text">
                <span className="mb-doc-name" title={d.name} dir="auto">
                  {d.name}
                </span>
                <span className="mb-doc-detail">
                  {`${fileSize(d.size)} · ${formatDay(new Date(d.uploadedAt))}`}
                </span>
              </span>
            </li>
          ))}
        </ul>
      )}
      {more > 0 && <p className="mb-more">{`+${more} more`}</p>}
    </section>
  )
}
