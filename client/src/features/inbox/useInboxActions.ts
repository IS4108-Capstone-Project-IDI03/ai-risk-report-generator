// What a person can do to an Inbox row (F-10): open it, tick it, untick it, bin it, and Undo
// each. Called by screens/Inbox.tsx. Calls api.ts, moves the shared counts straight away (so
// your own action never chimes, NotificationCountsContext.tsx) and shows a toast per action.
import { useEffect, useRef } from 'react'
import { toast } from '../../design-system'
import { assessmentMissing } from '../assessments/openAssessment'
import type { Notification } from '../notifications/api'
import { useNotificationCounts } from '../notifications/useNotificationCounts'
import { openSubject } from '../notifications/openSubject'
import { binItem, openItem, tickItem, unbinItem, untickItem } from './api'
import { forgetOpened, rememberOpened } from './inboxReturn'
import type { UseInbox } from './useInbox'

/** Returns the four things a person does to a row, each with its toast and Undo. */
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
  // sit in Done, cleared without ever being seen. Done for me only if someone ticked it.
  useEffect(() => {
    const back = (e: Event) => {
      const pressed = opening.current
      const { reference } = (e as CustomEvent<{ reference: string }>).detail
      if (pressed?.n.context?.reference !== reference) return
      opening.current = null
      forgetOpened()
      void pressed.marked.then((marked) => {
        if (!marked || pressed.n.done) return
        todo(1)
        return untickItem(pressed.n.id).then(inbox.reload, inbox.reload)
      })
    }
    window.addEventListener(assessmentMissing.event, back)
    return () => window.removeEventListener(assessmentMissing.event, back)
  })

  // Tick: the circle fills and the row leaves. Undo is an untick.
  const tick = (n: Notification) => {
    if (inbox.phases[n.id]) return
    inbox.leave(n.id, 'ticking')
    todo(-1)
    tickItem(n.id).then(
      () =>
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
        }),
      () => undone(n, 1),
    )
  }

  // Untick: the mirror. Undo puts back what was there, not just the opposite: a row someone
  // ticked is ticked again, but a row I had only opened goes back through the open call, so
  // it does not become Done for every admin by accident.
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
              ;(n.doneAt ? tickItem(n.id) : openItem(n.id)).then(() => {
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

  // Open: go to the thing, and the item moves to Done for me. A To do row is remembered, so
  // coming back by Back shows it ticked and leaving.
  const open = (n: Notification) => {
    if (!n.done) {
      rememberOpened(n)
      todo(-1)
    }
    // Failed: the count goes back, or the next poll would read as a rise and chime on your own
    // action. The row stays To do on the server, so it's right again at the next read.
    const marked = n.read
      ? Promise.resolve(false)
      : openItem(n.id).then(
          () => true,
          () => {
            if (!n.done) todo(1)
            return false
          },
        )
    opening.current = { n, marked }
    openSubject(n)
  }

  return { tick, untick, bin, open }
}
