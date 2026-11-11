// A message's parts in order (AS-06): rows side by side in one grey panel, buttons in one row,
// each part shown as far as the reveal has got, and each in its own error boundary.
// Used by the Reply part (library.tsx) and the plain fallback (MessageBody.tsx).
import { Component, useContext, type ReactNode } from 'react'
import {
  CursorContext,
  FailContext,
  MessageContext,
  RevealContext,
  useMarshBot,
  type Reveal,
} from '../context'

export type Part = { type: string; key: string; view: ReactNode }

// A part that throws asks for the plain fallback; once there, a broken part just shows nothing.
class PartBoundary extends Component<
  { onFail: () => void; children: ReactNode },
  { broken: boolean }
> {
  state = { broken: false }
  static getDerivedStateFromError() {
    return { broken: true }
  }
  componentDidCatch(error: unknown) {
    console.warn('MarshBot part failed', error)
    this.props.onFail()
  }
  render() {
    return this.state.broken ? null : this.props.children
  }
}

// Which kind of group a part joins: rows share a panel, buttons share a line.
const GROUP: Record<string, string> = {
  ActionRow: 'rows',
  QuickReply: 'replies',
  LinkButton: 'replies',
}

/** Returns the parts, grouped and revealed; parts not reached yet are left out. */
export function PartList({ parts }: { parts: Part[] }) {
  const cursor = useContext(CursorContext)
  const onFail = useContext(FailContext)
  const message = useContext(MessageContext)
  const bot = useMarshBot()
  const reveal = (i: number): Reveal =>
    cursor === 'all' || (cursor !== 'none' && i < cursor.part)
      ? { state: 'full', words: Infinity }
      : cursor !== 'none' && i === cursor.part
        ? { state: 'partial', words: cursor.words }
        : { state: 'hidden', words: 0 }
  // a. Consecutive rows, and consecutive buttons, form one group each.
  const groups: { kind: string | null; items: { part: Part; index: number }[] }[] = []
  parts.forEach((part, index) => {
    const kind = GROUP[part.type] ?? null
    const last = groups[groups.length - 1]
    if (kind && last?.kind === kind) last.items.push({ part, index })
    else groups.push({ kind, items: [{ part, index }] })
  })
  // b. Each group shows once its first part is reached.
  return groups.map((group) => {
    const shown = group.items.filter(({ index }) => reveal(index).state !== 'hidden')
    if (!shown.length) return null
    const items = shown.map(({ part, index }) => (
      <RevealContext.Provider key={part.key} value={reveal(index)}>
        <PartBoundary onFail={onFail}>{part.view}</PartBoundary>
      </RevealContext.Provider>
    ))
    const key = group.items[0].part.key
    if (group.kind === 'rows')
      return (
        <div key={key} className="mb-part mb-panel mb-rows">
          {items}
        </div>
      )
    if (group.kind === 'replies')
      return (
        <div
          key={key}
          className="mb-part mb-replies"
          // The buttons fade out while the engineer's answer goes in (board 12).
          data-leaving={(!!message && bot.answering === message.id) || undefined}
        >
          {items}
        </div>
      )
    return (
      <div key={key} className={group.items[0].part.type === 'Say' ? undefined : 'mb-part'}>
        {items}
      </div>
    )
  })
}
