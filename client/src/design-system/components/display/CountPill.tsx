// A small count beside a heading: a grey pill (graphite fill, 12 px, tabular numbers), so a
// block can say how many it holds. Not the tabs' own count style, which has its own CSS.
// AS-06's Details panel shows it on Client Documents. Called by feature screens.

// `ink` is the blue count of a list that holds work (the Calendar's side lists); `danger` the red
// one of a list of late things (Late reports, when it isn't empty).
export type CountTone = 'grey' | 'ink' | 'danger'

/** Returns a 12 px pill holding `children` (grey unless given a tone), numbers lined up. */
export function CountPill({
  children,
  tone = 'grey',
}: {
  children: number | string
  tone?: CountTone
}) {
  return (
    <span className="ds-count-pill" data-tone={tone === 'grey' ? undefined : tone}>
      {children}
    </span>
  )
}
