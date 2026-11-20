// Test for a recording's name (CP-24): its first six words, with no stray full stop before "…".
// Covers walkItems.ts.
import { describe, expect, it } from 'vitest'
import { transcriptName } from './walkItems'

describe('transcriptName', () => {
  it('cuts after six words with one ellipsis, never four dots', () => {
    expect(transcriptName("We're now at Block A, level two.")).toBe(
      "“We're now at Block A, level…”",
    )
    expect(transcriptName('Smoke detectors missing in the plant. Next area is dry.')).toBe(
      '“Smoke detectors missing in the plant…”',
    )
  })

  it('keeps the full stop when the whole transcript fits', () => {
    expect(transcriptName('All clear here.')).toBe('“All clear here.”')
  })
})
