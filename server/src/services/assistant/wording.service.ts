// MarshBot's wording (AS-06): asks rag-service to reword the template messages
// as OpenUI Lang programs, keeps only the programs that pass the checks below,
// and saves them on the brief. Called by recheck.service.ts in the background;
// a failure leaves each message's program null, so its plain text shows.
import { AssistantBriefModel } from '../../models/assistant-brief.model'
import { recordAiCalls } from '../ai-usage.service'
import { privacyFor } from '../privacy.service'
import { requestAssistantWording } from '../rag.service'
import { publishBriefChanged } from './bus'
import type { BriefItem, BriefMessage } from './types'

/**
 * The MarshBot library's components, the one list the program check uses.
 * Must match client/src/features/marshbot/library.tsx (the drift test reads
 * rag-service's app/assistant/marshbot_components.txt, generated from it).
 */
export const MARSHBOT_COMPONENTS = [
  'Reply',
  'Say',
  'ActionRow',
  'HealthBars',
  'ReportOutline',
  'StatusLanes',
  'StageTime',
  'ExportFile',
  'QuickReply',
  'LinkButton',
]
const COMPONENTS = new Set(MARSHBOT_COMPONENTS)
const STRING = String.raw`"(?:[^"\\]|\\.)*"`
// A string literal's text, or null for one JSON can't read (e.g. `\'`): without this, one bad
// escape from the AI would throw and lose every message's wording, not just this one.
function literal(text: string): string | null {
  try {
    return JSON.parse(text) as string
  } catch {
    return null
  }
}
const strings = (text: string) =>
  [...text.matchAll(new RegExp(STRING, 'g'))].map((m) => literal(m[0]))
// The id arguments: an ActionRow's item, a QuickReply's reply, a LinkButton's link key (`link-<part index>`).
const ID_ARGS = [
  new RegExp(String.raw`\bActionRow\(\s*(${STRING})`, 'g'),
  new RegExp(String.raw`\bQuickReply\(\s*(${STRING})`, 'g'),
  new RegExp(String.raw`\bLinkButton\(\s*${STRING}\s*,\s*(${STRING})`, 'g'),
]
const digits = (text: string) => text.match(/\d+/g) ?? []
// Whether `text` names `name` as whole words, in any case.
const mentions = (text: string, name: string) =>
  new RegExp(String.raw`(?<!\w)${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?!\w)`, 'i').test(
    text,
  )

// The text of the statements reachable from root, the only ones OpenUI draws.
// A statement is `name = expression`; a line that starts none continues the last.
function reachable(code: string): string {
  const all = new Map<string, string>()
  let last = ''
  for (const line of code.split('\n')) {
    const m = /^\s*([A-Za-z_]\w*)\s*=(.*)$/.exec(line)
    if (m) all.set((last = m[1]), m[2])
    else if (last) all.set(last, `${all.get(last)}\n${line}`)
  }
  const seen = new Set<string>()
  const todo = ['root']
  while (todo.length) {
    const name = todo.pop()!
    if (seen.has(name) || !all.has(name)) continue
    seen.add(name)
    todo.push(
      ...(all
        .get(name)!
        .replace(new RegExp(STRING, 'g'), '""')
        .match(/\b\w+\b/g) ?? []),
    )
  }
  return [...seen].map((n) => all.get(n)).join('\n')
}

/**
 * Returns the program if MarshBot can draw it and it says nothing the rules
 * didn't, else null: rooted at Reply, only library components, every id one
 * of this message's items, replies or links, every number and every name
 * (`names`: areas, sections; plus the places items name) in its words
 * already in the message's own text or link labels, and every control the
 * message needs drawn: each quick reply, each link, and the row of each Fix
 * now item. Without this, an invented id would draw the wrong row, a number
 * or area taken from elsewhere would point the engineer at the wrong thing
 * (#51), and a left-out button would leave a question with no way to answer it.
 */
export function checkedProgram(
  program: string,
  message: BriefMessage,
  items: BriefItem[],
  names: string[] = [],
): string | null {
  const code = program
    .trim()
    .replace(/^```\w*\n|\n```$/g, '')
    .trim()
  if (!code.startsWith('root = Reply(')) return null
  const called = code.replace(new RegExp(STRING, 'g'), '""').matchAll(/\b([A-Z]\w*)\(/g)
  if ([...called].some((m) => !COMPONENTS.has(m[1]))) return null
  const rows = message.parts.flatMap((p) => (p.type === 'actions' ? p.itemIds : []))
  const known = [
    new Set(rows),
    new Set(message.parts.flatMap((p) => (p.type === 'replies' ? p.replies.map((r) => r.id) : []))),
    new Set(message.parts.flatMap((p, i) => (p.type === 'link' ? [`link-${i}`] : []))),
  ]
  for (const [n, pattern] of ID_ARGS.entries())
    for (const m of code.matchAll(pattern)) {
      const id = literal(m[1])
      if (id === null || !known[n].has(id)) return null
    }
  // Every control the rules gave must be reachable from root.
  const shown = reachable(code)
  const drawn = ID_ARGS.map(
    (pattern) => new Set([...shown.matchAll(pattern)].map((m) => literal(m[1]))),
  )
  const fixNow = new Set(items.filter((i) => i.weight === 'fix_now').map((i) => i.id))
  const needed = [rows.filter((id) => fixNow.has(id)), [...known[1]], [...known[2]]]
  if (needed.some((ids, n) => ids.some((id) => !drawn[n].has(id)))) return null
  // The template's own words: an item's facts don't count, its row shows them (#51).
  const template = [
    message.text,
    ...message.parts.map((p) => (p.type === 'link' ? p.label : '')),
  ].join(' ')
  const allowed = new Set(digits(template))
  // A place an item names (an observation's location, a site walk) is a name too.
  const places = items
    .filter((i) => i.link?.params?.obs || i.link?.params?.walk)
    .map((i) => i.title)
  const named = [...names, ...places].filter((n) => n && !mentions(template, n))
  const words = ID_ARGS.reduce(
    (text, pattern) => text.replace(pattern, (m, id: string) => m.replace(id, '""')),
    code,
  )
  const texts = strings(words)
  if (texts.some((t) => t === null)) return null
  if (!texts.flatMap((t) => digits(t!)).every((d) => allowed.has(d))) return null
  return texts.some((t) => named.some((n) => mentions(t!, n))) ? null : code
}

/**
 * Asks for the wording of `messages` and saves the programs that pass, if the
 * brief still wants this message set (`key`); returns nothing. Never throws.
 * `names` are the areas and section titles a program may only repeat.
 */
export async function requestWording(
  reference: string,
  key: string,
  messages: BriefMessage[],
  items: BriefItem[],
  firstName: string,
  names: string[],
): Promise<void> {
  try {
    const result = await requestAssistantWording({
      viewer: { first_name: firstName, role: 'engineer' },
      messages: messages.map(({ id, text, parts }) => ({ id, text, parts })),
      items: items.map(({ id, title, detail, kind, weight }) => ({
        id,
        title,
        detail,
        kind,
        weight,
      })),
      privacy: await privacyFor(reference),
    })
    // The call is billed even if nothing passes, so record first.
    await recordAiCalls(result.usage, { reportId: reference })
    const $set: Record<string, string> = {}
    for (const m of messages) {
      const program = result.programs?.[m.id]
      const checked = typeof program === 'string' ? checkedProgram(program, m, items, names) : null
      if (checked) $set[`wording.programs.${m.id}`] = checked
    }
    if (!Object.keys($set).length) return
    const saved = await AssistantBriefModel.findOneAndUpdate(
      { reference, 'wording.key': key },
      { $set },
      { returnDocument: 'after' },
    ).lean()
    if (saved) publishBriefChanged(reference, saved.updatedAt.toISOString())
  } catch (error) {
    console.warn(
      `MarshBot wording failed for ${reference}:`,
      error instanceof Error ? error.message : error,
    )
  }
}
