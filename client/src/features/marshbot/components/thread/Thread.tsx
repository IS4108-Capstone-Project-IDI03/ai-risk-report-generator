// The conversation (AS-06 canvas C1 to C13, H1, H2): earlier sessions folded behind an "Earlier"
// pill, then today's session, the engineer's reply while it is sent, and the typing dots while
// MarshBot writes. It opens on the newest turn, is the only part of the Overview that scrolls,
// and follows new turns down to their very end. Called by screens/MarshBotOverview.tsx.
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Icon } from '../../../../design-system'
import { weekDay } from '../../format'
import type { AssistantThread } from '../../types'
import { TypingDots } from '../TypingDots'
import { BotTurn } from './BotTurn'
import { EngineerBubble } from './EngineerBubble'
import { SessionTurns } from './SessionTurns'

const botTurnIds = (thread: AssistantThread) =>
  thread.session.turns.filter((t) => t.who === 'bot').map((t) => t.id)

/** Returns the scrolling thread; `pending` is the engineer's reply on its way, and `answered`
    counts the replies the gateway took (each moves focus to the newest turn). */
export function Thread({
  thread,
  pending,
  answered,
}: {
  thread: AssistantThread
  pending: string | null
  answered: number
}) {
  const [showEarlier, setShowEarlier] = useState(false)
  // The bot turns already there when the screen opened draw at once; later ones arrive animated.
  const [known] = useState(() => new Set(botTurnIds(thread)))
  const fresh = new Set(botTurnIds(thread).filter((id) => !known.has(id)))
  const scroller = useRef<HTMLDivElement>(null)
  const column = useRef<HTMLDivElement>(null)
  const end = useRef<HTMLDivElement>(null)
  // Whether the thread keeps to its end as it grows: true on open and on every new turn, false
  // once the engineer scrolls up to read (or opens Earlier).
  const stick = useRef(true)
  // The end last scrolled for; an effect run again with the same end (React's dev double run)
  // is not a new turn.
  const seen = useRef<string | null>(null)
  // What the end of the thread holds: a change here is a new turn, the dots, or a reply.
  const size = `${thread.session.turns.length}|${pending ?? ''}|${thread.thinking}`

  // Scrolls to the end: the thread itself on a computer; on a phone the page, so the end mark
  // sits just above the tray (thread.css gives the mark the tray's height as scroll margin).
  const follow = (instant: boolean) => {
    const el = scroller.current
    if (!el) return
    const calm = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    const behavior = instant || calm ? 'auto' : 'smooth'
    if (getComputedStyle(el).overflowY !== 'visible')
      el.scrollTo?.({ top: el.scrollHeight, behavior })
    else end.current?.scrollIntoView?.({ block: 'end', behavior })
  }

  // a. Open on the newest turn, and go to the end with each new turn, the dots or a reply.
  useLayoutEffect(() => {
    if (seen.current === size) return
    const first = seen.current === null
    seen.current = size
    stick.current = true
    follow(first)
  }, [size])

  // b. Late layout (a card's height, a font, the entrance) grows the column after the jump, and
  //    a window resize shrinks the view: without this the newest bubble would stop short.
  useEffect(() => {
    const el = column.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const watch = new ResizeObserver(() => stick.current && follow(false))
    watch.observe(el)
    if (scroller.current) watch.observe(scroller.current)
    return () => watch.disconnect()
  }, [])

  // d. A reply's buttons are gone once it is answered: focus goes to MarshBot's newest turn, so a
  //    keyboard or screen-reader user carries on from there instead of the page's top.
  useEffect(() => {
    if (!answered) return
    const now = document.activeElement
    if (now && now !== document.body && !now.closest('.mbt-tray')) return
    const turns = column.current?.querySelectorAll<HTMLElement>('.mbt-live .mbt-turn')
    turns?.[turns.length - 1]?.focus({ preventScroll: true })
  }, [answered])

  // c. Only the engineer's own scrolling lets go of the end, never a scroll this code started.
  const letGo = () =>
    requestAnimationFrame(() => {
      const el = scroller.current
      if (!el) return
      stick.current =
        getComputedStyle(el).overflowY !== 'visible' &&
        el.scrollHeight - el.scrollTop - el.clientHeight < 48
    })

  const earlier = thread.earlier
  const lastEarlier = earlier.at(-1)
  const count = earlier.reduce((n, s) => n + s.turns.length, 0)
  return (
    <div
      ref={scroller}
      className="mbt-scroll"
      onWheel={letGo}
      onTouchMove={letGo}
      onKeyDown={letGo}
    >
      <div ref={column} className="mbt-thread">
        <h2 className="mbt-sr">Conversation with MarshBot</h2>
        {/* b. Earlier sessions, folded until asked for. */}
        {lastEarlier && (
          <button
            type="button"
            className="mbt-fold"
            aria-expanded={showEarlier}
            onClick={() => {
              // Reading back: stay with the earlier sessions instead of jumping to the end.
              stick.current = false
              setShowEarlier((s) => !s)
            }}
          >
            <Icon name="history" size={14} />
            {showEarlier ? (
              'Hide Earlier'
            ) : (
              <>
                Earlier
                <small>{`${weekDay(lastEarlier.startedAt)} · ${count} message${count === 1 ? '' : 's'}`}</small>
              </>
            )}
            <Icon name={showEarlier ? 'chevron-up' : 'chevron-down'} size={14} />
          </button>
        )}
        {showEarlier && earlier.map((s) => <SessionTurns key={s.id} session={s} past />)}
        {/* c. Today's session, then what is on its way. Only this part is a live log: opening
               Earlier would otherwise have a screen reader read a whole history out. */}
        <div className="mbt-live" role="log" aria-label="Conversation with MarshBot">
          <SessionTurns session={thread.session} fresh={fresh} />
          {pending && <EngineerBubble text={pending} sending />}
          {thread.thinking && (
            <BotTurn mood="thinking" named={false} fresh>
              <TypingDots />
            </BotTurn>
          )}
        </div>
        <div ref={end} className="mbt-endmark" />
      </div>
    </div>
  )
}
