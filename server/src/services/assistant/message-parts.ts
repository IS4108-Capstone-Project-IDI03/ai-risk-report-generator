// The pieces MarshBot's messages are made of (AS-06): a message with a stable
// id, its action rows and link buttons, and what the builders read.
// Called by messages.ts and stage-messages.ts.
import { fingerprintOf } from './item'
import type { BriefFacts } from './phrases'
import type { AreaHealth, BriefItem, BriefMessage, MessagePart, SectionState, Stage } from './types'

export type MessageInput = {
  role: 'engineer' | 'admin'
  viewerName: string
  stage: Stage
  facts: BriefFacts
  items: BriefItem[] // open and visible to this viewer
  resolvedSince: BriefItem[] // resolved since this viewer last opened the Overview
  movedSince: boolean // the stage moved on since then
  areas: AreaHealth[]
  sections: SectionState[]
  coverage: 'idle' | 'running' | 'done' | 'failed'
  exportAgain: string | null // the stale-export fingerprint "Export again" was pressed for
  today: string
  now: Date
}

/** Returns a message whose id is stable for the same words and parts. */
export function message(
  key: string,
  text: string,
  parts: MessagePart[] = [],
  tone: BriefMessage['tone'] = 'normal',
): BriefMessage {
  return {
    id: `${key}-${fingerprintOf([text, parts]).slice(0, 8)}`,
    text,
    program: null,
    parts,
    tone,
  }
}
export const actions = (items: BriefItem[]): MessagePart => ({
  type: 'actions',
  itemIds: items.map((i) => i.id),
})
export const link = (
  label: string,
  tab: Extract<MessagePart, { type: 'link' }>['link']['tab'],
  icon: string,
  params?: Record<string, string>,
): MessagePart => ({
  type: 'link',
  label,
  link: params ? { tab, params } : { tab },
  icon,
})

// Takes the items not yet said that match `pick`, marking them said.
export type Take = (pick: (i: BriefItem) => boolean) => BriefItem[]
