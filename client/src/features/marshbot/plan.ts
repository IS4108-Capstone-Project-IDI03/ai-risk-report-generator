// How a MarshBot message breaks into parts, and how many words each has (AS-06). The reveal
// (usePacing.ts) steps through this plan; MessageBody.tsx draws the same parts in the same order.
import { programParts } from './library'
import type { BriefMessage, MessagePart } from './types'

// `glued`: no space before it, as in "**9 observations**;" where the ";" follows the bold words.
type Word = { text: string; bold: boolean; glued: boolean }

/** Returns the text's words in order, each marked bold when it sits inside **…**. */
export function wordsOf(text: string): Word[] {
  const parts = text.split('**')
  return parts.flatMap((part, i) =>
    part
      .split(/(\s+)/)
      .filter(Boolean)
      .flatMap((w, j, all): Word[] => {
        if (/^\s+$/.test(w)) return []
        // A part's first word joins the last one when no space sits between the parts.
        const glued = j === 0 ? i > 0 && !/\s$/.test(parts[i - 1]) : !/^\s+$/.test(all[j - 1])
        return [{ text: w, bold: i % 2 === 1, glued }]
      }),
  )
}

// The plain fallback as parts: the rule-written words, then one part per row, reply and link.
export type PlainPart =
  | { type: 'Say'; text: string }
  | { type: 'ActionRow'; id: string }
  | { type: 'QuickReply'; id: string }
  | { type: 'LinkButton'; label: string; id: string }
  | { type: 'HealthBars'; areas: string[] }
  | { type: 'ReportOutline' | 'StatusLanes' | 'StageTime' | 'ExportFile' }

function expand(part: MessagePart, index: number): PlainPart[] {
  switch (part.type) {
    case 'actions':
      return part.itemIds.map((id) => ({ type: 'ActionRow', id }))
    case 'replies':
      return part.replies.map((r) => ({ type: 'QuickReply', id: r.id }))
    // must match LinkButton's key in components/QuickReplies.tsx and the rag-service prompt
    case 'link':
      return [{ type: 'LinkButton', label: part.label, id: 'link-' + index }]
    case 'health':
      return [{ type: 'HealthBars', areas: part.areas }]
    case 'outline':
      return [{ type: 'ReportOutline' }]
    case 'lanes':
      return [{ type: 'StatusLanes' }]
    case 'stage-time':
      return [{ type: 'StageTime' }]
    case 'file':
      return [{ type: 'ExportFile' }]
  }
}

/** Returns the message's plain parts: its text, then its parts in order. */
export function plainParts(message: BriefMessage): PlainPart[] {
  return [{ type: 'Say', text: message.text }, ...message.parts.flatMap(expand)]
}

/** Returns the words in each part the message will show (0 for a widget). */
export function planOf(message: BriefMessage): number[] {
  const program = programParts(message)
  const parts = program
    ? program.map((n) => ({ type: n.typeName, text: n.props.text }))
    : plainParts(message)
  return parts.map((p) => (p.type === 'Say' && 'text' in p ? wordsOf(String(p.text)).length : 0))
}
