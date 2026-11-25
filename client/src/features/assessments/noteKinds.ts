// The tags an observation can carry (CP-36): Recommendation, Info request, and its own sort-only
// labels. Fact is implicit: no tag means Fact, so the picker offers no Fact tag; a "also states a
// fact" checkbox adds 'fact' to the saved kinds when advice or a request also holds a fact.
// Used by components/KindPicker.tsx, KindBadges.tsx and the Observations tab's tag filter.
import type { Kind } from './api'

export const KINDS: Kind[] = ['fact', 'info_request', 'recommendation']
export const KIND_LABEL: Record<Kind, string> = {
  fact: 'Fact',
  info_request: 'Info request',
  recommendation: 'Recommendation',
}
// The tags the engineer picks from, in display order, with their icons (lucide, as the rest of the app).
export const CHIPS: Exclude<Kind, 'fact'>[] = ['recommendation', 'info_request']
export const KIND_ICON: Record<Kind, string> = {
  fact: 'check',
  info_request: 'circle-help',
  recommendation: 'lightbulb',
}
export const LABEL_ICON = 'tag'
export const MAX_LABELS = 8
export const MAX_LABEL_LENGTH = 30

/** Returns the tags in the fixed order, so two orders of the same choice compare equal. */
export const sortKinds = (kinds: readonly Kind[]): Kind[] => KINDS.filter((k) => kinds.includes(k))

/** Returns the saved kinds for chosen chips: none when no chip is chosen (a Fact), else with 'fact' if also a fact. */
export const kindsFrom = (chips: readonly Kind[], alsoFact: boolean): Kind[] =>
  chips.length ? sortKinds([...chips, ...(alsoFact ? (['fact'] as const) : [])]) : []

/** Returns the Recommendation / Info request part of kinds. */
export const chipsOf = (kinds: readonly Kind[]): Kind[] => kinds.filter((k) => k !== 'fact')

type Tagged = { kinds?: readonly Kind[]; labels?: readonly string[] }

/** Returns true when the observation carries the filter value ('' all, a kind, or 'label:<text>'). */
export function hasTag(o: Tagged, value: string): boolean {
  if (!value) return true
  if (value.startsWith('label:')) return !!o.labels?.includes(value.slice(6))
  return !!o.kinds?.includes(value as Kind)
}

/** Returns the filter row's chips: All, each kind in use, then each custom label in use, with counts. */
export function tagFilterChips(rows: readonly Tagged[]) {
  const count = (value: string) => rows.filter((o) => hasTag(o, value)).length
  const labels = [...new Set(rows.flatMap((o) => o.labels ?? []))].sort((a, b) =>
    a.localeCompare(b),
  )
  return [
    { value: '', label: 'All', icon: null as string | null, count: rows.length },
    ...CHIPS.map((k) => ({
      value: k as string,
      label: KIND_LABEL[k],
      icon: KIND_ICON[k],
      count: count(k),
    })),
    ...labels.map((l) => ({
      value: 'label:' + l,
      label: l,
      icon: LABEL_ICON,
      count: count('label:' + l),
    })),
  ].filter((c, i) => i === 0 || c.count > 0)
}
