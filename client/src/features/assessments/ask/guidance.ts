// Which part of the report each writing guidance button (AS-08) may ask about, as the gateway's
// section-guidance.service decides it. Used by components/WritingGuidance.tsx and AskPanel.tsx.
import type { Reason } from '../../../design-system'
import type { GuideKind } from './api'

// Which parts each button asks about (as the gateway's section-guidance.service).
const COVER_SECTIONS = /^(1[0-2]|[4-9])$/
const MISSING_SECTIONS = /^(1[0-2]|[2-9])$/

/** Returns why a guidance button can't be used for the part open, if it can't. */
export function guideBlocked(
  kind: GuideKind,
  target: { sectionId: string; label: string } | null,
): Reason | undefined {
  if (!target)
    return { title: 'No section open', text: 'Open a section of the report to ask about it.' }
  if (kind === 'cover' && !COVER_SECTIONS.test(target.sectionId))
    return {
      title: 'Not for this part',
      text: 'The report template defines Sections 4 to 12. Open one of them to ask what it should cover.',
    }
  if (kind === 'missing' && !MISSING_SECTIONS.test(target.sectionId))
    return {
      title: 'Not for this part',
      text: `${target.label} is filled in from the assessment. Open one of Sections 2 to 12 to ask what is missing from it.`,
    }
  return undefined
}
