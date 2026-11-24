// F-13: a help tip's words, drawn by the same rules as MarshBot's bubble (F-12): a new line starts
// a paragraph, a line starting "- " is a bullet, **bold** marks key words. Shares the bubble's
// parser (blocksOf, features/walkthrough/components/TypedText.tsx). Called by Tip.tsx.
import { blocksOf } from '../walkthrough/components/words'

/** Returns `text` as paragraphs and bullet lists; bold runs become <b>. */
export function RichText({ text }: { text: string }) {
  const blocks = blocksOf(text)
  const runs = (block: (typeof blocks)[number]) =>
    block.runs.map((run, i) => (run.bold ? <b key={i}>{run.text}</b> : run.text))
  // Bullets that follow each other share one list.
  const out: React.ReactNode[] = []
  let items: React.ReactNode[] = []
  const closeList = () => {
    if (items.length) out.push(<ul key={`l${out.length}`}>{items}</ul>)
    items = []
  }
  blocks.forEach((block, i) => {
    if (block.bullet) return void items.push(<li key={i}>{runs(block)}</li>)
    closeList()
    out.push(<p key={i}>{runs(block)}</p>)
  })
  closeList()
  return <>{out}</>
}
