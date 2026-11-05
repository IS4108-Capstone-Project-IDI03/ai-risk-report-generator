// The shared counts' context and the hooks that read it (F-10). Split from the provider so
// that file exports only a component. Provided by NotificationCountsContext.tsx.
import { createContext, useContext } from 'react'
import type { Counts } from './chime'

export type NotificationCountsApi = {
  counts: Counts
  // Records a change the person just made (opened, ticked, binned, undone) or a list's own
  // totals. It moves the sound baseline too, so your own action never chimes.
  change: (update: Partial<Counts> | ((current: Counts) => Counts)) => void
  // Counts each poll that found the To do figure moved by someone or something else: never
  // the person's own change. The Inbox reads its list again when this moves.
  outsideChanges: number
}

export const CountsContext = createContext<NotificationCountsApi | null>(null)

/** Returns the shared counts; throws without a provider. */
export function useNotificationCounts(): NotificationCountsApi {
  const api = useContext(CountsContext)
  if (!api) throw new Error('useNotificationCounts needs a NotificationCountsProvider')
  return api
}
