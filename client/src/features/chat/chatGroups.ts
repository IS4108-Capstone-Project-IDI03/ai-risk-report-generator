// Groups the saved chats in the sidebar by when they were started (CB-03), as chat apps do:
// Today, Yesterday, Previous 7 days, Older. Called by components/ChatThreadList.tsx.

export type ChatGroup<T> = { label: string; items: T[] }

const LABELS = ['Today', 'Yesterday', 'Previous 7 days', 'Older'] as const

/** Returns the group label for a chat started at `when`, counted in whole calendar days before `now`. */
export function recencyLabel(when: string | number | Date | undefined, now = new Date()): string {
  const date = when === undefined ? null : new Date(when)
  // A chat with no usable date (an optimistic row before the gateway answers) counts as new.
  if (!date || Number.isNaN(date.getTime()) || date.getTime() <= 0) return LABELS[0]
  const midnight = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
  const days = Math.round((midnight(now) - midnight(date)) / 86_400_000)
  if (days <= 0) return LABELS[0]
  if (days === 1) return LABELS[1]
  if (days <= 7) return LABELS[2]
  return LABELS[3]
}

/** Returns the chats in their recency groups, keeping the list's own order inside each group. */
export function groupByRecency<T extends { createdAt?: string | number | Date }>(
  chats: T[],
  now = new Date(),
): ChatGroup<T>[] {
  const groups = new Map<string, T[]>(LABELS.map((label) => [label, []]))
  for (const chat of chats) groups.get(recencyLabel(chat.createdAt, now))!.push(chat)
  return [...groups].filter(([, items]) => items.length).map(([label, items]) => ({ label, items }))
}
