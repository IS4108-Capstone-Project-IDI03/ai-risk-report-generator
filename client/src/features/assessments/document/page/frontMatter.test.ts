import { describe, expect, it } from 'vitest'
import type { Assessment } from '../../api'
import {
  CONTENTS_ROW,
  CONTENTS_TITLE,
  contentsEntries,
  contentsPages,
  coverDetails,
  marshDay,
  shownDetail,
  type ContentsEntry,
} from './frontMatter'

// The cover, details page and contents of Marsh's page layout (RV-12 AC2,
// AC4, AC5).

const RECORD = {
  reference: 'RPT-2026-0411',
  client: 'Straits Logistics',
  surveyType: 'Property risk survey',
  siteVisitDate: '2026-02-26',
  engineer: { id: 'e1', name: 'Alex Rowe' },
  site: { name: 'Jurong Distribution Hub', address: '1 Tuas Avenue 2' },
} as unknown as Assessment

describe('marshDay', () => {
  it('writes a day as Marsh does, whatever the time zone', () => {
    expect(marshDay('2026-02-26')).toBe('26 February 2026')
    expect(marshDay('2026-12-01')).toBe('1 December 2026')
    expect(marshDay(null)).toBeNull()
    expect(marshDay('soon')).toBeNull()
  })
})

describe('coverDetails', () => {
  it('reads each detail from the assessment, its client and its site (AC2)', () => {
    expect(coverDetails(RECORD)).toEqual({
      client: 'Straits Logistics',
      site: 'Jurong Distribution Hub',
      address: '1 Tuas Avenue 2',
      reference: 'RPT-2026-0411',
      assessmentType: 'Property risk survey',
      visitDate: '26 February 2026',
      engineer: 'Alex Rowe',
    })
  })

  it('leaves a missing detail empty, shown as "Not entered" (AC4)', () => {
    const details = coverDetails({
      ...RECORD,
      siteVisitDate: null,
      engineer: null,
      site: { ...RECORD.site, address: '  ' },
    } as Assessment)
    expect(details.address).toBeNull()
    expect(details.visitDate).toBeNull()
    expect(details.engineer).toBeNull()
    expect(shownDetail(details.address)).toBe('Not entered')
    expect(Object.values(coverDetails(null)).every((v) => v === null)).toBe(true)
  })
})

describe('contents', () => {
  const parts = [
    { id: '1', number: '1', title: 'Purpose and Scope' },
    { id: '7', number: '7', title: 'Construction' },
    { id: 'A', number: 'A', title: 'Site Photos' },
  ]

  it('lists each section, then its sub-headings, with the page each starts on (AC5)', () => {
    const entries = contentsEntries(parts, [
      { sectionId: '1', level: 1, text: '1. Purpose and Scope', page: 0 },
      { sectionId: '7', level: 1, text: '7. Construction', page: 3 },
      { sectionId: '7', level: 2, text: 'Construction Narrative', page: 3 },
      { sectionId: '7', level: 2, text: 'Construction Table', page: 4 },
      { sectionId: 'A', level: 1, text: 'Appendix A. Site Photos', page: 9 },
    ])
    expect(entries.map((e) => [e.level, e.number, e.title, e.page])).toEqual([
      [1, '1.', 'Purpose and Scope', 1],
      [1, '7.', 'Construction', 4],
      [2, '', 'Construction Narrative', 4],
      [2, '', 'Construction Table', 5],
      [1, 'Appendix A:', 'Site Photos', 10],
    ])
  })

  it('carries on over another page when the entries do not fit on one', () => {
    const entry: ContentsEntry = { sectionId: '7', level: 2, number: '', title: 'x', page: 1 }
    const fit = Math.floor((500 - CONTENTS_TITLE) / CONTENTS_ROW[2])
    const pages = contentsPages(Array(fit + 3).fill(entry), 500)
    expect(pages.map((p) => p.length)).toEqual([fit, 3])
  })
})
