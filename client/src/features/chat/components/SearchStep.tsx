// The search step above an answer (CB-01 AC6, AC8): "searching" while it runs,
// then which filters it searched with. Replaces OpenUI's tool timeline on the chat screen.
import type { ToolActivity } from '@openuidev/react-headless'

// must match the labels in client/src/features/knowledge-base (source type names)
const SOURCE: Record<string, string> = {
  fm_standard: 'FM standards',
  nfpa_standard: 'NFPA standards',
  marsh_report: 'Past reports',
}
const COUNTRY = new Intl.DisplayNames(['en'], { type: 'region' })

type Filters = { jurisdiction?: string; facility_type?: string; source_type?: string }

function filterNames(f: Filters): string[] {
  return [
    f.jurisdiction && (COUNTRY.of(f.jurisdiction) ?? f.jurisdiction),
    f.facility_type,
    f.source_type && (SOURCE[f.source_type] ?? f.source_type),
  ].filter((x): x is string => Boolean(x))
}

/** The knowledge base search shown above an answer, while running and once done. */
export function SearchStep({ activities }: { activities: ToolActivity[] }) {
  const search = activities.find((a) => a.toolName === 'search_knowledge_base')
  if (!search) return null
  // A status region, so a screen reader hears the search start and finish (AC8).
  if (search.status !== 'complete')
    return (
      <p className="chat-search" role="status">
        Searching the knowledge base…
      </p>
    )
  let filters: Filters = {}
  try {
    filters = JSON.parse(search.result).filters ?? {}
  } catch {
    // A malformed result only loses the filter names, not the answer.
  }
  const names = filterNames(filters)
  return (
    <p className="chat-search" role="status">
      {names.length ? `Searched: ${names.join(' · ')}` : 'Searched the whole knowledge base'}
    </p>
  )
}
