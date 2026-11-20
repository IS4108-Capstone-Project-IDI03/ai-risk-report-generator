// Tests for the standards count, the clause parser and the citation label (GN-16).
import { describe, expect, it } from 'vitest'
import type { ReviewSection, SourcePassage } from './api'
import { countCitingStandard } from './citedStandards'
import { clauseOf, passageLabel } from './reviewDisplay'

const src = (id: string, kind: 'standard' | 'precedent'): SourcePassage => ({
  id,
  kind,
  text: '',
  headings: [],
  pageStart: null,
  pageEnd: null,
  documentId: null,
  document: null,
})
// A section with one statement citing `cites`; `drafted` false leaves no draft.
const section = (id: string, cites: string[], drafted = true): ReviewSection =>
  ({
    id,
    sources: { 'C:s': src('C:s', 'standard'), 'P:p': src('P:p', 'precedent') },
    draft: drafted
      ? {
          subsections: [
            {
              heading: 'h',
              kind: 'narrative',
              statements: [{ citations: cites, review: { state: 'pending' } }],
            },
          ],
        }
      : null,
  }) as unknown as ReviewSection

describe('countCitingStandard', () => {
  it('counts sections 7-12 only, drafted only, standards only', () => {
    expect(
      countCitingStandard([
        section('4', ['C:s']),
        section('7', ['C:s']),
        section('8', ['P:p']),
        section('9', ['O:o1']),
        section('10', ['C:s'], false),
        section('11', ['C:s']),
      ]),
    ).toEqual({ cited: 2, total: 4 })
  })
})

describe('clauseOf', () => {
  it.each([
    [[], null],
    [['Section 8.6.2 Spacing'], '8.6.2'],
    [['8 General'], null],
    [['Chapter 8.6 Spacing', 'Section 8.6.2 Hangers'], '8.6.2'],
    [['Section 8.6.2 Hangers', 'Notes'], '8.6.2'],
    [['Table 8.6.2 Hose demand'], null],
    [['Figure 4.2 Layout'], null],
    [['NFPA 13 edition 2022.1 notes'], null],
  ])('%j -> %j', (headings, want) => expect(clauseOf(headings)).toBe(want))
})

describe('passageLabel', () => {
  const doc = (edition: string | null) =>
    ({ title: 'NFPA 13', edition }) as SourcePassage['document']
  const p = (o: Partial<SourcePassage>) => ({ ...src('C:s', 'standard'), ...o })
  it('builds title (edition), clause, page', () => {
    expect(
      passageLabel(p({ document: doc('2022'), headings: ['8.6.2 Spacing'], pageStart: 114 })),
    ).toBe('NFPA 13 (2022), 8.6.2, p. 114')
  })
  it('does not repeat an edition the title already carries', () => {
    const titled = { title: 'NFPA 13 (2022)', edition: '2022' } as SourcePassage['document']
    expect(passageLabel(p({ document: titled, headings: ['8.6.2'], pageStart: 1 }))).toBe(
      'NFPA 13 (2022), 8.6.2, p. 1',
    )
  })
  it('leaves out what is missing, with no stray commas', () => {
    expect(passageLabel(p({ document: doc(null), pageStart: 114 }))).toBe('NFPA 13, p. 114')
    expect(passageLabel(p({ document: doc('2022'), headings: ['8.6.2'] }))).toBe(
      'NFPA 13 (2022), 8.6.2',
    )
    expect(passageLabel(p({ document: doc(null), pageStart: 3, pageEnd: 4 }))).toBe(
      'NFPA 13, pp. 3–4',
    )
  })
})
