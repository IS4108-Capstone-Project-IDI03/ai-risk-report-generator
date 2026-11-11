// Review, and once it was ready to export or exported (AS-06): what review
// still holds, one line per kind, each linking to Review at the section with
// the most of it. Kept on after Review, as a regenerated draft or a new
// comment can reopen review work while the stage stays where it got to.
import type { CheckContext } from '../context'
import { listed, plural, raise, type RaisedItem } from '../item'
import type { ReviewSectionDto } from '../../review.service'

type Count = (s: ReviewSectionDto) => number
const KINDS: { key: string; title: string; noun: [string, string]; icon: string; count: Count }[] =
  [
    {
      key: 'pending',
      title: 'Findings to decide',
      noun: ['finding to decide', 'findings to decide'],
      icon: 'list-checks',
      count: (s) => s.findings.pending,
    },
    {
      key: 'unsupported',
      title: 'Unsupported statements',
      noun: ['unsupported statement', 'unsupported statements'],
      icon: 'triangle-alert',
      count: (s) => s.review.unsupportedStatements,
    },
    {
      key: 'withdrawn',
      title: 'Withdrawn sources cited',
      noun: ['withdrawn source cited', 'withdrawn sources cited'],
      icon: 'archive-x',
      count: (s) => s.review.withdrawnSources,
    },
    {
      key: 'replacements',
      title: 'New drafts waiting',
      noun: ['new draft waiting', 'new drafts waiting'],
      icon: 'file-diff',
      count: (s) => (s.replacement ? 1 : 0),
    },
  ]

/** Returns one gap per kind of open review work, and one for open comments. */
export function reviewItems(ctx: CheckContext): RaisedItem[] {
  if (!['review', 'ready_to_export', 'exported'].includes(ctx.stage) || !ctx.workspace) return []
  const sections = ctx.workspace.sections
  const items = KINDS.flatMap(({ key, title, noun, icon, count }) => {
    const found = sections.filter((s) => count(s) > 0).sort((a, b) => count(b) - count(a))
    if (!found.length) return []
    const n = found.reduce((sum, s) => sum + count(s), 0)
    const where =
      found.length > 2 ? plural(found.length, 'section') : listed(found.map((s) => s.title))
    return [
      raise({
        id: `review.${key}`,
        kind: 'review-items',
        stage: 'review',
        weight: 'gap',
        title,
        detail: `${n} in ${where}`,
        fact: `${plural(n, ...noun)} in ${where}.`,
        icon,
        link: { tab: 'review', params: { section: found[0].id } },
        facts: { count: n, sections: found.map((s) => s.id).join(',') },
      }),
    ]
  })
  const open = ctx.threads.filter((t) => t.status === 'open')
  if (open.length) {
    const ids = [...new Set(open.map((t) => t.anchor.sectionId))]
    const where =
      ids.length > 2
        ? plural(ids.length, 'section')
        : listed(ids.map((id) => sections.find((s) => s.id === id)?.title ?? `Section ${id}`))
    items.push(
      raise({
        id: 'review.comments',
        kind: 'review-items',
        stage: 'review',
        weight: 'gap',
        title: 'Open comments',
        detail: `${open.length} on ${where}`,
        fact: `${plural(open.length, 'open comment')} on ${where}.`,
        icon: 'message-square',
        link: { tab: 'review', params: { section: ids[0] } },
        facts: { count: open.length, sections: ids.join(',') },
      }),
    )
  }
  return items
}
