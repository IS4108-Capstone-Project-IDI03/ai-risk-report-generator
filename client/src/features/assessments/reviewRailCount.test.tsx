// The Review tab's "X of 11 reviewed" (AS-06 round 7): the rail counts reviewed parts the way
// MarshBot does (server/src/services/assistant/progress.ts). Draws ReviewSectionRail alone.
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import type { ReviewSection, Summary } from './api'
import { ReviewSectionRail } from './components/ReviewSectionRail'

afterEach(cleanup)

// A drafted section with nothing open; `extra` changes what the case needs.
const section = (id: string, extra: Partial<ReviewSection> = {}): ReviewSection => ({
  id,
  title: `Section ${id}`,
  copeDimensions: [],
  completion: { state: 'complete', written: 1, total: 1, tables: 0 },
  review: {
    state: 'reviewed',
    unsupportedStatements: 0,
    withdrawnSources: 0,
    changesSinceDraft: 0,
    changeCounts: { added: 0, changed: 0, removed: 0 },
  },
  findings: { total: 1, pending: 0, accepted: 1, edited: 0, rejected: 0 },
  draft: {} as ReviewSection['draft'],
  sources: {},
  observations: [],
  replacement: null,
  history: [],
  ...extra,
})

describe('Review rail count', () => {
  it('counts an accepted OFI and a clean section, not a stale summary or a replacement draft', () => {
    const summary = {
      draft: {},
      missing: [],
      staleSections: [{ id: '7' }],
    } as unknown as Summary['executiveSummary']
    const replaced = section('8', {
      replacement: { draft: {} } as unknown as ReviewSection['replacement'],
    })
    render(
      <ReviewSectionRail
        sections={[section('7'), replaced]}
        selected="7"
        onSelect={() => {}}
        inReport={1}
        executiveSummary={summary}
        style={{}}
      />,
    )
    expect(screen.getByText('2 of 11 reviewed')).toBeTruthy()
  })
})
