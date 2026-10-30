import { expect, it } from 'vitest'
import type { DocumentInline, SectionDocument } from './api'
import { diffSections, sameText, tokensOf, type DiffSegment } from './versionDiff'

// Comparing two texts of a report section (RV-06 AC3-AC5).

const text = (t: string, marks?: ('bold' | 'italic' | 'underline')[]): DocumentInline => ({
  type: 'text',
  text: t,
  ...(marks && { marks }),
})
const p = (...content: DocumentInline[]) => ({ type: 'paragraph' as const, content })
const narrative = (
  ...blocks: SectionDocument['subsections'][number]['blocks']
): SectionDocument => ({
  intro: [],
  subsections: [{ heading: 'Construction Narrative', blocks }],
})
// A segment's words, as read.
const words = (s: DiffSegment) =>
  s.op === 'changed'
    ? [s.op, s.from.map(read).join(' '), s.to.map(read).join(' ')]
    : [s.op, s.tokens.map(read).join(' ')]
const read = (t: ReturnType<typeof tokensOf>[number]) => (t.kind === 'cite' ? `[${t.id}]` : t.text)

it('marks text the newer version adds and deletes, and words it changes, block by block', () => {
  const older = narrative(
    p(text('Riser penetrations at Level 3 were not fire-stopped.')),
    p(text('The sprinkler valves are chained open.')),
  )
  const newer = narrative(
    p(text('Riser penetrations at Level 3 were found fire-stopped.')),
    p(text('Hot work permits are kept on site.')),
  )

  const { parts, counts } = diffSections(older, newer)

  expect(counts).toEqual({ added: 1, deleted: 1, changed: 1 })
  expect(parts).toHaveLength(1)
  expect(parts[0].heading).toBe('Construction Narrative')
  const [riser, added, deleted] = parts[0].blocks
  expect(riser.status).toBe('changed')
  expect(riser.segments.map(words)).toEqual([
    ['same', 'Riser penetrations at Level 3 were'],
    ['changed', 'not', 'found'],
    ['same', 'fire-stopped.'],
  ])
  expect(added).toMatchObject({ status: 'added', segments: [{ op: 'added' }] })
  expect(deleted).toMatchObject({ status: 'deleted', segments: [{ op: 'deleted' }] })
})

it('reads words added or deleted inside a block as added or deleted, not changed', () => {
  const { parts, counts } = diffSections(
    narrative(p(text('The roof is of construction.'))),
    narrative(p(text('The roof is of fire-resistive construction.'))),
  )
  expect(counts).toEqual({ added: 1, deleted: 0, changed: 0 })
  expect(parts[0].blocks[0].segments.map(words)).toEqual([
    ['same', 'The roof is of'],
    ['added', 'fire-resistive'],
    ['same', 'construction.'],
  ])
})

it('counts a change of formatting, of setting, or of place, and ignores spacing', () => {
  const plain = narrative(p(text('The building is steel framed.')))
  const bold = narrative(p(text('The building is '), text('steel', ['bold']), text(' framed.')))
  expect(diffSections(plain, bold).counts).toEqual({ added: 0, deleted: 0, changed: 1 })

  const heading = narrative({ type: 'heading', content: [text('The building is steel framed.')] })
  const reset = diffSections(plain, heading)
  expect(reset.counts.changed).toBe(1)
  expect(reset.parts[0].blocks[0]).toMatchObject({ shape: 'heading', shapeWas: 'paragraph' })

  expect(sameText(plain, narrative(p(text('  The building   is steel framed. '))))).toBe(true)
  expect(sameText(plain, bold)).toBe(false)
})

it('keeps a citation marker as a word of its own, so a deleted one shows', () => {
  const cited = narrative(p(text('Riser not fire-stopped.'), { type: 'cite', id: 'O:o1' }))
  const uncited = narrative(p(text('Riser not fire-stopped.')))
  const { parts, counts } = diffSections(cited, uncited)
  expect(counts).toEqual({ added: 0, deleted: 1, changed: 0 })
  expect(parts[0].blocks[0].segments.map(words)).toEqual([
    ['same', 'Riser not fire-stopped.'],
    ['deleted', '[O:o1]'],
  ])
})

it('compares subsections by heading, and the text before them as its own part', () => {
  const older: SectionDocument = {
    intro: [],
    subsections: [
      { heading: 'Construction Narrative', blocks: [p(text('Steel frame.'))] },
      { heading: 'Details on Combustible Construction', blocks: [p(text('Timber mezzanine.'))] },
    ],
  }
  const newer: SectionDocument = {
    intro: [p(text('Written before the subsections.'))],
    subsections: [{ heading: 'Construction Narrative', blocks: [p(text('Steel frame.'))] }],
  }
  const { parts, counts } = diffSections(older, newer)
  expect(parts.map((part) => part.heading)).toEqual([
    null,
    'Construction Narrative',
    'Details on Combustible Construction',
  ])
  expect(counts).toEqual({ added: 1, deleted: 1, changed: 0 })
})

it('keeps the spacing between words, and none inside a word split by formatting', () => {
  expect(
    tokensOf([
      text('steel-'),
      text('framed', ['bold']),
      text(' frame '),
      { type: 'cite', id: 'C:x' },
    ]),
  ).toEqual([
    { kind: 'word', text: 'steel-', marks: '', space: false },
    { kind: 'word', text: 'framed', marks: 'bold', space: false },
    { kind: 'word', text: 'frame', marks: '', space: true },
    { kind: 'cite', id: 'C:x', space: true },
  ])
})
