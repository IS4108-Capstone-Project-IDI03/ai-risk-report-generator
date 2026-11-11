// One thing MarshBot points at (AS-06 board 01 and 02): icon tile, title, one-line detail and
// its action: a primary pill for a Fix now link, a retry icon, or an open chevron, plus a quiet
// dismiss × when the item may be dismissed. A pushed change ticks it off (board 12).
// Rendered by the ActionRow part (library.tsx). Reads the brief from context.ts.
import { useEffect, useState } from 'react'
import { Button, Icon, IconButton, toast } from '../../../design-system'
import { useMarshBot } from '../context'
import { TICK_HOLD_MS } from '../settings'
import type { BriefItem } from '../types'

// The tile's colour says what kind of thing it is (design system: violet = site walk proposal,
// red = an error, amber = something missing).
function tone(item: BriefItem) {
  if (item.kind.includes('walk')) return 'violet'
  if (item.weight === 'fix_now') return 'red'
  if (item.weight === 'gap') return 'amber'
  return 'ink'
}

// The detail line; after a failure its last words ("Couldn't transcribe") are the red part.
function Detail({ item }: { item: BriefItem }) {
  if (!item.detail) return null
  const parts = item.detail.split(' · ')
  const failed = !!item.action && parts.length > 1
  const last = failed ? parts.pop() : null
  return (
    <span className="mb-row-detail">
      {parts.join(' · ')}
      {last && (
        <>
          {' · '}
          <strong className="mb-row-failed">{last}</strong>
        </>
      )}
    </span>
  )
}

// The row is going: focus moves to a button in the row after it (or before it), else to the
// conversation, so a keyboard user isn't dropped back at the top of the page.
function focusNeighbour(row: Element | null) {
  if (!row?.contains(document.activeElement)) return
  const next = [row.nextElementSibling, row.previousElementSibling]
    .map((r) => r?.querySelector<HTMLElement>('button'))
    .find(Boolean)
  ;(next ?? row.closest<HTMLElement>('.mb-convo'))?.focus()
}

// How long a fold takes (parts.css .mb-row), plus a margin: if transitionend never fires
// (reduced motion, a hidden tab), the row still goes.
const FOLD_FALLBACK_MS = 400

/** Returns the row for item `id`, ticking off if a push just resolved it; nothing if unknown. */
export function ActionRow({ id }: { id: string }) {
  const bot = useMarshBot()
  const open = bot.brief.items.find((i) => i.id === id && !i.resolvedAt)
  const item = open ?? bot.brief.items.find((i) => i.id === id) ?? bot.ticked.get(id)
  const done = !open && !!item
  // 'leaving' folds the row away (dismissed, or ticked and held); 'gone' renders nothing.
  const [phase, setPhase] = useState<'here' | 'leaving' | 'gone'>('here')
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    if (!done) return
    const fold = setTimeout(() => setPhase('leaving'), TICK_HOLD_MS)
    return () => clearTimeout(fold)
  }, [done])
  useEffect(() => {
    if (phase !== 'leaving') return
    const gone = setTimeout(() => setPhase('gone'), FOLD_FALLBACK_MS)
    return () => clearTimeout(gone)
  }, [phase])
  if (!item || phase === 'gone') return null
  const engineer = bot.brief.viewer === 'engineer'
  const link = item.link
  const go = link ? () => bot.openLink(link) : undefined

  let action = null
  if (done || busy)
    action = (
      <span className="mb-row-state" aria-hidden="true">
        {done ? (
          <svg viewBox="0 0 24 24" className="mb-tick">
            <circle cx="12" cy="12" r="11" />
            <path d="M7 12.5l3.2 3.2L17 9" />
          </svg>
        ) : (
          <span className="mb-spinner" />
        )}
      </span>
    )
  else if (item.action && engineer)
    action = (
      <IconButton
        icon="rotate-ccw"
        label={`Retry ${item.title}`}
        tooltip="Retry"
        size="lg"
        variant="outline"
        className="mb-row-icon"
        onClick={() => {
          setBusy(true)
          bot.act(item).catch((error: unknown) => {
            setBusy(false)
            toast.error(error instanceof Error ? error.message : 'Couldn’t retry that. Try again.')
          })
        }}
      />
    )
  else if (go && item.weight === 'fix_now') {
    const verb = link?.params?.walk ? 'Review' : 'Open'
    action = (
      // Named with its row ("Review Morning walk"): a list of bare "Review"s says nothing.
      <Button variant="primary" pill onClick={go} aria-label={`${verb} ${item.title}`}>
        {verb}
      </Button>
    )
  } else if (go)
    action = (
      <IconButton
        icon="chevron-right"
        label={`Open ${item.title}`}
        tooltip="Open"
        size="lg"
        className="mb-row-icon"
        onClick={go}
      />
    )

  return (
    <div
      className="mb-row"
      data-done={done || undefined}
      data-leaving={phase === 'leaving' || undefined}
      // A folding row can't be tabbed into or clicked.
      inert={phase === 'leaving'}
      onTransitionEnd={(e) => {
        if (phase === 'leaving' && e.target === e.currentTarget) setPhase('gone')
      }}
    >
      <div className="mb-row-inner">
        <span className="mb-tile" data-tone={tone(item)} aria-hidden="true">
          <Icon name={item.icon} size={16} />
        </span>
        <span className="mb-row-text">
          <span className="mb-row-title">{item.title}</span>
          <Detail item={item} />
        </span>
        {action}
        {/* Always there, so the change is announced: a live region added with its text isn't. */}
        <span className="mb-sr" role="status">
          {done ? 'Done' : busy ? 'Working' : ''}
        </span>
        {engineer && item.dismissible && !done && (
          <IconButton
            icon="x"
            label={`Dismiss ${item.title}`}
            tooltip="Dismiss"
            size="sm"
            className="mb-row-dismiss mb-hit"
            onClick={(e) => {
              focusNeighbour(e.currentTarget.closest('.mb-row'))
              setPhase('leaving')
              void bot.dismiss(item.id).then((ok) => !ok && setPhase('here'))
            }}
          />
        )}
      </div>
    </div>
  )
}
