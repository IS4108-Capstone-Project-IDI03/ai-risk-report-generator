// An Ask answer's or proposed text's cited sources (AS-01, AS-04, AS-08), under MarshBot's
// bubble as the Overview puts a card under its words: numbered as the statements first cite them,
// each an EvidenceCitation that opens in the evidence panel (or, for a template part, its place).
// Drawn by AnswerTurn.tsx and ProposalTurn.tsx.
import { Badge, EvidenceCitation } from '../../../../design-system'
import { excerpt, pageLocator, severityLabel } from '../../reviewDisplay'
import type { AskCitation } from '../api'
import { notFound, PART_KIND, sourceName, type AskSource } from '../sources'

/** Returns the "Sources" list of an answer's cited sources. */
export function SourceList({
  order,
  number,
  sources,
  current,
  onOpen,
}: {
  order: AskCitation[]
  number: Map<string, number>
  sources: Map<string, AskSource>
  current: string | null
  onOpen: (ref: string) => void
}) {
  return (
    <section className="ask-sources" aria-label="Sources">
      <h4 className="rv-label">Sources</h4>
      <ul className="rv-panel-list">
        {order.map((c) => {
          const source = sources.get(c.ref)
          const passage =
            source?.kind === 'standard' || source?.kind === 'report' ? source.passage : null
          const observation = source?.kind === 'observation' ? source.observation : null
          const part = source?.kind === 'template' ? source.part : null
          return (
            <li key={c.ref}>
              <EvidenceCitation
                index={number.get(c.ref)}
                kind={c.kind}
                source={
                  <>
                    {sourceName(source, c)}
                    {notFound(c) ? (
                      <span className="rv-flag">
                        <Badge tone="moderate" icon="triangle-alert">
                          Quote not found
                        </Badge>
                      </span>
                    ) : (
                      c.described && (
                        <span className="rv-flag">
                          <Badge tone="info" icon="info">
                            AI reading of figure
                          </Badge>
                        </span>
                      )
                    )}
                  </>
                }
                locator={
                  passage
                    ? (pageLocator(passage) ?? undefined)
                    : observation
                      ? severityLabel(observation.severity || 'not set')
                      : part
                        ? PART_KIND[part.kind]
                        : undefined
                }
                excerpt={
                  c.quote
                    ? `“${c.quote}”`
                    : passage
                      ? excerpt(passage.text)
                      : observation?.note
                        ? excerpt(observation.note)
                        : part
                          ? excerpt(part.text)
                          : undefined
                }
                onOpen={() => onOpen(c.ref)}
                style={
                  current === c.ref
                    ? {
                        border: '1px solid var(--border-focus)',
                        background: 'var(--surface-selected)',
                      }
                    : undefined
                }
              />
            </li>
          )
        })}
      </ul>
    </section>
  )
}
