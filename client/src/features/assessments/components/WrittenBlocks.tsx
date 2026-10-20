import { Fragment } from 'react'
import type { DocumentBlock, DocumentInline } from '../api'

// Text as the engineer formatted it in the document editor (RV-08): bold,
// italic and underline, with each citation marker where it sits, drawn by
// `cite` (left out without it).
export function RichWords({
  content,
  cite,
}: {
  content: DocumentInline[]
  cite?: (id: string) => React.ReactNode
}) {
  return (
    <>
      {content.map((c, i) => {
        if (c.type === 'cite') return <Fragment key={i}>{cite?.(c.id)}</Fragment>
        let text: React.ReactNode = c.text
        if (c.marks?.includes('underline')) text = <u>{text}</u>
        if (c.marks?.includes('italic')) text = <em>{text}</em>
        if (c.marks?.includes('bold')) text = <strong>{text}</strong>
        return (
          <span key={i} className="rv-statement-text">
            {text}
          </span>
        )
      })}
    </>
  )
}

// A section's text from the document editor (RV-08): paragraphs, sub-headings
// and lists. A block taken from the draft is drawn by `finding` when given,
// told whether it was set as a sub-heading; otherwise, like the engineer's
// own, as text, which `flagged` can mark unsupported.
export function WrittenBlocks({
  blocks,
  cite,
  finding,
  flagged,
}: {
  blocks: DocumentBlock[]
  cite?: (id: string) => React.ReactNode
  finding?: (key: string, content: DocumentInline[], heading: boolean) => React.ReactNode
  flagged?: (key: string | null | undefined) => boolean
}) {
  const paragraph = (key: string | null | undefined, content: DocumentInline[]) =>
    key && finding ? (
      finding(key, content, false)
    ) : (
      <p className={'rv-statement rv-written' + (flagged?.(key) ? ' is-unsupported' : '')}>
        <RichWords content={content} cite={cite} />
      </p>
    )
  return (
    <>
      {blocks.map((b, i) => {
        if (b.type === 'heading')
          return b.finding && finding ? (
            <Fragment key={i}>{finding(b.finding, b.content, true)}</Fragment>
          ) : (
            <h4
              key={i}
              className={'rv-written-heading' + (flagged?.(b.finding) ? ' is-unsupported' : '')}
            >
              <RichWords content={b.content} cite={cite} />
            </h4>
          )
        if (b.type === 'paragraph')
          return <Fragment key={i}>{paragraph(b.finding, b.content)}</Fragment>
        const List = b.type === 'orderedList' ? 'ol' : 'ul'
        return (
          <List key={i} className="rv-written-list">
            {b.items.map((item, j) => (
              <li key={j}>{paragraph(item.finding, item.content)}</li>
            ))}
          </List>
        )
      })}
    </>
  )
}
