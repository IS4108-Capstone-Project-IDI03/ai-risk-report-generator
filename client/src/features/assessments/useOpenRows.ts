// Which rows of All Photos, All Handwritten Pages or All Recordings have their
// text open (CP-12). PhotoTable.tsx keeps its own, unless given one to share:
// All Recordings opens a recording's transcript as it plays.
import { useState } from 'react'

export function useOpenRows() {
  const [open, setOpen] = useState<ReadonlySet<string>>(new Set())
  const toggle = (key: string) =>
    setOpen((was) => {
      const next = new Set(was)
      if (!next.delete(key)) next.add(key)
      return next
    })
  const show = (key: string) => setOpen((was) => (was.has(key) ? was : new Set(was).add(key)))
  return { open, toggle, show }
}
export type OpenRows = ReturnType<typeof useOpenRows>
