// MarshBot's wording (AS-06 round 5; the rules pick the format since round 8): asks rag-service
// once to reword each new bot turn as an OpenUI Lang program and keeps only programs that pass
// the checks below. The rules decide the form of every piece (the bold lead line, the ticks, the
// stand-out message, where each card sits); the AI only rewords, and never adds a number or a
// name. A turn's program is set when the turn is made and never changed (rule 8); without one,
// the turn is drawn as its says then its cards. Called by thread.service.ts.
import type { StoredTurn } from '../../models/assistant-thread.model'
import { recordAiCalls } from '../ai-usage.service'
import { privacyFor } from '../privacy.service'
import { requestAssistantWording } from '../rag.service'
import { inBackground } from './background'
import { ASSISTANT } from './settings'
import { STAGE_LABELS } from './stage'
import { partsOf, programOf } from './thread/session'

/**
 * The MarshBot library's components; FORMS below reads the same ones.
 * Must match client/src/features/marshbot/ (the drift test reads rag-service's
 * app/assistant/marshbot_components.txt, generated from the client's library).
 */
export const MARSHBOT_COMPONENTS = ['Reply', 'Lead', 'Say', 'Ticks', 'Alert', 'Card']
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
// The numbers in `text`, each once, sorted ("2.5" and "2,5" are one number, not 2 and 5; the
// join is a space so "2,5" can't equal the two numbers 2 and 5).
const numbers = (text: string) =>
  [...new Set(text.match(/\d+(?:[.,]\d+)*/g) ?? [])].sort().join(' ')
// A tick, cross, pictograph (⚠️), list mark or line break: typed into plain words they would draw
// a tick, an alert or a list the rules never marked.
const MARKS = /[✓✔☑✅•▪◦✗✘❌✖\n]|\p{Extended_Pictographic}/u
// The bold runs of `text` (the text between a pair of `**`), trimmed and in lower case.
const boldRuns = (text: string) =>
  text
    .split('**')
    .filter((_, n) => n % 2)
    .map((run) => run.trim().toLowerCase())
// Whether `text` bolds only names, with every `**` closed: a bold run must be one of `names`,
// one the rule words bold, or a short phrase the rule words of the same part already hold (the
// prompt asks for names in bold, and a place like "Loading Bay 2" is in no list). A whole
// sentence in bold would pass for the lead line the rules pick, and an unclosed `**` would
// bold the rest of the bubble.
const boldKept = (text: string, rule: string, names: string[]) => {
  const allowed = [...boldRuns(rule), ...names.filter(Boolean).map((n) => n.toLowerCase())]
  const phrase = (run: string) =>
    !/[.!?,;:]/.test(run) && run.split(/\s+/).length <= 5 && rule.toLowerCase().includes(run)
  return (
    text.split('**').length % 2 === 1 &&
    boldRuns(text).every((run) => !!run && (allowed.includes(run) || phrase(run)))
  )
}
// Words checked in every part as if they were names: swapping one for another changes the facts
// (a stage, a weekday, a date) without touching a number. Matched with their capital letter, so
// the verbs "review", "capture" and "may" don't count as the stage or the month.
const FIXED_NAMES = [
  ...Object.values(STAGE_LABELS),
  ...['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'],
  ...['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September'],
  ...['October', 'November', 'December'],
  ...['Jan', 'Feb', 'Mar', 'Apr', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'],
]
// Whether `text` names `name` as whole words: in any case, or exactly as written when `exact`.
const mentions = (text: string, name: string, exact = false) =>
  new RegExp(
    String.raw`(?<!\w)${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?!\w)`,
    exact ? '' : 'i',
  ).test(text)

// One piece of a turn as a program writes it: its kind ("Lead", "Say", "Say:good", "Ticks:3",
// "Alert", "Card:<id>") and the words it shows (null for a string JSON can't read).
type Piece = { kind: string; words: (string | null)[] }
// The only calls a piece may be: a component of the library with its words as string literals
// and nothing else. A number outside a string (`Lead(42)`), a call inside a call and any other
// component match none of them.
const one = (name: string) => new RegExp(String.raw`^${name}\(\s*(${STRING})\s*\)$`)
const FORMS = {
  lead: one('Lead'),
  alert: one('Alert'),
  card: one('Card'),
  say: new RegExp(String.raw`^Say\(\s*(${STRING})\s*(?:,\s*(${STRING})\s*)?\)$`),
  ticks: new RegExp(String.raw`^Ticks\(\s*\[\s*(${STRING}(?:\s*,\s*${STRING})*)\s*\]\s*\)$`),
}
function pieceOf(call: string): Piece | null {
  let m: RegExpExecArray | null
  if ((m = FORMS.lead.exec(call))) return { kind: 'Lead', words: [literal(m[1])] }
  if ((m = FORMS.alert.exec(call))) return { kind: 'Alert', words: [literal(m[1])] }
  if ((m = FORMS.card.exec(call))) return { kind: `Card:${literal(m[1])}`, words: [] }
  if ((m = FORMS.say.exec(call))) {
    const tone = m[2] ? literal(m[2]) : 'normal'
    if (tone !== 'good' && tone !== 'normal') return null
    return { kind: tone === 'good' ? 'Say:good' : 'Say', words: [literal(m[1])] }
  }
  if ((m = FORMS.ticks.exec(call))) {
    const items = m[1].match(new RegExp(STRING, 'g')) ?? []
    return { kind: `Ticks:${items.length}`, words: items.map(literal) }
  }
  return null
}

// A list's entries, split at the commas outside any string, bracket or call.
function entries(list: string): string[] {
  const out = ['']
  let depth = 0
  for (const [token] of list.matchAll(new RegExp(String.raw`${STRING}|[\s\S]`, 'g'))) {
    if (token === ',' && depth === 0) out.push('')
    else {
      if (token === '(' || token === '[') depth += 1
      if (token === ')' || token === ']') depth -= 1
      out[out.length - 1] += token
    }
  }
  return out.map((entry) => entry.trim()).filter(Boolean)
}

/**
 * Returns the pieces `root = Reply([...])` draws, in order, or null when the program is not
 * made only of the library's pieces: each entry of the root is a piece written in place or the
 * name of a statement that is one, and no statement is drawn twice (a card twice would double
 * its rows). Statements the root never names are not drawn, so they are not read.
 */
function piecesOf(code: string): Piece[] | null {
  // A statement is `name = call`; a line that starts none continues the last.
  const all = new Map<string, string>()
  let last = ''
  for (const line of code.split('\n')) {
    const m = /^\s*([A-Za-z_]\w*)\s*=(.*)$/.exec(line)
    if (m) all.set((last = m[1]), m[2])
    else if (last) all.set(last, `${all.get(last)}\n${line}`)
  }
  const root = /^Reply\(\s*\[([\s\S]*)\]\s*\)$/.exec((all.get('root') ?? '').trim())
  if (!root) return null
  const used = new Set<string>()
  const pieces: Piece[] = []
  for (const entry of entries(root[1])) {
    const named = /^[A-Za-z_]\w*$/.test(entry)
    if (named && (used.has(entry) || !all.has(entry))) return null
    used.add(entry)
    const piece = pieceOf((named ? all.get(entry)! : entry).trim())
    if (!piece) return null
    pieces.push(piece)
  }
  return pieces
}

// The format of a turn: its pieces' kinds in order, with a run of words of one tone as one
// (words that follow each other share a bubble, so 2 sentences as 1 Say or as 2 look the same).
const formatOf = (pieces: Piece[]) =>
  pieces
    .map((p) => p.kind)
    .filter((k, n, kinds) => !k.startsWith('Say') || kinds[n - 1] !== k)
    .join(' ')

// The words of each part that is checked on its own, in order: a lead line, a stand-out
// message, each tick, and a run of words of one tone as one. Two programs of the same format
// give the same number of parts, so part n of one is the rewording of part n of the other.
function wordsOf(pieces: Piece[]): string[] {
  const parts: string[] = []
  pieces.forEach((p, n) => {
    if (p.kind.startsWith('Say') && pieces[n - 1]?.kind === p.kind)
      parts[parts.length - 1] += ` ${p.words[0]}`
    else parts.push(...p.words.map(String))
  })
  return parts
}

/**
 * Returns the program if MarshBot can draw it, it keeps the format the rules
 * picked and it says nothing the turn didn't, else null. The format is the
 * turn's own program (programOf): the same pieces in the same order, so the AI
 * can't add or drop a lead line, a tick, a green or a stand-out message, nor
 * move, leave out, invent or repeat a card. Then each part is checked against
 * the rule words it rewords (the lead line against the lead line, tick 2
 * against tick 2): it must use the same numbers, name the same of `names`
 * (areas, sections, places) and of the stages, weekdays and months, type no
 * tick, cross, pictograph or list mark of its own, and bold only a name: one
 * of `names` or a short phrase the rule words of that part hold (the rules
 * pick what stands out). Without
 * this, an invented id would draw nothing, a left-out card would hide a row the
 * engineer needs, a number or a name could move from a tick to the overdue
 * message (so the wrong thing reads as done), a number taken from elsewhere
 * would point the engineer at the wrong thing (#51), and a reworded catch-up
 * could change what is sorted.
 * Known limits: inside one part a number is not tied to the word beside it,
 * a name that is in no list (one the AI made up) is not caught, and a stage
 * or month is read only with its capital letter ("Review", not "review").
 */
export function checkedProgram(
  program: string,
  turn: StoredTurn,
  names: string[] = [],
): string | null {
  const code = program
    .trim()
    .replace(/^```\w*\n|\n```$/g, '')
    .trim()
  if (!code.startsWith('root = Reply(')) return null
  const pieces = piecesOf(code)
  const own = piecesOf(programOf(turn)) ?? []
  if (!pieces || formatOf(pieces) !== formatOf(own)) return null
  if (pieces.some((p) => p.words.some((t) => t === null))) return null
  const said = wordsOf(own)
  const written = wordsOf(pieces)
  if (!written.length || written.length !== said.length) return null
  const kept = written.every(
    (text, n) =>
      !MARKS.test(text) &&
      boldKept(text, said[n], names) &&
      numbers(text) === numbers(said[n]) &&
      names.every((name) => !name || mentions(text, name) === mentions(said[n], name)) &&
      FIXED_NAMES.every((w) => mentions(text, w, true) === mentions(said[n], w, true)),
  )
  return kept ? code : null
}

// Resolves to null after `ms`, so a slow AI never holds a turn back for long.
const timeout = (ms: number) =>
  new Promise<null>((resolve) => setTimeout(() => resolve(null), ms).unref?.())

/**
 * Asks once for the wording of these new bot turns; returns the programs that
 * pass, by turn id, or none when the AI fails or takes longer than `ASSISTANT.wordingTimeoutMs`. Never
 * throws. Text is masked by rag-service's privacy path when protection is on.
 */
export async function wordTurns(
  reference: string,
  firstName: string,
  turns: StoredTurn[],
  names: string[],
): Promise<Record<string, string>> {
  if (!turns.length) return {}
  const call = (async () => {
    const result = await requestAssistantWording({
      viewer: { first_name: firstName, role: 'engineer' },
      messages: turns.map((t) => ({
        id: t.id,
        text: '',
        // In the order drawn, so a bubble meant to sit between two cards is asked for there.
        parts: partsOf(t).map((p) =>
          p.type === 'say'
            ? { type: 'say', text: p.say.text, tone: p.say.tone }
            : // Only the id and the kind of card: nothing a card shows is sent to the AI.
              { type: 'card', id: p.card.id, card: p.card.type },
        ),
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
