// Exporting the finished report as a PDF or Word file (EX-01). The browser
// lays the report out with Marsh's page layout (RV-12) and sends the pages;
// the gateway checks who is asking and that the report is complete, then
// prints the PDF from those pages, or reads them into a Word document
// (export-render.service, export-docx). Nothing is stored: the file goes back
// to the browser as the answer.
// Called by routes/assessment.routes.ts.
import { z } from 'zod'
import type { SessionUser } from './auth.service'
import { AssessmentModel, type IAssessment } from '../models/assessment.model'
import type { ISite } from '../models/site.model'
import { UserModel } from '../models/user.model'
import { NotAssignedError } from './assessment.service'
import { AssessmentNotFoundError } from './capture-session.service'
import { clientNameOf } from './client.service'
import { config } from '../config'
import { buildDocx } from './export-docx'
import type { ExportDetails } from './export-model'
import { printPdf, readReport, textsOf, withExportPage } from './export-render.service'
import { listOfis } from './ofi.service'
import { getReviewWorkspace, type ReviewWorkspaceDto } from './review.service'
import { figureFacts } from './section.service'
import { getSummary, type SummaryDto } from './summary.service'

// The export pages are one HTML document with the photos inside it at print
// resolution; this is well above a long report with its full appendix.
export const MAX_EXPORT_HTML = 60 * 1024 * 1024

// The body of POST /api/assessments/:reference/export.
export const exportRequestSchema = z.strictObject({
  format: z.enum(['pdf', 'docx']),
  // What the engineer chose to include (AC6); the pages already follow it.
  citations: z.boolean(),
  photos: z.boolean(),
  // The export pages, laid out by the browser.
  html: z.string().min(1).max(MAX_EXPORT_HTML),
})
export type ExportRequest = z.infer<typeof exportRequestSchema>
export type ExportFormat = ExportRequest['format']

// Something left to finish before the report can be exported, with where
// it is and where it is finished: on Generation (drafting) or in the review
// workspace.
export type ExportBlocker = {
  sectionId: string
  title: string
  reason: string
  where: 'generation' | 'review'
}

export class ExportBlockedError extends Error {
  readonly blockers: ExportBlocker[]
  constructor(blockers: ExportBlocker[]) {
    super(
      'The report cannot be exported until it is complete. Finish what is listed, then export again.',
    )
    this.name = 'ExportBlockedError'
    this.blockers = blockers
  }
}

// A masking placeholder was left where a client detail should be (AC9).
export class UnrestoredPlaceholderError extends Error {
  constructor(part: string, placeholder: string) {
    super(
      `${part} still shows ${placeholder}, a placeholder used to hide a client detail from the AI, instead of the real text. Replace it with the right name in the document editor, then export again.`,
    )
    this.name = 'UnrestoredPlaceholderError'
  }
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`
const listed = (names: string[]) =>
  names.length > 1 ? `${names.slice(0, -1).join(', ')} and ${names.at(-1)}` : (names[0] ?? '')

const SUMMARY = '2. Executive Summary'
const OFIS = '3. Opportunities for Improvement'

// What keeps the report from being exported (AC1): it goes out only once it
// is complete, written and reviewed (DECISIONS 2026-11-05), the check until
// RV-04 builds its full one (overrides, citation targets, second-layer review):
// - Section 2: the Executive Summary drafted, and not out of date;
// - Section 3: at least one accepted Opportunity for Improvement;
// - Sections 4-12: each drafted, or written in the document editor; Sections
//   4 and 5 with every figure entered; and in each draft, no new draft waiting,
//   every finding decided, none unsupported, none citing a withdrawn source,
//   and nothing changed since it was drafted.
// Each item names its section, in report order. Empty when it may go.
export async function exportBlockers(reference: string): Promise<ExportBlocker[]> {
  const [workspace, summary, ofis, assessment] = await Promise.all([
    getReviewWorkspace(reference),
    getSummary(reference),
    listOfis(reference),
    AssessmentModel.findOne({ reference }, 'riskQuality lossEstimates').lean(),
  ])
  return blockersFrom({ workspace, summary, ofis, assessment })
}

/** Returns the export blockers from data already loaded (MarshBot's re-check reads it once). */
export function blockersFrom({
  workspace,
  summary,
  ofis,
  assessment,
}: {
  workspace: ReviewWorkspaceDto
  summary: SummaryDto
  ofis: Awaited<ReturnType<typeof listOfis>>
  assessment: Pick<IAssessment, 'riskQuality' | 'lossEstimates'> | null
}): ExportBlocker[] {
  const out: ExportBlocker[] = []
  const add = (sectionId: string, title: string, where: ExportBlocker['where'], reason: string) =>
    out.push({ sectionId, title, where, reason })

  const { draft: summaryDraft, staleSections } = summary.executiveSummary
  if (!summaryDraft)
    add(
      '2',
      SUMMARY,
      'generation',
      'It is not drafted yet. Draft it on Generation once Sections 3 to 12 are complete.',
    )
  else if (staleSections.length)
    add(
      '2',
      SUMMARY,
      'generation',
      `It is out of date: ${listed(staleSections.map((s) => `Section ${s.id}`))} changed since it was drafted. Draft it again on Generation.`,
    )
  if (!ofis.accepted.length)
    add(
      '3',
      OFIS,
      'generation',
      'No Opportunity for Improvement is accepted yet. Draft them on Generation, then accept at least one in the review workspace.',
    )

  for (const section of workspace.sections) {
    const title = `${section.id}. ${section.title}`
    const missing = assessment ? figureFacts(section.id, assessment).missing : undefined
    if (missing) add(section.id, title, 'review', `Its figures are not all entered. ${missing}`)
    if (section.completion.state === 'not_started') {
      add(
        section.id,
        title,
        'generation',
        'It is not written yet. Draft it on Generation, or write it in the document editor.',
      )
      continue
    }
    // Written in the document editor, with no draft to review.
    if (!section.draft) continue
    if (section.replacement)
      add(section.id, title, 'review', 'A new draft is waiting for you to accept or discard it.')
    const { pending } = section.findings
    const { unsupportedStatements: unsupported, withdrawnSources: withdrawn } = section.review
    if (pending)
      add(
        section.id,
        title,
        'review',
        `${plural(pending, 'finding')} ${pending === 1 ? 'is' : 'are'} waiting for your decision.`,
      )
    if (unsupported)
      add(
        section.id,
        title,
        'review',
        `${plural(unsupported, 'finding')} ${unsupported === 1 ? 'is' : 'are'} unsupported by evidence.`,
      )
    if (withdrawn)
      add(section.id, title, 'review', `It cites ${plural(withdrawn, 'withdrawn source')}.`)
    // Out of date (figures missing are listed above already).
    const changes = section.review.changeCounts
    const changed = [
      changes.added + changes.changed + changes.removed ? 'its evidence' : null,
      changes.figures && !missing ? 'its figures' : null,
      changes.scope ? "the site's jurisdiction or facility type" : null,
    ].filter((c): c is string => c !== null)
    if (changed.length)
      add(
        section.id,
        title,
        'review',
        `It is out of date: ${listed(changed)} changed since it was drafted. Review the changes, or draft it again.`,
      )
  }
  return out
}

type ListedSite = Pick<ISite, 'name' | 'address'> & { client?: { name: string } | null }

// The assessment, when the user is its assigned engineer (AC2), with that
// engineer's name as their account now has it. Checked on the stored id, as
// every assignment check is: a populated engineer would be null, and the
// check fail, for an account no longer in the users collection. An archived
// report can still be exported again.
async function assessmentToExport(reference: string, user: SessionUser) {
  const assessment = await AssessmentModel.findOne({ reference })
    .populate<{ site: ListedSite | null }>({
      path: 'site',
      select: 'name address client',
      populate: { path: 'client', select: 'name' },
    })
    .lean()
  if (!assessment) throw new AssessmentNotFoundError(reference)
  if (String(assessment.engineer) !== user.id)
    throw new NotAssignedError('Only the assigned engineer can export this report.')
  const account = await UserModel.findById(assessment.engineer, 'name').lean()
  return { ...assessment, engineerName: account?.name ?? user.name }
}

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
// "26 February 2026", as the page layout's details page writes a day.
const marshDay = (date: Date | undefined | null) =>
  date ? `${date.getUTCDate()} ${MONTHS[date.getUTCMonth()]} ${date.getUTCFullYear()}` : null
const given = (text: string | null | undefined) => (text?.trim() ? text.trim() : null)

// The day an export is made, where the team works (REPORT_TIME_ZONE).
export function exportDay(at: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: config.reportTimeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(at)
}

// "RPT-2026-0411 2026-11-04.pdf": the report reference and the export date (AC1).
export function exportFileName(reference: string, format: ExportFormat, at: Date): string {
  const safe = reference.replace(/[^A-Za-z0-9_-]+/g, '-')
  return `${safe} ${exportDay(at)}.${format}`
}

// A placeholder privacy-service writes for a client detail (PV-01): its types,
// in brackets or not, any case ("[PERSON_1]", "person_1"), and with a space
// inside brackets ("[PERSON 1]"), which it cannot restore.
const PLACEHOLDER =
  /\[(?:CLIENT|SITE|ADDRESS|PERSON|NRIC|PHONE|EMAIL|UEN|POSTAL|LITERAL)[ _]\d+\]|\b(?:CLIENT|SITE|ADDRESS|PERSON|NRIC|PHONE|EMAIL|UEN|POSTAL|LITERAL)_\d+\b/i

export function findPlaceholder(text: string): string | null {
  return PLACEHOLDER.exec(text)?.[0] ?? null
}

export type ExportedFile = { file: Buffer; fileName: string; contentType: string }

const CONTENT_TYPES: Record<ExportFormat, string> = {
  pdf: 'application/pdf',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
}

// Exports the report (AC1-AC11): only its assigned engineer (403), once it is
// complete (409 with what is left to finish), and never with a masking
// placeholder left in it (422). The file is the answer; nothing is kept.
export async function exportReport(
  reference: string,
  input: ExportRequest,
  user: SessionUser,
  at = new Date(),
): Promise<ExportedFile> {
  const assessment = await assessmentToExport(reference, user)
  const blockers = await exportBlockers(reference)
  if (blockers.length) throw new ExportBlockedError(blockers)

  const site = assessment.site
  const details: ExportDetails = {
    reference: assessment.reference,
    client: given(clientNameOf(site, assessment.client)),
    site: given(site?.name),
    address: given(site?.address),
    assessmentType: given(assessment.surveyType),
    visitDate: marshDay(assessment.siteVisitDate),
    engineer: given(assessment.engineerName),
  }

  const file = await withExportPage(input.html, async (page) => {
    for (const { part, text } of await textsOf(page)) {
      const placeholder = findPlaceholder(text)
      if (placeholder) throw new UnrestoredPlaceholderError(part, placeholder)
    }
    if (input.format === 'pdf') return await printPdf(page)
    const { model, pictures } = await readReport(page)
    return await buildDocx(model, pictures, details)
  })
  return {
    file,
    fileName: exportFileName(reference, input.format, at),
    contentType: CONTENT_TYPES[input.format],
  }
}
