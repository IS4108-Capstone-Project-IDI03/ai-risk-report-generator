// Generate (AS-06): questions a draft asks the engineer about gaps in the evidence.
import type { CheckContext } from '../context'
import { plural, raise, type RaisedItem } from '../item'

/** Returns a gap per drafted section with open questions. */
export function draftQuestions(ctx: CheckContext): RaisedItem[] {
  if (ctx.stage !== 'generate') return []
  return (ctx.sections ?? [])
    .filter((s) => s.latest?.questions?.length)
    .map(({ section, latest }) =>
      raise({
        id: `generate.questions:${section.id}`,
        kind: 'draft-questions',
        stage: 'generate',
        weight: 'gap',
        title: section.title,
        detail: `${plural(latest!.questions.length, 'question')} in the draft`,
        fact: `The ${section.title} draft asks ${plural(latest!.questions.length, 'question')}.`,
        icon: 'message-circle-question',
        link: { tab: 'generate', params: { section: section.id } },
        facts: { questions: latest!.questions.length, draft: String(latest!._id) },
      }),
    )
}
