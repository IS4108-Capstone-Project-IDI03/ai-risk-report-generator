// Generate onwards, reminder (AS-06 AC 10): comments others added since the
// engineer last opened Review, one line per person.
import type { CheckContext } from '../context'
import { listed, raise, type RaisedItem } from '../item'
import { partTitle } from '../progress'
import { things } from '../phrases'
import { stageIndex } from '../stage'

/** Returns a reminder per other person who commented since Review was last opened. */
export function newComments(ctx: CheckContext): RaisedItem[] {
  const engineer = ctx.assessment.engineer
  if (stageIndex(ctx.stage) < stageIndex('generate') || !engineer) return []
  const since = ctx.reviewOpenedAt?.getTime() ?? 0
  const byAuthor = new Map<string, { name: string; sections: string[] }>()
  for (const t of ctx.threads)
    for (const c of t.comments)
      if (!c.deletedAt && c.by.id !== String(engineer._id) && c.at.getTime() > since) {
        const found = byAuthor.get(c.by.id) ?? { name: c.by.name, sections: [] }
        found.sections.push(t.anchor.sectionId)
        byAuthor.set(c.by.id, found)
      }
  return [...byAuthor].map(([id, { name, sections }]) => {
    const n = sections.length
    const places = [...new Set(sections)].map(partTitle)
    const first = name.split(' ')[0]
    const detail =
      n === 1
        ? `On ${places[0]}`
        : places.length === 1
          ? `${n === 2 ? 'Both' : 'All'} on ${places[0]}`
          : `On ${listed(places)}`
    const title = `${things(n, 'new comment')} from ${first}`
    return raise({
      id: `review.new-comments:${id}`,
      kind: 'new-comments',
      stage: 'review',
      weight: 'reminder',
      title,
      detail,
      fact: `${title}, ${detail[0].toLowerCase()}${detail.slice(1)}.`,
      icon: 'message-square',
      link: { tab: 'review', params: { section: sections[0] } },
      facts: { comments: n, since },
    })
  })
}
