// What the pages before the report show in Marsh's page layout (RV-12 AC2,
// AC4, AC5): the cover and details page, from the assessment and its client
// and site records read now, so a corrected detail shows at once (AC3); and
// the contents, from the report's headings and the pages they start on.
import type { Assessment } from '../../api'
import { NOT_ENTERED } from '../../reportFigures'
import { PT } from './geometry'

const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
]

// A YYYY-MM-DD day as Marsh's details page writes it: "26 February 2026". Read
// from its parts, so no time zone moves it to the day before.
export function marshDay(day: string | null | undefined): string | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(day ?? '')
  if (!match) return null
  const month = MONTHS[Number(match[2]) - 1]
  return month ? `${Number(match[3])} ${month} ${match[1]}` : null
}

const given = (text: string | null | undefined) => (text?.trim() ? text.trim() : null)

// Each detail the cover and details page show, or null when it has no value.
export type CoverDetails = {
  client: string | null
  site: string | null
  address: string | null
  reference: string | null
  assessmentType: string | null
  visitDate: string | null
  engineer: string | null
}

export function coverDetails(assessment: Assessment | null | undefined): CoverDetails {
  return {
    client: given(assessment?.client),
    site: given(assessment?.site.name),
    address: given(assessment?.site.address),
    reference: given(assessment?.reference),
    assessmentType: given(assessment?.surveyType),
    visitDate: marshDay(assessment?.siteVisitDate),
    engineer: given(assessment?.engineer?.name),
  }
}

// A detail as shown: its value, or "Not entered" as Sections 4 and 5 say for
// a missing figure (GN-03), never a value made up in its place (AC4).
export const shownDetail = (value: string | null) => value ?? NOT_ENTERED

// A heading the contents can list, with the report page it starts on (from 1).
export type ContentsEntry = {
  sectionId: string
  level: 1 | 2
  // "7." or "Appendix A:" for a section; empty for a sub-heading.
  number: string
  title: string
  page: number
}

// Rows of the contents as Marsh's samples space them: 30pt for a section,
// 24pt for a sub-heading, under an 80pt "Contents" title on the first page.
export const CONTENTS_ROW = { 1: 30 * PT, 2: 24 * PT } as const
export const CONTENTS_TITLE = 80 * PT

// The contents split into pages: as many entries as fit on each, the title
// on the first.
export function contentsPages(entries: ContentsEntry[], contentHeight: number) {
  const pages: ContentsEntry[][] = [[]]
  let used = CONTENTS_TITLE
  for (const entry of entries) {
    const height = CONTENTS_ROW[entry.level]
    if (used + height > contentHeight && pages.at(-1)!.length) {
      pages.push([])
      used = 0
    }
    pages.at(-1)!.push(entry)
    used += height
  }
  return pages
}

// A section's number as its contents entry starts: "7." or "Appendix A:";
// nothing for a part with no number, the export's References (EX-01).
export const contentsNumber = (number: string) =>
  /^\d+$/.test(number) ? `${number}.` : number ? `Appendix ${number}:` : ''

// Marsh's logo for the cover (AC2): none was supplied (docs/design-system.md),
// so the cover shows the text wordmark. Set this to the logo's URL (e.g. a
// file added under client/public) once Marsh supplies it.
export const MARSH_LOGO: string | null = null

// The report's running header and footer, as Office Sample 5 prints them.
export const REPORT_TITLE = 'Property Risk Evaluation Report'
export const FOOTER_LINES = ['Marsh Advisory', 'Consulting Solutions']

// The contents from the report's parts and the headings the layout found,
// each with the report page it starts on (AC5): a section, then its
// sub-headings one level down, in report order.
export function contentsEntries(
  parts: { id: string; number: string; title: string }[],
  headings: { sectionId: string; level: 1 | 2; text: string; page: number }[],
): ContentsEntry[] {
  return parts.flatMap((part) => {
    const own = headings.filter((h) => h.sectionId === part.id)
    const heading = own.find((h) => h.level === 1)
    if (!heading) return []
    return [
      {
        sectionId: part.id,
        level: 1 as const,
        number: contentsNumber(part.number),
        title: part.title,
        page: heading.page + 1,
      },
      ...own
        .filter((h) => h.level === 2)
        .map((h) => ({
          sectionId: part.id,
          level: 2 as const,
          number: '',
          title: h.text,
          page: h.page + 1,
        })),
    ]
  })
}
