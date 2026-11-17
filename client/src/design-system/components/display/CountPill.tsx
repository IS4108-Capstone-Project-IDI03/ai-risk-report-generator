// A small count beside a heading: a grey pill (graphite fill, 12 px, tabular numbers), so a
// block can say how many it holds. Not the tabs' own count style, which has its own CSS.
// AS-06's Details panel shows it on Client Documents. Called by feature screens.

/** Returns a 12 px grey pill holding `children`, numbers lined up. */
export function CountPill({ children }: { children: number | string }) {
  return <span className="ds-count-pill">{children}</span>
}
