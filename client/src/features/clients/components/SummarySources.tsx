// The sources under the Insights summary (CP-29): each statement's citation numbers point here.
// Drawn with the shared EvidenceCitation, as the Ask tab's sources are; the one a citation was
// chosen for is lit. A few show (six, three on a phone), then "Show all N sources". Called by InsightSummaryCard.
import { Fragment } from 'react'
import { Button, EvidenceCitation } from '../../../design-system'
import type { InsightSource } from '../api'

export function SummarySources({
  sources,
  few,
  cited,
  showAll,
  onShowAll,
}: {
  sources: InsightSource[]
  // How many show before Show all.
  few: number
  // The source number a citation was chosen for, or null.
  cited: number | null
  showAll: boolean
  onShowAll: () => void
}) {
  const listed = showAll ? sources : sources.slice(0, few)
  return (
    <div className="ci-sources-block">
      <h3 className="ci-label">{'Sources'}</h3>
      <ol className="ci-sources">
        {listed.map((source) => {
          const on = cited === source.n
          return (
            <li key={source.n} data-on={on || undefined}>
              <EvidenceCitation
                index={source.n}
                kind={source.kind}
                source={<span dir="auto">{source.title}</span>}
                locator={[source.meta, source.reference].filter(Boolean).map((part, i) => (
                  // Each part stays whole ("RPT-2026-0005" never splits at its hyphen); the
                  // line may break between parts.
                  <Fragment key={i}>
                    {i > 0 && ' · '}
                    <span className="ci-part">{part}</span>
                  </Fragment>
                ))}
                excerpt={
                  <span className="ci-source-quote" dir="auto">
                    {source.quote}
                  </span>
                }
                // Lit in the AI tint when its citation is chosen (the Ask tab's chosen source look).
                style={
                  on ? { background: 'var(--ai-bg)', borderColor: 'var(--ai-border)' } : undefined
                }
              />
            </li>
          )
        })}
      </ol>
      {listed.length < sources.length && (
        <Button variant="link" size="sm" className="ds-press ci-link" onClick={onShowAll}>
          {`Show all ${sources.length} sources`}
        </Button>
      )}
    </div>
  )
}
