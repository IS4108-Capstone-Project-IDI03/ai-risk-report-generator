// Pure edits to the list of proposed note parts (CP-35): move, split, merge, delete, add.
// Called by components/useSplitNote.ts. Each returns a new list and never changes the old one.
import type { Part, PartFlag, PartKind } from './api'

export const KINDS: { kind: PartKind; heading: string; noun: string; plural: string }[] = [
  { kind: 'fact', heading: 'Facts', noun: 'fact', plural: 'facts' },
  { kind: 'info_request', heading: 'Info requests', noun: 'request', plural: 'requests' },
  {
    kind: 'recommendation',
    heading: 'Recommendations',
    noun: 'recommendation',
    plural: 'recommendations',
  },
]
export const KIND_LABEL: Record<PartKind, string> = {
  fact: 'Fact',
  info_request: 'Info request',
  recommendation: 'Recommendation',
}

let counter = 0
/** Returns a new id for a part made in the browser (split or added by hand). */
export const localId = () => `local-${++counter}`

/** Returns the first point where a part's text splits: '; ' (dropped) or '. ' (kept), or null. */
export function splitPoint(text: string): { head: string; tail: string } | null {
  const semi = text.indexOf('; ')
  const dot = text.indexOf('. ')
  const cut = [semi, dot].filter((i) => i >= 0).sort((a, b) => a - b)[0]
  if (cut === undefined) return null
  const head = text.slice(0, cut + (cut === dot ? 1 : 0)).trim()
  const tail = text.slice(cut + 2).trim()
  return head && tail ? { head, tail } : null
}

const patch = (parts: Part[], id: string, change: Partial<Part>) =>
  parts.map((p) => (p.id === id ? { ...p, ...change } : p))

/** Returns the parts with one part's text changed. */
export const editText = (parts: Part[], id: string, text: string) => patch(parts, id, { text })
/** Returns the parts with one part moved to another group (it goes last there). */
export function moveTo(parts: Part[], id: string, kind: PartKind) {
  const part = parts.find((p) => p.id === id)
  return part ? [...parts.filter((p) => p.id !== id), { ...part, kind }] : parts
}
/** Returns the parts with one part removed. */
export const remove = (parts: Part[], id: string) => parts.filter((p) => p.id !== id)
/** Returns the parts with an empty one added to a group. */
export const addTo = (parts: Part[], kind: PartKind): Part[] => [
  ...parts,
  { id: localId(), kind, text: '', shorthand: '', inferred: false, flags: [] },
]
/** Returns the parts with one flag cleared from a part. */
export const clearFlag = (parts: Part[], id: string, flag: PartFlag) =>
  parts.map((p) => (p.id === id ? { ...p, flags: p.flags.filter((f) => f !== flag) } : p))

/** Returns the parts with one part split in two at its split point (the same group). */
export function split(parts: Part[], id: string) {
  const i = parts.findIndex((p) => p.id === id)
  const cut = i < 0 ? null : splitPoint(parts[i].text)
  if (!cut) return parts
  const first = { ...parts[i], text: cut.head }
  const second = { ...parts[i], id: localId(), text: cut.tail, flags: [] }
  return [...parts.slice(0, i), first, second, ...parts.slice(i + 1)]
}

/** Returns the next part in the same group after this one, or undefined. */
export const nextInGroup = (parts: Part[], id: string) => {
  const i = parts.findIndex((p) => p.id === id)
  return parts.slice(i + 1).find((p) => p.kind === parts[i]?.kind)
}

/** Returns the parts with a part joined to the next one in its group. */
export function mergeNext(parts: Part[], id: string) {
  const next = nextInGroup(parts, id)
  const part = parts.find((p) => p.id === id)
  if (!next || !part) return parts
  const merged = {
    ...part,
    text: `${part.text} ${next.text}`.trim(),
    shorthand: [part.shorthand, next.shorthand].filter(Boolean).join(' '),
    flags: [...part.flags, ...next.flags],
  }
  return remove(patch(parts, id, merged), next.id)
}

/** Returns "3 parts confirmed (1 fact, 1 request, 1 recommendation)". */
export function summary(parts: Part[]) {
  const counts = KINDS.map((k) => ({ k, n: parts.filter((p) => p.kind === k.kind).length })).filter(
    (c) => c.n > 0,
  )
  const list = counts.map((c) => `${c.n} ${c.n === 1 ? c.k.noun : c.k.plural}`).join(', ')
  return `${parts.length} ${parts.length === 1 ? 'part' : 'parts'} confirmed (${list})`
}
