// A cited passage's text (CB-02 AC1, KB-02 AC5): the quoted words marked, and a formula the OCR
// read as LaTeX shown as math when the LaTeX is valid, else as written.
// Used by the chat's citation panel and the review workspace's source panel.
import { Fragment, useEffect, useState, type ReactNode } from 'react'
import { quoteSpan } from '../chat/components/quoteSpan'
import { runsOf } from './mathText'

type Props = { text: string; quote: string }
type RenderMath = (latex: string, display: boolean) => string | null

const loadMathRenderer = () => import('./katexRender').then((m) => m.renderMath)

/** Returns KaTeX's renderer once it has downloaded; null until then. */
function useMathRenderer(): RenderMath | null {
  const [render, setRender] = useState<{ fn: RenderMath } | null>(null)
  useEffect(() => {
    let live = true
    loadMathRenderer()
      .then((fn) => live && setRender({ fn }))
      // Without KaTeX the passage stays as written.
      .catch(() => undefined)
    return () => {
      live = false
    }
  }, [])
  return render?.fn ?? null
}

/** The text between start and end, with the part inside `span` in <mark>. */
function marked(text: string, start: number, end: number, span: [number, number] | null) {
  if (!span || span[1] <= start || span[0] >= end) return text.slice(start, end)
  const from = Math.max(start, span[0])
  const to = Math.min(end, span[1])
  return (
    <>
      {text.slice(start, from)}
      <mark>{text.slice(from, to)}</mark>
      {text.slice(to, end)}
    </>
  )
}

/** The passage text, line breaks kept, with the quote in <mark> when it is found. */
export function PassageBody({ text, quote }: Props) {
  const renderMath = useMathRenderer()
  const span = quoteSpan(quote, text)
  const parts: ReactNode[] = runsOf(text).map((run) => {
    // A formula holding quoted words stays as written, so the words can be marked.
    const quoted = span !== null && span[0] < run.end && span[1] > run.start
    const html = run.latex && renderMath && !quoted ? renderMath(run.latex, true) : null
    // KaTeX's own output, from text the knowledge base stored.
    if (html) return <span key={run.start} dangerouslySetInnerHTML={{ __html: html }} />
    return <Fragment key={run.start}>{marked(text, run.start, run.end, span)}</Fragment>
  })
  return (
    // Focusable, so a keyboard user can scroll a long passage.
    <p className="chat-passage-text" tabIndex={0} aria-label="Passage text">
      {parts}
    </p>
  )
}
