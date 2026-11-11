// Review reminder (AS-06 AC 10): a section whose findings were all decided in
// under a minute while most of them were never on screen. The browser reports
// a finding as seen key `<subsection>.<statement>` (its claim key, rejected
// findings left out) under place `section:<id>`. Only sections last decided
// after the engineer's first recorded activity count: before it nothing was
// tracked, so a section decided then would look rushed for no reason.
import type { CheckContext } from '../context'
import { raise, type RaisedItem } from '../item'
import { ASSISTANT } from '../settings'

/** Returns a reminder per fully decided section that went by quickly. */
export function quickDecision(ctx: CheckContext): RaisedItem[] {
  const tracked = ctx.firstActivityAt
  if (ctx.stage !== 'review' || !ctx.workspace || !tracked) return []
  return ctx.workspace.sections.flatMap((s) => {
    if (!s.draft || !s.findings.total || s.findings.pending) return []
    // History is newest first.
    const decided = s.history[0]?.at
    if (!decided || new Date(decided) <= tracked) return []
    const activity = ctx.activity.get(`section:${s.id}`)
    const keys = s.draft.subsections.flatMap((sub, i) =>
      sub.statements.flatMap((f, j) => (f.review.state === 'rejected' ? [] : [`${i}.${j}`])),
    )
    // Every finding rejected: nothing to have read (without this, 0 of 0 is NaN and flags it).
    if (!keys.length) return []
    const seen = keys.filter((k) => (activity?.seen[k] ?? 0) > 0).length
    if (
      (activity?.engagedMs ?? 0) >= ASSISTANT.quickDecisionMs ||
      seen / keys.length >= ASSISTANT.mostlySeenShare
    )
      return []
    return [
      raise({
        id: `review.quick:${s.id}`,
        kind: 'quick-decision',
        stage: 'review',
        weight: 'reminder',
        title: `${s.title} went by quickly`,
        detail: 'Everything was decided in under a minute, and most of it was never on screen.',
        fact: `${s.title} was decided in under a minute, mostly off screen.`,
        icon: 'eye',
        link: { tab: 'review', params: { section: s.id } },
        facts: { draft: s.draft.id, findings: s.findings.total },
      }),
    ]
  })
}
