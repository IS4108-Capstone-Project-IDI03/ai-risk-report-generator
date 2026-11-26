// The search step above an answer (CB-01 AC6, AC8): "searching" while it runs, then a
// quiet one-line summary of what it searched, which opens to list each step (as MikeOSS
// shows an agent's steps). Replaces OpenUI's tool timeline on the chat screen.
import type { ToolActivity } from '@openuidev/react-headless'

// must match the labels in client/src/features/knowledge-base (source type names)
const SOURCE: Record<string, string> = {
  fm_standard: 'FM standards',
  nfpa_standard: 'NFPA standards',
  local_standard: 'Local standards',
  marsh_report: 'Past reports',
}
const COUNTRY = new Intl.DisplayNames(['en'], { type: 'region' })

// `document` is a document the question named, as the planner wrote it.
type Filters = {
  jurisdiction?: string
  facility_type?: string
  source_type?: string
  document?: string
}
type Input = { query?: string; filters?: Filters; also?: string[] }
type Result = { filters?: Filters; passages?: number; declined?: boolean }

function filterNames(f: Filters): string[] {
  return [
    f.jurisdiction && (COUNTRY.of(f.jurisdiction) ?? f.jurisdiction),
    f.facility_type,
    f.source_type && (SOURCE[f.source_type] ?? f.source_type),
    f.document,
  ].filter((x): x is string => Boolean(x))
}

/** The knowledge base search shown above an answer, while running and once done. */
export function SearchStep({ activities }: { activities: ToolActivity[] }) {
  const search = activities.find((a) => a.toolName === 'search_knowledge_base')
  if (!search) return null
  // A status region, so a screen reader hears the search start and finish (AC8). Both
  // states use the same wrapper element, so React keeps one region and its text changes.
  if (search.status !== 'complete')
    return (
      <div className="chat-search" role="status">
        Searching the knowledge base…
      </div>
    )
  let result: Result = {}
  try {
    result = JSON.parse(search.result)
  } catch {
    // A malformed result only loses the filter names and count, not the answer.
  }
  const names = filterNames(result.filters ?? {})
  const input = search.input as Input
  const where = names.length ? ` in ${names.join(' · ')}` : ''
  return (
    <div className="chat-search" role="status">
      {/* <details> opens and closes natively, keyboard included; closed, it's a minor detail. */}
      <details>
        <summary>
          {names.length ? `Searched: ${names.join(' · ')}` : 'Searched the whole knowledge base'}
        </summary>
        <ul>
          {input.query && <li>{`Searched for “${input.query}”${where}`}</li>}
          {(input.also ?? []).map((q) => (
            <li key={q}>{`Also searched for “${q}”`}</li>
          ))}
          <li>
            {result.declined
              ? 'No passage was relevant enough to answer from'
              : `Found ${result.passages ?? 0} relevant passages`}
          </li>
        </ul>
      </details>
    </div>
  )
}
