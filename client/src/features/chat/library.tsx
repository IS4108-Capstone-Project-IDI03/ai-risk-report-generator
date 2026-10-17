// The components the model may use in a chat answer (CB-01). The model writes OpenUI Lang
// (one `name = Component(...)` per line); OpenUI renders it as it streams.
// Registered on the chat screen (screens/KnowledgeAssistant.tsx); the rag-service builds
// its answer prompt from the same names, so they must match microservices/rag-service/app/chat/.
import { createLibrary, defineComponent } from '@openuidev/react-lang'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@openuidev/react-ui'
import { z } from 'zod'
import { createContext, useContext } from 'react'
import { Callout } from '../../design-system'
import { CitationMarker } from './components/CitationMarker'
import { withBold } from './components/bold'
import { CitedText } from './components/CitedText'
import {
  CitationCheckContext,
  CitationNumbersContext,
  checkKey,
  type CitedSource,
} from './components/citationCheck'

// must match DECLINE in microservices/rag-service/app/chat/answer.py
const DECLINE = 'The knowledge base cannot answer this question.'

// Each citation's number (passage label + quoted words), in the order the answer first
// cites it (1, 2, 3…), found by walking the parsed answer. Per quote, not per passage:
// two different quotes from one passage showed the same number and looked like one source.
// The same quote cited again keeps its number.
function citationNumbers(node: unknown, numbers = new Map<string, number>()) {
  if (Array.isArray(node)) node.forEach((child) => citationNumbers(child, numbers))
  else if (node && typeof node === 'object') {
    const element = node as { typeName?: string; props?: Record<string, unknown> }
    const { passage, quote } = element.typeName === 'Cite' ? (element.props ?? {}) : {}
    const key = typeof passage === 'string' && typeof quote === 'string' && checkKey(passage, quote)
    if (key && !numbers.has(key)) numbers.set(key, numbers.size + 1)
    Object.values(element.props ?? {}).forEach((value) => citationNumbers(value, numbers))
  }
  return numbers
}

// Inside a Paragraph a statement is one sentence of running text, not its own block.
const InParagraph = createContext(false)

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
  component: function StatementView({ props, renderNode }) {
    const inParagraph = useContext(InParagraph)
    const body = (
      <>
        <CitedText text={props.text} cites={renderNode(props.cites)} />
      </>
    )
    if (inParagraph) return <span className="chat-sentence">{body} </span>
    // A declined answer is a callout with a next step, not an answer-shaped paragraph (AC3).
    return props.text === DECLINE && !props.cites.length ? (
      <div data-decline>
        <Callout tone="info" title="No answer in the knowledge base">
          {DECLINE} Try naming the standard, edition or report, or ask your knowledge admin to add
          the document.
        </Callout>
      </div>
    ) : (
      <p className="chat-statement">{body}</p>
    )
  },
})

// Two to four statements read as one paragraph, so the answer flows like prose.
const Paragraph = defineComponent({
  name: 'Paragraph',
  description: 'A paragraph of 2 to 4 statements that read on from each other.',
  props: z.object({ statements: z.array(Statement.ref) }),
  component: ({ props, renderNode }) => (
    <p className="chat-statement">
      <InParagraph.Provider value={true}>{renderNode(props.statements)}</InParagraph.Provider>
    </p>
  ),
})

const Cell = defineComponent({
  name: 'Cell',
  description: 'A table cell and the citations that support it.',
  props: z.object({ text: z.string(), cites: z.array(Cite.ref).optional() }),
  component: ({ props, renderNode }) => (
    <>
      <CitedText text={props.text} cites={renderNode(props.cites ?? [])} />
    </>
  ),
})

// OpenUI's table parts (not its GenUI Table, which takes plain strings): a cell must cite.
const CitedTable = defineComponent({
  name: 'CitedTable',
  description: 'A comparison table. Every cell is a Cell with its own citations.',
  props: z.object({ headers: z.array(z.string()), rows: z.array(z.array(Cell.ref)) }),
  component: ({ props, renderNode }) => (
    // Its container scrolls sideways on a phone instead of widening the conversation.
    <Table className="chat-table" containerClassName="chat-table-wrap">
      <TableHeader>
        <TableRow>
          {props.headers.map((h, i) => (
            <TableHead key={i}>{h}</TableHead>
          ))}
        </TableRow>
      </TableHeader>
      <TableBody>
        {props.rows.map((row, r) => (
          <TableRow key={r}>
            {row.map((cell, c) => (
              <TableCell key={c}>{renderNode(cell)}</TableCell>
            ))}
          </TableRow>
        ))}
      </TableBody>
    </Table>
  ),
})

const MetaSource = z.object({
  label: z.string(),
  documentId: z.string(),
  // The passage's id, for fetching its text (CB-02). Sent by rag-service answer.py's meta line.
  passageId: z.string().optional(),
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

// The one question an answer may end on, so the engineer can carry on the conversation.
// It claims nothing, so it cites nothing and the quote check skips it.
const FollowUp = defineComponent({
  name: 'FollowUp',
  description: 'One follow-up question the engineer may want next. No citations.',
  props: z.object({ question: z.string() }),
  component: ({ props }) => <p className="chat-followup">{withBold(props.question)}</p>,
})

const Answer = defineComponent({
  name: 'Answer',
  description: 'The whole answer: its blocks in order, then meta.',
  props: z.object({
    blocks: z.array(z.union([Paragraph.ref, Statement.ref, CitedTable.ref, FollowUp.ref])),
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
          <div className="chat-answer">{renderNode(props.blocks)}</div>
        </CitationNumbersContext.Provider>
      </CitationCheckContext.Provider>
    )
  },
})

/** The chat answer's component library: Answer and the blocks, citations and Meta inside it. */
export const chatLibrary = createLibrary({
  components: [Answer, Paragraph, Statement, CitedTable, Cell, Cite, FollowUp, Meta],
  root: 'Answer',
})
