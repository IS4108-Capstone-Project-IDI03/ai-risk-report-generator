// What a person can do to an Inbox row (F-10): open it, tick it, untick it, bin it, and Undo
// each. Called by screens/Inbox.tsx. Calls api.ts, alreadyHandled.ts (before a To do row opens),
// moves the shared counts straight away (so the next poll agrees and your own action doesn't
// reload the list, NotificationCountsContext.tsx) and shows a toast per action.
import { useEffect, useRef, useState } from 'react'
import { toast } from '../../design-system'
import { assessmentMissing } from '../assessments/openAssessment'
import type { Notification } from '../notifications/api'
import { useNotificationCounts } from '../notifications/useNotificationCounts'
import { openSubject } from '../notifications/openSubject'
import { alreadyHandled, isChecked, type Handled } from './alreadyHandled'
import { binItem, openItem, tickItem, unbinItem, untickItem } from './api'
import { forgetOpened, rememberOpened } from './inboxReturn'
import type { UseInbox } from './useInbox'

// How long the check may take before the row opens as usual.
const CHECK_LIMIT_MS = 3000
// must match LEAVE_MS in design-system/components/feedback/Dialog.tsx
const DIALOG_LEAVE_MS = 150

/** Returns what a person does to a row (each with its toast and Undo), and the already-handled state. */
export function useInboxActions(inbox: UseInbox) {
  const { change } = useNotificationCounts()
  const todo = (by: number) => change((c) => ({ ...c, inboxTodo: Math.max(0, c.inboxTodo + by) }))

  // The call failed: the row comes back, the count goes back, and the person is told.
  const undone = (n: Notification, by: number) => {
    inbox.cancel(n.id)
    todo(by)
    // A row that had already closed up is only brought back by reading the list.
    inbox.reload()
    toast.error("Couldn't update", { description: 'Check your connection and try again.' })
  }
  // An Undo's call failed: the list says where things really stand.
  const undoFailed = () => {
    inbox.reload()
    toast.error("Couldn't undo", { description: 'Check your connection and try again.' })
  }
  // The row last pressed, and whether its open call went through (see `open`).
  const opening = useRef<{ n: Notification; marked: Promise<boolean> } | null>(null)
  // The app could not find the row's assessment, so nothing opened: without this the row would
  // sit in Done, cleared without ever being seen.
  useEffect(() => {
    const back = (e: Event) => {
      const pressed = opening.current
      const { reference } = (e as CustomEvent<{ reference: string }>).detail
      if (pressed?.n.context?.reference !== reference) return
      opening.current = null
      forgetOpened()
      void pressed.marked.then((marked) => {
        if (!marked) return
        todo(1)
        return untickItem(pressed.n.id).then(inbox.reload, inbox.reload)
      })
    }
    window.addEventListener(assessmentMissing.event, back)
    return () => window.removeEventListener(assessmentMissing.event, back)
  })

  // The already-handled check in flight (F-10 round 3), and which row it's for.
  const checking = useRef<{ id: string; abort: AbortController } | null>(null)
  // Without this, a late answer would open or ask about a row the person has moved on from.
  const stopCheck = () => {
    checking.current?.abort.abort()
    checking.current = null
  }
  const dropCheck = (id: string) => {
    if (checking.current?.id === id) stopCheck()
  }

  // Tick: the circle fills and the row leaves. Undo is an untick. `quiet` leaves out the toast
  // (Move to Done in the already-handled dialog says it by the row leaving).
  const tick = (n: Notification, quiet = false) => {
    if (inbox.phases[n.id]) return
    dropCheck(n.id)
    inbox.leave(n.id, 'ticking')
    todo(-1)
    tickItem(n.id).then(
      () => {
        if (quiet) return
        toast.success('Moved to Done', {
          action: {
            label: 'Undo',
            onClick: () => {
              inbox.cancel(n.id)
              untickItem(n.id).then(() => {
                todo(1)
                inbox.reload()
              }, undoFailed)
            },
          },
        })
      },
      () => undone(n, 1),
    )
  }

  // Untick: the mirror, and it brings the row back to my To do only. Undo ticks it again.
  const untick = (n: Notification) => {
    if (inbox.phases[n.id]) return
    inbox.leave(n.id, 'unticking')
    todo(1)
    untickItem(n.id).then(
      () =>
        toast.success('Moved back to To do', {
          action: {
            label: 'Undo',
            onClick: () => {
              inbox.cancel(n.id)
              tickItem(n.id).then(() => {
                todo(-1)
                inbox.reload()
              }, undoFailed)
            },
          },
        }),
      () => undone(n, -1),
    )
  }

  // Bin: the row leaves my Inbox at once; nobody else's changes. Undo restores it.
  const bin = (n: Notification) => {
    if (inbox.phases[n.id]) return
    const wasTodo = !n.done
    dropCheck(n.id)
    inbox.leave(n.id, 'leaving')
    if (wasTodo) todo(-1)
    binItem(n.id).then(
      () =>
        toast.success('Removed from your Inbox', {
          action: {
            label: 'Undo',
            onClick: () => {
              unbinItem(n.id).then(() => {
                if (wasTodo) todo(1)
                inbox.cancel(n.id)
                inbox.reload()
              }, undoFailed)
            },
          },
        }),
      () => undone(n, wasTodo ? 1 : 0),
    )
  }

  // Go to the row's thing, and the item moves to Done for me. A To do row is remembered, so
  // coming back by Back shows it ticked and leaving.
  const go = (n: Notification) => {
    if (!n.done) {
      rememberOpened(n)
      todo(-1)
    }
    // Failed: the count goes back, or the next poll would read your own action as someone else's
    // change. The row stays To do on the server, so it's right again at the next read.
    const marked = n.done
      ? Promise.resolve(false)
      : openItem(n.id).then(
          () => true,
          () => {
            todo(1)
            return false
          },
        )
    opening.current = { n, marked }
    openSubject(n)
  }

  useEffect(
    () => () => {
      // Without this, a late answer would pull the person off the screen or tab they moved to.
      checking.current?.abort.abort()
      checking.current = null
    },
    [inbox.tab],
  )
  // Set when the check finds the row already handled; the screen shows the dialog for it.
  const [handled, setHandled] = useState<{ n: Notification; found: Handled } | null>(null)

  // Open: a To do row first asks whether someone already dealt with it. A check that fails or
  // takes too long opens the row as usual, or a network problem would stop work.
  const open = (n: Notification) => {
    if (n.done || !isChecked(n)) {
      stopCheck()
      return go(n)
    }
    // A second press while checking does nothing.
    if (checking.current) return
    const mine = { id: n.id, abort: new AbortController() }
    checking.current = mine
    const timer = setTimeout(() => mine.abort.abort(), CHECK_LIMIT_MS)
    alreadyHandled(n, mine.abort.signal)
      .catch(() => null)
      .then((found) => {
        clearTimeout(timer)
        // Dropped: the row was ticked or binned, or the screen has gone.
        if (checking.current !== mine) return
        checking.current = null
        if (found) setHandled({ n, found })
        else go(n)
      })
  }

  // Move to Done in the dialog: let it fade out, then the usual tick, with no toast.
  const moveHandled = () => {
    if (!handled) return
    const { n } = handled
    setHandled(null)
    setTimeout(() => tick(n, true), DIALOG_LEAVE_MS)
  }

  return { tick, untick, bin, open, handled: handled?.found ?? null, moveHandled }
}
