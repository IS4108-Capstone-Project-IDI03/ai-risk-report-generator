// MarshBot's wording (AS-06 round 5): asks rag-service once to write each new
// bot turn as an OpenUI Lang program, `Reply([Say(...), Card("<id>")])`, and
// keeps only programs that pass the checks below. A turn's program is set
// when the turn is made and never changed (rule 8); without one, the turn is
// drawn as its says then its cards. Called by thread.service.ts.
import { recordAiCalls } from '../ai-usage.service'
import { privacyFor } from '../privacy.service'
import { requestAssistantWording } from '../rag.service'
import { inBackground } from './background'
import { ASSISTANT } from './settings'
import type { Turn } from './types'

/**
 * The MarshBot library's components, the one list the program check uses.
 * Must match client/src/features/marshbot/ (the drift test reads rag-service's
 * app/assistant/marshbot_components.txt, generated from the client's library).
 */
export const MARSHBOT_COMPONENTS = ['Reply', 'Say', 'Card']
const COMPONENTS = new Set(MARSHBOT_COMPONENTS)
const STRING = String.raw`"(?:[^"\\]|\\.)*"`
// A string literal's text, or null for one JSON can't read (e.g. `\'`): without this, one bad
// escape from the AI would throw and lose the wording of every turn, not just this one.
function literal(text: string): string | null {
  try {
    return JSON.parse(text) as string
  } catch {
    return null
  }
}
const digits = (text: string) => text.match(/\d+/g) ?? []
// Whether `text` names `name` as whole words, in any case.
const mentions = (text: string, name: string) =>
  new RegExp(String.raw`(?<!\w)${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?!\w)`, 'i').test(
    text,
  )

// The statements reachable from root, the only ones OpenUI draws, and whether
// any is used twice (a card drawn twice). A statement is `name = expression`;
// a line that starts none continues the last.
function reachable(code: string): { code: string; twice: boolean } {
  const all = new Map<string, string>()
  let last = ''
  for (const line of code.split('\n')) {
    const m = /^\s*([A-Za-z_]\w*)\s*=(.*)$/.exec(line)
    if (m) all.set((last = m[1]), m[2])
    else if (last) all.set(last, `${all.get(last)}\n${line}`)
  }
  const seen = new Set<string>()
  const uses = new Map<string, number>()
  const todo = ['root']
  while (todo.length) {
    const name = todo.pop()!
    if (seen.has(name) || !all.has(name)) continue
    seen.add(name)
    const refs = (
      all
        .get(name)!
        .replace(new RegExp(STRING, 'g'), '""')
        .match(/\b\w+\b/g) ?? []
    ).filter((ref) => all.has(ref))
    for (const ref of refs) uses.set(ref, (uses.get(ref) ?? 0) + 1)
    todo.push(...refs)
  }
  return {
    code: [...seen].map((n) => all.get(n)!).join('\n'),
    twice: [...uses.values()].some((n) => n > 1),
  }
}

/**
 * Returns the program if MarshBot can draw it and it says nothing the turn
 * didn't, else null: rooted at Reply, only Reply, Say and Card, every card of
 * the turn drawn exactly once and no other, a Say's tone only "good" or "normal", and
 * every number and every name (`names`: areas, sections, places) in its words
 * already in the turn's own says, and every such name the says use kept.
 * Without this, an invented id would draw nothing, a left-out card would hide
 * a row the engineer needs, a number taken from elsewhere would point them at
 * the wrong thing (#51), and a reworded catch-up could change what is sorted.
 */
export function checkedProgram(program: string, turn: Turn, names: string[] = []): string | null {
  const code = program
    .trim()
    .replace(/^```\w*\n|\n```$/g, '')
    .trim()
  if (!code.startsWith('root = Reply(')) return null
  const called = code.replace(new RegExp(STRING, 'g'), '""').matchAll(/\b([A-Z]\w*)\(/g)
  if ([...called].some((m) => !COMPONENTS.has(m[1]))) return null
  // Every card exactly once, and only from statements OpenUI draws.
  const { code: shown, twice } = reachable(code)
  if (twice) return null
  const cards = [...shown.matchAll(new RegExp(String.raw`\bCard\(\s*(${STRING})\s*\)`, 'g'))].map(
    (m) => literal(m[1]),
  )
  const ids = turn.cards.map((c) => c.id)
  if (cards.length !== ids.length || !ids.every((id) => cards.includes(id))) return null
  // A Say's second argument may only be a tone the library knows.
  const tones = [
    ...shown.matchAll(new RegExp(String.raw`\bSay\(\s*${STRING}\s*,\s*(${STRING})`, 'g')),
  ]
  if (tones.some((m) => !['good', 'normal'].includes(literal(m[1]) ?? ''))) return null
  const said = turn.says.map((s) => s.text).join(' ')
  const words = [...shown.matchAll(new RegExp(String.raw`\bSay\(\s*(${STRING})`, 'g'))].map((m) =>
    literal(m[1]),
  )
  if (!words.length || words.some((t) => t === null)) return null
  const allowed = new Set(digits(said))
  if (!words.flatMap((t) => digits(t!)).every((d) => allowed.has(d))) return null
  const unnamed = names.filter((n) => n && !mentions(said, n))
  if (words.some((t) => unnamed.some((n) => mentions(t!, n)))) return null
  // Every name the turn says is said again: a program can't drop a sorted item from a catch-up.
  const text = words.join(' ')
  return names.every((n) => !n || !mentions(said, n) || mentions(text, n)) ? code : null
}

// Resolves to null after `ms`, so a slow AI never holds a turn back for long.
const timeout = (ms: number) =>
  new Promise<null>((resolve) => setTimeout(() => resolve(null), ms).unref?.())

/**
 * Asks once for the wording of these new bot turns; returns the programs that
 * pass, by turn id, or none when the AI fails or takes longer than 4 s. Never
 * throws. Text is masked by rag-service's privacy path when protection is on.
 */
export async function wordTurns(
  reference: string,
  firstName: string,
  turns: Turn[],
  names: string[],
): Promise<Record<string, string>> {
  if (!turns.length) return {}
  const call = (async () => {
    const result = await requestAssistantWording({
      viewer: { first_name: firstName, role: 'engineer' },
      messages: turns.map((t) => ({
        id: t.id,
        text: '',
        parts: [
          ...t.says.map((s) => ({ type: 'say', text: s.text, tone: s.tone })),
          ...t.cards.map((c) => ({ type: 'card', id: c.id, card: c.type })),
        ],
      })),
      items: [],
      privacy: await privacyFor(reference),
    })
    // The call is billed even if it comes too late or nothing passes, so record first.
    await recordAiCalls(result.usage, { reportId: reference })
    return result.programs ?? {}
  })()
  // Tracked, so a late answer is still recorded before a test empties the database.
  inBackground('wording', call)
  try {
    const programs = await Promise.race([call, timeout(ASSISTANT.wordingTimeoutMs)])
    if (!programs) return {}
    return Object.fromEntries(
      turns.flatMap((t) => {
        const p = programs[t.id]
        const checked = typeof p === 'string' ? checkedProgram(p, t, names) : null
        return checked ? [[t.id, checked]] : []
      }),
    )
  } catch (error) {
    console.warn(
      `MarshBot wording failed for ${reference}:`,
      error instanceof Error ? error.message : error,
    )
    return {}
  }
}
