// Review reminder (AS-06 AC 10): draft questions the engineer hasn't had on
// screen. The browser reports question n of a draft as seen key
// `question:<draftId>:<n>` under place `section:<id>`, so a regenerated draft's
// questions start unseen.
import type { CheckContext } from '../context'
import { plural, raise, type RaisedItem } from '../item'
import { ASSISTANT } from '../settings'

/** Returns a reminder per section with draft questions not yet seen. */
export function unseenQuestions(ctx: CheckContext): RaisedItem[] {
  if (ctx.stage !== 'review') return []
  return (ctx.sections ?? []).flatMap(({ section, latest }) => {
    const questions = latest?.questions ?? []
    const seen = ctx.activity.get(`section:${section.id}`)?.seen ?? {}
    const draft = String(latest?._id)
    const unseen = questions.filter(
      (_, n) => (seen[`question:${draft}:${n}`] ?? 0) < ASSISTANT.readMs,
    ).length
    if (!unseen) return []
    return [
      raise({
        id: `review.unseen-questions:${section.id}`,
        kind: 'unseen-questions',
        stage: 'review',
        weight: 'reminder',
        title: section.title,
        detail: `${plural(unseen, 'draft question')} you haven't seen`,
        fact: `${section.title} has ${plural(unseen, 'draft question')} you haven't seen.`,
        icon: 'eye-off',
        link: { tab: 'review', params: { section: section.id } },
        facts: { unseen, draft },
      }),
    ]
  })
}
