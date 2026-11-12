// Which rows of All Photos, All Handwritten Pages or All Recordings have their
// text open (CP-12). PhotoTable.tsx keeps its own, unless given one to share:
// All Recordings opens a recording's transcript as it plays. `initial` are
// the rows open to start with: those whose text a search matched, when a
// view comes back with its search (CP-13).
import { useState } from 'react'

export function useOpenRows(initial: () => Iterable<string> = () => []) {
  const [open, setOpen] = useState<ReadonlySet<string>>(() => new Set(initial()))
  const toggle = (key: string) =>
    setOpen((was) => {
      const next = new Set(was)
      if (!next.delete(key)) next.add(key)
      return next
    })
  const show = (key: string) => setOpen((was) => (was.has(key) ? was : new Set(was).add(key)))
  // Several at once, e.g. every row a search found in its text.
  const showAll = (keys: Iterable<string>) =>
    setOpen((was) => {
      const next = new Set(was)
      for (const key of keys) next.add(key)
      return next.size === was.size ? was : next
    })
  return { open, toggle, show, showAll }
}
export type OpenRows = ReturnType<typeof useOpenRows>
