// The components the model may use in a chat answer (CB-01). The model writes OpenUI Lang
// (one `name = Component(...)` per line); OpenUI renders it as it streams.
// Registered on the chat screen (screens/KnowledgeAssistant.tsx); the rag-service builds
// its answer prompt from the same names, so they must match microservices/rag-service/app/chat/.
import { createLibrary, defineComponent } from '@openuidev/react-lang'
import { z } from 'zod'
import { Badge, Callout, IconRegistry } from '../../design-system'
import { CitationMarker } from './components/CitationMarker'
import {
  CitationCheckContext,
  CitationNumbersContext,
  checkKey,
  type CitedSource,
} from './components/citationCheck'

// must match DECLINE in microservices/rag-service/app/chat/answer.py
const DECLINE = 'The knowledge base cannot answer this question.'

// Each passage label's number, in the order the answer first cites it (1, 2, 3…), found by
// walking the parsed answer. Without it every marker showed its label's digit, so five
// claims from passage P1 all read "1" and a P3 cited first read "3".
function citationNumbers(node: unknown, numbers = new Map<string, number>()) {
  if (Array.isArray(node)) node.forEach((child) => citationNumbers(child, numbers))
  else if (node && typeof node === 'object') {
    const element = node as { typeName?: string; props?: Record<string, unknown> }
    const passage = element.typeName === 'Cite' ? element.props?.passage : undefined
    if (typeof passage === 'string' && !numbers.has(passage)) numbers.set(passage, numbers.size + 1)
    Object.values(element.props ?? {}).forEach((value) => citationNumbers(value, numbers))
  }
  return numbers
}

const Cite = defineComponent({
  name: 'Cite',
  description: 'A citation: the passage label (e.g. "P1") and its exact words, at most 25.',
  props: z.object({ passage: z.string(), quote: z.string() }),
  component: ({ props }) => <CitationMarker passage={props.passage} quote={props.quote} />,
})

const Statement = defineComponent({
  name: 'Statement',
  description: 'One statement of the answer and the citations that support it.',
  props: z.object({ text: z.string(), cites: z.array(Cite.ref) }),
  component: ({ props, renderNode }) =>
    // A declined answer is a callout with a next step, not an answer-shaped paragraph (AC3).
    props.text === DECLINE && !props.cites.length ? (
      <div data-decline>
        <Callout tone="info" title="No answer in the knowledge base">
          {DECLINE} Try naming the standard, edition or report, or ask your knowledge admin to add
          the document.
        </Callout>
      </div>
    ) : (
      <p className="chat-statement">
        {props.text} {renderNode(props.cites)}
      </p>
    ),
})

const Cell = defineComponent({
  name: 'Cell',
  description: 'A table cell and the citations that support it.',
  props: z.object({ text: z.string(), cites: z.array(Cite.ref).optional() }),
  component: ({ props, renderNode }) => (
    <>
      {props.text} {renderNode(props.cites ?? [])}
    </>
  ),
})

// ponytail: our own table, since OpenUI's Table takes plain strings and a cell must cite.
const CitedTable = defineComponent({
  name: 'CitedTable',
  description: 'A comparison table. Every cell is a Cell with its own citations.',
  props: z.object({ headers: z.array(z.string()), rows: z.array(z.array(Cell.ref)) }),
  component: ({ props, renderNode }) => (
    // Scrolls sideways on a phone instead of pushing the conversation wider than the screen.
    <div className="chat-table-wrap">
      <table className="chat-table">
        <thead>
          <tr>
            {props.headers.map((h, i) => (
              <th key={i}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {props.rows.map((row, r) => (
            <tr key={r}>
              {row.map((cell, c) => (
                <td key={c}>{renderNode(cell)}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  ),
})

const MetaSource = z.object({
  label: z.string(),
  documentId: z.string(),
  pageStart: z.number().optional(),
  pageEnd: z.number().optional(),
  withdrawn: z.boolean().optional(),
})

// Written by the server, never the model: the quote check's result (CB-01 AC2).
const Meta = defineComponent({
  name: 'Meta',
  description: 'Server only. Never write this.',
  props: z.object({
    sources: z.array(MetaSource),
    unverified: z.array(z.object({ label: z.string(), quote: z.string() })),
  }),
  component: () => null,
})

const Answer = defineComponent({
  name: 'Answer',
  description: 'The whole answer: its blocks in order, then meta.',
  props: z.object({
    blocks: z.array(z.union([Statement.ref, CitedTable.ref])),
    meta: z.optional(Meta.ref),
  }),
  component: ({ props, renderNode }) => {
    // The Meta line arrives last; until then markers show as "checking".
    const meta = (
      props.meta as
        | { props?: { sources?: CitedSource[]; unverified?: { label: string; quote: string }[] } }
        | undefined
    )?.props
    const check = meta?.sources
      ? {
          sources: new Map(meta.sources.map((s) => [s.label, s])),
          unverified: new Set((meta.unverified ?? []).map((u) => checkKey(u.label, u.quote))),
        }
      : null
    return (
      <CitationCheckContext.Provider value={check}>
        <CitationNumbersContext.Provider value={citationNumbers(props.blocks)}>
          {/* Generated content wears the AI violet (docs/design-system.md principles 1 and 2). */}
          <div className="chat-answer">
            <Badge tone="ai" icon={IconRegistry.evidence.insight}>
              AI answer
            </Badge>
            {renderNode(props.blocks)}
          </div>
        </CitationNumbersContext.Provider>
      </CitationCheckContext.Provider>
    )
  },
})

/** The chat answer's component library: Answer, Statement, CitedTable, Cell, Cite, Meta. */
export const chatLibrary = createLibrary({
  components: [Answer, Statement, CitedTable, Cell, Cite, Meta],
  root: 'Answer',
})
