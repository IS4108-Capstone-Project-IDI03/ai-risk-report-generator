// CP-35: sorts a shorthand note into facts, info requests and recommendations. Called by
// the POST /api/assessments/:reference/split-note route. Calls rag-service /split-note for
// lines with no code. Saves nothing: the engineer confirms the parts first.
import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { AssessmentModel } from '../models/assessment.model'
import { PART_KINDS, type IPart, type PartKind } from '../models/observation.model'
import { recordAiCalls } from './ai-usage.service'
import { NotAssignedError } from './assessment.service'
import { AssessmentArchivedError, AssessmentNotFoundError } from './capture-session.service'
import { privacyFor } from './privacy.service'
import { requestSplitNote, RagServiceError } from './rag.service'
import { NOTE_KINDS, noteTakingFor } from './settings.service'
import type { SessionUser } from './auth.service'

export const splitNoteSchema = z.object({
  note: z
    .string('Write a note to split.')
    .max(5000, 'The note must be 5,000 characters or fewer.')
    .refine((n) => n.trim().length > 0, 'Write a note to split.'),
})

const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

// Which kind a line's own code names, with the text after it; null when it has no code.
function codedLine(line: string, codes: Record<PartKind, string>) {
  for (const kind of NOTE_KINDS) {
    const m = new RegExp(`^\\s*${escapeRegex(codes[kind])}\\s*:\\s*(.+)$`, 'i').exec(line)
    if (m?.[1].trim()) return { kind, text: m[1].trim() }
  }
  return null
}

/**
 * Returns the note as parts in line order: coded lines typed by the engineer's own codes,
 * the rest sorted by rag-service. Throws NotAssignedError, AssessmentArchivedError,
 * AssessmentNotFoundError and RagServiceError (503 means client details could not be protected).
 */
export async function splitNote(
  reference: string,
  note: string,
  user: SessionUser,
): Promise<IPart[]> {
  // a. Same rule as creating an observation: only the assigned engineer, not archived.
  const assessment = await AssessmentModel.findOne({ reference }, 'engineer archivedAt').lean()
  if (!assessment) throw new AssessmentNotFoundError(reference)
  if (String(assessment.engineer) !== user.id) {
    throw new NotAssignedError('Only the engineer assigned to this assessment can capture for it.')
  }
  if (assessment.archivedAt) throw new AssessmentArchivedError(reference)

  // b. Split by my codes; remember each uncoded line's position.
  const { codes, glossary } = await noteTakingFor(user.id)
  const slots: (IPart[] | string)[] = [] // typed parts, or the uncoded line waiting for rag
  for (const line of note.split(/\r?\n/).filter((l) => l.trim())) {
    const coded = codedLine(line, codes)
    slots.push(
      coded
        ? [
            {
              id: randomUUID(),
              kind: coded.kind,
              text: coded.text,
              shorthand: line,
              inferred: false,
              flags: [],
            },
          ]
        : line.trim(),
    )
  }
  const uncoded = slots.filter((s): s is string => typeof s === 'string')
  if (!uncoded.length) return slots.flat() as IPart[]

  // c. One rag call for all uncoded lines. Raw text goes with `privacy`; rag masks and
  // unmasks inside and answers 503 if it cannot, so raw text is never sent unprotected.
  const result = await requestSplitNote({
    lines: uncoded,
    glossary,
    privacy: await privacyFor(reference),
  })
  if (Array.isArray(result.usage)) {
    await recordAiCalls(
      result.usage.map((u: object) => ({ ...u, feature: 'split-note' })),
      { reportId: reference, userId: user.id },
    )
  }
  if (!Array.isArray(result.parts)) throw new RagServiceError('The split came back unreadable.')

  // d. Put each inferred part back at its line. A part whose shorthand names a later line
  // moves on to it; one that names none stays with the line before, so a split line stays together.
  const inferred = new Map<number, IPart[]>()
  let at = 0
  for (const p of result.parts) {
    const found = uncoded.findIndex((l, i) => i >= at && l === String(p.shorthand ?? '').trim())
    if (found >= 0) at = found
    const kind = (PART_KINDS as readonly string[]).includes(p.kind) ? (p.kind as PartKind) : 'fact'
    const flags = (p.flags ?? []).filter(
      (f) => f.type === 'unknown_term' || f.type === 'number_changed',
    ) as IPart['flags']
    inferred.set(at, [
      ...(inferred.get(at) ?? []),
      {
        id: randomUUID(),
        kind,
        text: String(p.text),
        shorthand: String(p.shorthand ?? uncoded[at]),
        inferred: true,
        flags,
      },
    ])
  }
  let next = 0
  return slots.flatMap((s) => (typeof s === 'string' ? (inferred.get(next++) ?? []) : s))
}
