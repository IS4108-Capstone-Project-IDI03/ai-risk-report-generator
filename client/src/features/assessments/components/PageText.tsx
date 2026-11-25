// A handwritten page's text as the observation page's row shows it when opened (CP-19 AC8, AC9,
// CP-20, CP-24): in the recording transcript's own box (.sw-transcript). Each word the model was
// unsure of has an amber dotted underline (amber means not sure, design system v2); there is no
// violet rule and no count here, since the row says the count once. A corrected page shows the
// engineer's text, with what was transcribed folded under it. Rendered by PageEntry.tsx.
import { Fragment, type ReactNode } from 'react'
import type { PageView } from './PageEntry'

// The text with each unsure word marked; a screen reader hears "(unsure)" after it. Marks that
// overlap or run past the text are skipped, as positions count UTF-16 units like string slices.
function marked(text: string, uncertain: [number, number][]) {
  const parts: ReactNode[] = []
  let at = 0
  for (const [start, end] of [...uncertain].sort((a, b) => a[0] - b[0])) {
    if (start < at || end > text.length) continue
    parts.push(<Fragment key={'t' + at}>{text.slice(at, start)}</Fragment>)
    parts.push(
      <mark key={start} className="cpg-mark">
        {text.slice(start, end)}
        <span className="ds-sr-only">{' (unsure)'}</span>
      </mark>,
    )
    at = end
  }
  parts.push(<Fragment key="rest">{text.slice(at)}</Fragment>)
  return parts
}

/** Returns the open text of a page: its words with unsure ones marked, and "As transcribed" when corrected. */
export function PageText({ page: p }: { page: PageView }) {
  if (p.correction)
    return (
      <>
        <p className="sw-transcript">{p.transcript}</p>
        {p.original !== null && (
          <details className="cpg-original">
            <summary>{'As transcribed'}</summary>
            <p className="sw-transcript">
              {p.original.trim()
                ? marked(p.original, p.uncertain)
                : 'No handwriting was found on this page.'}
            </p>
          </details>
        )}
      </>
    )
  return <p className="sw-transcript">{marked(p.transcript ?? '', p.uncertain)}</p>
}
