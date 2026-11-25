// What the clauses page (IN-18) knows about a clause: the editor's form, which clauses a filter
// shows, and why Publish waits. Used by screens/ManualSections.tsx, components/ClauseList.tsx
// and components/ClauseEditor.tsx.
import type { ClauseInput, ManualSection } from './api'

// What the editor holds: the heading trail as bubbles, one per level, and the
// screenshots with their corrected text.
export type Form = {
  clause: string
  headings: string[]
  text: string
  images: ClauseInput['images']
}
export const BLANK: Form = { clause: '', headings: [], text: '', images: [] }

export const formOf = (s: ManualSection): Form => ({
  clause: s.clause,
  headings: s.headings,
  text: s.text,
  images: s.images,
})
export const inputOf = (form: Form): ClauseInput => ({
  clause: form.clause.trim(),
  headings: form.headings,
  text: form.text,
  images: form.images,
})

// The headings the other clauses use at `level` under the same parent headings
// (`before`), in clause order: what the trail's dropdown offers (IN-18).
export function headingsAt(sections: ManualSection[], level: number, before: string[]): string[] {
  const found = new Set<string>()
  for (const s of sections) {
    const parent = s.headings.slice(0, level)
    if (
      s.headings.length > level &&
      parent.length === before.length &&
      parent.every((h, i) => h === before[i])
    )
      found.add(s.headings[level])
  }
  return [...found]
}
export const byOrder = (a: ManualSection, b: ManualSection) => a.order - b.order || a.seq - b.seq
const clauses = (n: number) => `${n} clause${n === 1 ? '' : 's'}`

// The list's filter, to work through what Publish waits for (IN-18).
export type Show = 'all' | 'unchecked' | 'failed'
export const SHOWN: Record<Show, (s: ManualSection) => boolean> = {
  all: () => true,
  unchecked: (s) => !s.checked,
  failed: (s) => !s.indexed,
}

// Why Publish waits, or null when every clause is ready (the gateway's own rule).
export function publishWait(sections: ManualSection[]) {
  if (sections.length === 0) return 'Add at least one clause first.'
  const unchecked = sections.filter(SHOWN.unchecked).length
  const failed = sections.filter(SHOWN.failed).length
  if (!unchecked && !failed) return null
  const left = unchecked
    ? `${clauses(unchecked)} ${unchecked === 1 ? 'is' : 'are'} left to check`
    : ''
  const broken = failed ? `${left ? failed : clauses(failed)} not searchable yet` : ''
  return `${[left, broken].filter(Boolean).join(' and ')}. Finish them, then publish.`
}
