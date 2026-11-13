// The conversation (AS-06 canvas C1 to C13, H1, H2, round 7 R7-C1 to C8): earlier sessions folded
// behind an "Earlier" pill, then today's session with the action slot under MarshBot's newest
// turn, the engineer's reply while it is sent, and the typing dots while MarshBot writes. It opens
// on the newest turn, is the only part of the Overview that scrolls, and follows new turns down to
// their very end. Scrolled away, the slot's buttons wait in a sticky bar (ScrolledAway.tsx).
// Called by screens/MarshBotOverview.tsx.
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { Icon, useIsPhone } from '../../../../design-system'
import { weekDay } from '../../format'
import type { AssistantThread } from '../../types'
import { TypingDots } from '../TypingDots'
import { BotTurn } from './BotTurn'
import { EngineerBubble } from './EngineerBubble'
import { ScrolledAway } from './ScrolledAway'
import { SessionTurns } from './SessionTurns'

const botTurnIds = (thread: AssistantThread) =>
  thread.session.turns.filter((t) => t.who === 'bot').map((t) => t.id)

// MarshBot's newest saved turn on screen, where focus goes once a reply's buttons are gone (not
// the typing dots: they leave, and focus would fall to the page's top with them).
const newestTurn = (column: HTMLElement | null) =>
  [...(column?.querySelectorAll<HTMLElement>('.mbt-live .mbt-session .mbt-turn') ?? [])].at(-1)

/** Returns the scrolling thread; `pending` is the engineer's reply on its way, `answered` counts
    the replies the gateway took (each moves focus to the newest turn), and `actions` are the
    buttons of the action slot (null when there is nothing to press). */
export function Thread({
  thread,
  pending,
  answered,
  actions,
}: {
  thread: AssistantThread
  pending: string | null
  answered: number
  actions: ReactNode | null
}) {
  const [showEarlier, setShowEarlier] = useState(false)
  // The bot turns already there when the screen opened draw at once; later ones arrive animated.
  const [known] = useState(() => new Set(botTurnIds(thread)))
  const fresh = new Set(botTurnIds(thread).filter((id) => !known.has(id)))
  const phone = useIsPhone()
  const scroller = useRef<HTMLDivElement>(null)
  const column = useRef<HTMLDivElement>(null)
  const end = useRef<HTMLDivElement>(null)
  // The action slot in the thread; state, so the "in view" watch follows it as it comes and goes.
  const [slot, setSlot] = useState<HTMLDivElement | null>(null)
  // Whether the thread keeps to its end as it grows: true on open and on every new turn, false
  // once the engineer scrolls up to read (or opens Earlier).
  const stick = useRef(true)
  // The end last scrolled for; an effect run again with the same end (React's dev double run)
  // is not a new turn.
  const seen = useRef<string | null>(null)
  // What the end of the thread holds: a change here is a new turn, the dots, or a reply.
  const size = `${thread.session.turns.length}|${pending ?? ''}|${thread.thinking}`

  // Scrolls to the end: the thread itself on a computer; on a phone the page.
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

  // c. A picked button leaves with its slot, which would drop focus to the page's top: focus
  //    holds on MarshBot's turn while the reply is sent, then moves to its newest turn (again
  //    when the answer arrives after the dots), so a keyboard or screen-reader user carries on
  //    from there.
  useLayoutEffect(() => {
    if (pending && document.activeElement === document.body)
      newestTurn(column.current)?.focus({ preventScroll: true })
  }, [pending])
  useEffect(() => {
    if (!answered) return
    const now = document.activeElement
    if (now && now !== document.body && !now.matches('.mbt-live .mbt-turn')) return
    newestTurn(column.current)?.focus({ preventScroll: true })
  }, [answered, thread.session.turns.length])

  // c2. A button that had focus is replaced by the pushed result (Try Again's "Transcribing",
  //     then the answer's new turn) and focus falls to the page: it goes to the newest turn. Only
  //     when focus was in the thread (`held`): without that, a page that just opened would draw a
  //     focus ring round each turn MarshBot adds. A removed element fires no blur, so `held` stays
  //     set for it; focus moved away on purpose clears it.
  const held = useRef(false)
  const turns = useRef(thread.session.turns.length)
  useEffect(() => {
    const before = turns.current
    turns.current = thread.session.turns.length
    if (
      thread.session.turns.length > before &&
      held.current &&
      document.activeElement === document.body
    )
      newestTurn(column.current)?.focus({ preventScroll: true })
  }, [thread.session.turns.length])

  // d. Only the engineer's own scrolling lets go of the end, never a scroll this code started.
  const letGo = () =>
    requestAnimationFrame(() => {
      const el = scroller.current
      if (!el) return
      stick.current =
        getComputedStyle(el).overflowY !== 'visible' &&
        el.scrollHeight - el.scrollTop - el.clientHeight < 48
    })

  // d2. The agenda jumping back to a topic (Agenda.tsx) lets go of the end too: its own scroll
  //     fires no wheel, touch or key, so letGo never sees it.
  useEffect(() => {
    const el = column.current
    const release = () => (stick.current = false)
    el?.addEventListener('mbt-jump', release)
    return () => el?.removeEventListener('mbt-jump', release)
  }, [])

  // Stable, so ScrolledAway's watch isn't set up again on every render.
  const focusLatest = useCallback(
    () => newestTurn(column.current)?.focus({ preventScroll: true }),
    [],
  )

  const earlier = thread.earlier
  const lastEarlier = earlier.at(-1)
  const count = earlier.reduce((n, s) => n + s.turns.length, 0)
  return (
    <>
      {/* First in the DOM, so Tab reaches the bar and arrow before every card; they are laid out
          over the foot of the conversation (thread.css), so nothing moves. */}
      <ScrolledAway
        scroller={scroller}
        end={end}
        slot={slot}
        phone={phone}
        actions={actions}
        onLatest={() => {
          stick.current = true
          follow(false)
        }}
        focusLatest={focusLatest}
      />
      <div
        ref={scroller}
        className="mbt-scroll"
        onWheel={letGo}
        onTouchMove={letGo}
        onKeyDown={letGo}
      >
        <div
          ref={column}
          className="mbt-thread"
          onFocus={() => (held.current = true)}
          onBlur={(e) => {
            if (!e.currentTarget.contains(e.relatedTarget)) held.current = false
          }}
        >
          <h2 className="mbt-sr">Conversation with MarshBot</h2>
          {/* e. Earlier sessions, folded until asked for. */}
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
          {showEarlier &&
            earlier.map((s, i) => (
              <SessionTurns key={s.id} session={s} past since={earlier[i - 1]?.turns.at(-1)?.at} />
            ))}
          {/* f. Today's session, then what is on its way. Only this part is a live log: opening
                 Earlier would otherwise have a screen reader read a whole history out. */}
          <div className="mbt-live" role="log" aria-label="Conversation with MarshBot">
            <SessionTurns
              session={thread.session}
              fresh={fresh}
              since={lastEarlier?.turns.at(-1)?.at}
              slot={
                actions && (
                  <div ref={setSlot} className="mbt-actions" role="group" aria-label="Your reply">
                    {actions}
                    {/* The slot's end, which ScrolledAway watches. */}
                    <i className="mbt-slot-end" aria-hidden="true" />
                  </div>
                )
              }
            />
            {pending && <EngineerBubble text={pending} sending />}
            {thread.thinking && (
              <BotTurn mood="thinking" named={false} fresh>
                {/* While it reads the notes against the checklist, the dots say so (the pill's words). */}
                <TypingDots
                  label={thread.status.icon === 'clock' ? `${thread.status.text}…` : undefined}
                />
              </BotTurn>
            )}
          </div>
          <div ref={end} className="mbt-endmark" />
        </div>
      </div>
    </>
  )
}
