// The frame every card shares (AS-06 canvas C1 onward): a white card under MarshBot's bubbles,
// its 1-2 word title, a short note on the right ("0 of 2 done", the count bold), then its body
// and, at most, one button. Wide cards (checklist, bars, outline, lanes, time in stage) take
// the whole conversation column.
// Used by every card in this folder.
import type { ReactNode } from 'react'
import { Button, Icon, Tooltip } from '../../../../design-system'
import type { ItemLink } from '../../types'

// "25 of 42 answered" with the 25 bold; any other note as it is.
function Note({ text }: { text: string }) {
  const m = /^(\d+)( of .*)$/.exec(text)
  return <small>{m ? [<b key="n">{m[1]}</b>, m[2]] : text}</small>
}

/** Returns the card frame around `children`. */
export function CardShell({
  title,
  note,
  help,
  wide = false,
  children,
}: {
  title: string
  note?: string | null
  // A (?) beside the title with this explanation.
  help?: string
  wide?: boolean
  children: ReactNode
}) {
  return (
    // A named group, not a region: a long history would otherwise be a long list of landmarks.
    <div className="mbt-card" role="group" data-wide={wide || undefined} aria-label={title}>
      <header className="mbt-card-head">
        <h3>{title}</h3>
        {help && (
          <Tooltip label={help}>
            <button type="button" className="mbt-help" aria-label={help}>
              <Icon name="circle-help" size={16} />
            </button>
          </Tooltip>
        )}
        {note && <Note text={note} />}
      </header>
      {children}
    </div>
  )
}

/** Returns a card's one button ("Open Generation ›"); hidden in an earlier session. */
export function CardCta({
  cta,
  past,
  onOpen,
}: {
  cta: { label: string; link: ItemLink } | null
  past: boolean
  onOpen: (link: ItemLink) => void
}) {
  if (!cta || past) return null
  return (
    <div className="mbt-cta">
      <Button
        variant="tonal"
        pill
        iconRight="chevron-right"
        onClick={() => onOpen(cta.link)}
        style={{
          height: 'var(--mbt-cta)',
          color: 'var(--marsh-navy)',
          fontWeight: 600,
          border: '1px solid var(--ink-100)',
        }}
      >
        {cta.label}
      </Button>
    </div>
  )
}
