// What reading each knowledge document cost (EV-04): labelling, OCR and
// embedding per document, split by billed service or stage, with the full
// table below. Knowledge admins only (the gateway enforces it): documents are
// shared, so this is the knowledge base's cost, not any one person's.
// Shown by screens/UsageCosts.tsx; calls GET /api/usage/ingestion.
import { useState } from 'react'
import { Callout, EmptyState, Input, Select } from '../../../design-system'
import {
  getIngestionUsage,
  ingestionExportUrl,
  type DocumentUsage,
  type IngestionQuery,
  type Range,
  type UsageView,
} from '../api'
import { CostSummary } from '../components/CostSummary'
import { DocumentTable } from '../components/DocumentTable'
import { StackedCostChart } from '../components/StackedCostChart'
import { DEFAULT_RANGE, RANGES, SPLITS } from '../options'
import { useLoad } from '../useLoad'

// Has the reader's search in its title or file name.
const matches = (d: DocumentUsage, search: string) =>
  !search || [d.title, d.fileName].some((t) => t?.toLowerCase().includes(search.toLowerCase()))

export function IngestionUsageTab() {
  const [range, setRange] = useState<Range>(DEFAULT_RANGE)
  const [split, setSplit] = useState<UsageView>('service')
  const [search, setSearch] = useState('')
  const query: IngestionQuery = { split, range }
  const { data, error, loading, retry } = useLoad(JSON.stringify(query), (signal) =>
    getIngestionUsage(query, signal),
  )
  const shown = error ? null : data
  // The chart names each bar by its document's title.
  const bars = (shown?.documents ?? []).map((d) => ({ ...d, label: d.title }))

  return (
    <div className="uc" aria-busy={loading}>
      <div className="uc-toolbar">
        <div className="uc-filters">
          <Select
            label="Period"
            value={range}
            onChange={(e) => setRange(e.target.value as Range)}
            options={RANGES}
          />
          <Select
            label="Split each bar by"
            value={split}
            onChange={(e) => setSplit(e.target.value as UsageView)}
            options={SPLITS}
          />
        </div>
        {shown && shown.totals.calls > 0 && (
          <a className="uc-export" href={ingestionExportUrl(query)} download>
            Export CSV
          </a>
        )}
      </div>

      {loading && !shown && <p role="status">Loading usage…</p>}
      {error !== null && (
        <Callout
          tone="danger"
          title="Usage not shown"
          actions={
            <button type="button" className="uc-link" onClick={retry}>
              Try again
            </button>
          }
        >
          <span role="alert">Usage could not be loaded. Check your connection and try again.</span>
        </Callout>
      )}

      {shown && shown.totals.calls === 0 && (
        <EmptyState
          icon="inbox"
          title="No documents read in this period"
          description="Costs appear here once a knowledge document has been labelled, read or indexed. Try a longer period."
        />
      )}

      {shown && shown.totals.calls > 0 && (
        <>
          <CostSummary totals={shown.totals} />
          <section className="uc-section" aria-labelledby="uc-doc-chart">
            <h2 id="uc-doc-chart">Cost by document</h2>
            <StackedCostChart title="Cost by document" noun="documents" groups={bars} />
          </section>
          <section className="uc-section" aria-labelledby="uc-doc-table">
            <h2 id="uc-doc-table">Documents</h2>
            <div className="uc-filters">
              <Input
                label="Find a document"
                iconLeft="search"
                value={search}
                placeholder="Title or file name"
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
            <DocumentTable documents={shown.documents.filter((d) => matches(d, search))} />
          </section>
        </>
      )}
    </div>
  )
}
