// The filter menus' choices with their icons (CP-22): shared by the
// Observations tab's filters (components/ObservationFilters.tsx) and a site walk
// proposal's (site-walk/components/ProposalFilters.tsx), so both look the same.
import { IconRegistry } from '../../design-system'
import { CAT_ICON, UNCATEGORISED } from './categories'
import type { Choice } from './components/ChoiceMenu'
import { CAT_TINT } from './components/ObservationMarks'

// The workflow lists some options as plain strings.
export const asChoices = (list: (string | Choice)[]): Choice[] =>
  list.map((c) => (typeof c === 'string' ? { value: c, label: c } : c))

export const sevIcons = (choices: Choice[]) =>
  choices.map((c) => {
    const mark = IconRegistry.severity[c.value as keyof typeof IconRegistry.severity]
    return mark ? { ...c, icon: mark.icon, color: mark.color } : c
  })
// Each category with its own icon, as in every category picker.
export const catIcons = (choices: Choice[]) =>
  choices.map((c) =>
    c.value === UNCATEGORISED
      ? { ...c, icon: 'circle-dashed' }
      : CAT_ICON[c.value]
        ? { ...c, icon: CAT_ICON[c.value], color: CAT_TINT[c.value] }
        : c,
  )
// Type and status choices use the same icons as the list's marks.
const TYPE_ICON: Record<string, string> = {
  Note: IconRegistry.evidence.note,
  Voice: IconRegistry.evidence.recording,
  Photo: IconRegistry.evidence.photo,
  Scan: IconRegistry.evidence.handwriting,
}
export const typeIcons = (choices: Choice[]) =>
  choices.map((c) => (TYPE_ICON[c.value] ? { ...c, icon: TYPE_ICON[c.value] } : c))
