// Messages one at a time (AS-06 board 12): typing dots, then the words word by word, then each
// widget, then a pause before the next message. "Show all" skips the waits; a reopen with
// nothing new shows everything at once. Called by screens/MarshBotOverview.tsx.
import { useEffect, useState } from 'react'
import type { Cursor } from './context'
import { MESSAGE_PAUSE_MS, TYPING_MS, WIDGET_MS, WORD_MS } from './settings'

export type Planned = { id: string; plan: number[] }
type Active = { id: string; phase: 'typing' | 'parts' | 'pause'; part: number; words: number }
type State = { seen: Set<string>; active: Active | null }

// With reduced motion a paragraph shows at once (a plain fade); the pauses stay (board 12).
const reduced = () => !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

// The step after `a`, and how long to wait before it.
function step(a: Active, plan: number[], more: boolean): [Active | 'done', number] {
  if (a.phase === 'typing') return [{ ...a, phase: 'parts', part: 0, words: 0 }, TYPING_MS]
  if (a.phase === 'pause') return ['done', MESSAGE_PAUSE_MS]
  if (a.part >= plan.length) return more ? [{ ...a, phase: 'pause' }, 0] : ['done', 0]
  const words = plan[a.part]
  if (words && a.words < words)
    return reduced() ? [{ ...a, words }, 0] : [{ ...a, words: a.words + 1 }, WORD_MS]
  return [{ ...a, part: a.part + 1, words: 0 }, words ? 0 : WIDGET_MS]
}

/** Returns each message's reveal cursor, whether MarshBot is typing, and Show all. */
export function usePacing(messages: Planned[], paced: boolean) {
  // Not paced: everything there now is already seen. New messages from a push are always paced.
  const [state, setState] = useState<State>(() => ({
    seen: new Set(paced ? [] : messages.map((m) => m.id)),
    active: null,
  }))
  const { seen, active } = state
  const unseen = messages.filter((m) => !seen.has(m.id) && m.id !== active?.id)

  // One timer at a time moves the reveal on; any change of state schedules the next.
  useEffect(() => {
    const current = active && messages.find((m) => m.id === active.id)
    let next: () => State
    let wait = 0
    if (!current) {
      // Nothing being revealed (or it vanished in a push): start the next unseen message.
      const first = messages.find((m) => !seen.has(m.id))
      if (!first && !active) return
      next = () => ({
        seen,
        active: first ? { id: first.id, phase: 'typing', part: 0, words: 0 } : null,
      })
    } else {
      const [after, delay] = step(active, current.plan, unseen.length > 0)
      wait = delay
      next = () =>
        after === 'done'
          ? { seen: new Set([...seen, active.id]), active: null }
          : { seen, active: after }
    }
    const timer = setTimeout(() => setState(next()), wait)
    return () => clearTimeout(timer)
  }, [active, seen, messages, unseen.length])

  const cursorOf = (id: string): Cursor => {
    if (seen.has(id)) return 'all'
    if (active?.id !== id || active.phase === 'typing') return 'none'
    return active.phase === 'pause' ? 'all' : { part: active.part, words: active.words }
  }
  return {
    cursorOf,
    typing: active?.phase === 'typing',
    // Show all is offered while anything is still to come.
    waiting: !!active || unseen.length > 0,
    showAll: () => setState({ seen: new Set(messages.map((m) => m.id)), active: null }),
  }
}
